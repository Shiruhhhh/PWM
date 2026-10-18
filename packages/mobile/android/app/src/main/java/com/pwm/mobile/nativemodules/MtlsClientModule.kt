package com.pwm.mobile.nativemodules

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.pwm.mobile.specs.NativeMtlsClientSpec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.AlgorithmIdentifier
import org.bouncycastle.operator.ContentSigner
import org.bouncycastle.pkcs.PKCS10CertificationRequest
import org.bouncycastle.pkcs.jcajce.JcaPKCS10CertificationRequestBuilder
import org.bouncycastle.util.io.pem.PemObject
import org.bouncycastle.util.io.pem.PemWriter
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.OutputStream
import java.io.StringWriter
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.cert.Certificate
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.KeyManager
import javax.net.ssl.SSLContext
import javax.net.ssl.X509ExtendedKeyManager

private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
private const val ACTIVE_CERT_ALIAS_PREF_KEY = "pwm_mtls_active_cert_alias"
private const val ACTIVE_CERT_ID_PREF_KEY = "pwm_mtls_active_cert_id"
private const val ACTIVE_CERT_PEM_PREF_KEY = "pwm_mtls_active_cert_pem"
private const val PREFS_NAME = "pwm_mtls_state"
private const val SIGNATURE_ALGORITHM = "SHA256withECDSA"

/**
 * mTLS client-cert networking + cert lifecycle, per THREAT_MODEL.md /
 * docs/DECISIONS.md #22. The client cert's private key lives in its own
 * Keystore alias, hardware-backed, WITHOUT setUserAuthenticationRequired
 * -- see specs/NativeMtlsClient.ts's docstring for why (gating every
 * HTTP request behind biometric would be unusable; this is a
 * device-trust credential, not a vault-secrecy one).
 */
class MtlsClientModule(private val reactContext: ReactApplicationContext) :
  NativeMtlsClientSpec(reactContext) {

  private val scope = CoroutineScope(Dispatchers.IO)

  // Cached mTLS OkHttpClient -- building one means a Keystore round-trip,
  // a PEM parse, and a fresh TLS context init, all real cost if repeated
  // on every single request (code review follow-up from docs/DECISIONS.md
  // #30/#31). Keyed by alias so a cert/key change (installCert,
  // deleteKeyAlias) invalidates it rather than serving a stale client.
  @Volatile private var cachedMtlsClient: Pair<String, OkHttpClient>? = null

  override fun getName() = NAME

  private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }

  private fun prefs() = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun activeCertAlias(): String? = prefs().getString(ACTIVE_CERT_ALIAS_PREF_KEY, null)

  override fun generateKeyAndCsr(tempAlias: String, deviceCn: String, promise: Promise) {
    scope.launch {
      try {
        val keyGen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
          tempAlias,
          KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
          .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
          // Some devices' StrongBox implementations have documented EC-signing
          // bugs that surface exactly as INCOMPATIBLE_DIGEST during a TLS 1.3
          // CertificateVerify, even though the key signs fine for other
          // operations (e.g. the CSR itself, right after generation -- see
          // docs/DECISIONS.md #30). Force TEE-backed instead of letting the
          // platform pick StrongBox when both are available.
          .setIsStrongBoxBacked(false)
          // TLS's CertificateVerify signs a PRE-COMPUTED transcript hash --
          // Conscrypt calls Signature with NONEwithECDSA (raw signing over
          // an already-hashed digest), not SHA256withECDSA (which would
          // re-hash the input). DIGEST_NONE must be an authorized digest
          // for that to work; its absence here caused a real
          // INCOMPATIBLE_DIGEST KeyMint error on every real-device TLS
          // handshake attempt (see docs/DECISIONS.md #30), even though
          // SHA256withECDSA (used by our own KeystoreContentSigner for CSR
          // signing, which keeps using that algorithm, not NONE) worked
          // fine under the SHA256/384/512-only version of this list.
          .setDigests(
            KeyProperties.DIGEST_NONE,
            KeyProperties.DIGEST_SHA256,
            KeyProperties.DIGEST_SHA384,
            KeyProperties.DIGEST_SHA512,
          )
          // Deliberately NO setUserAuthenticationRequired -- see class docstring.
          .build()
        keyGen.initialize(spec)
        val keyPair = keyGen.generateKeyPair()

        val subject = X500Name("CN=$deviceCn")
        val csrBuilder = JcaPKCS10CertificationRequestBuilder(subject, keyPair.public)
        val signer = KeystoreContentSigner(tempAlias)
        val csr: PKCS10CertificationRequest = csrBuilder.build(signer)

        val pem = StringWriter().use { writer ->
          PemWriter(writer).use { pemWriter ->
            pemWriter.writeObject(PemObject("CERTIFICATE REQUEST", csr.encoded))
          }
          writer.toString()
        }
        promise.resolve(pem)
      } catch (e: Exception) {
        promise.reject("MTLS_CSR_GEN_FAILED", e.message, e)
      }
    }
  }

  override fun installCert(tempAlias: String, certPem: String, certId: String, promise: Promise) {
    try {
      val ks = keyStore()
      if (!ks.containsAlias(tempAlias)) {
        throw IllegalStateException("no key found for alias $tempAlias -- call generateKeyAndCsr first")
      }

      // Validate the cert parses, but do NOT call ks.setKeyEntry() to swap
      // it into the Keystore -- real-device testing found that replacing
      // just the cert chain on an existing AndroidKeyStore EC key entry
      // this way leaves the key unable to sign for TLS 1.3's
      // CertificateVerify afterward (INCOMPATIBLE_DIGEST from Keystore2,
      // even though the SAME key signs fine immediately after generation,
      // before any setKeyEntry call -- see docs/DECISIONS.md #30). The
      // Keystore-visible cert stays the original self-signed placeholder
      // forever; the real CA-signed cert is stored here instead and used
      // to build the TLS chain directly in buildSslContext(), while
      // signing operations still go through the untouched Keystore key.
      val cf = CertificateFactory.getInstance("X.509")
      cf.generateCertificate(ByteArrayInputStream(certPem.toByteArray())) as X509Certificate

      prefs().edit()
        .putString(ACTIVE_CERT_ALIAS_PREF_KEY, tempAlias)
        .putString(ACTIVE_CERT_ID_PREF_KEY, certId)
        .putString(ACTIVE_CERT_PEM_PREF_KEY, certPem)
        .apply()
      cachedMtlsClient = null
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("MTLS_INSTALL_CERT_FAILED", e.message, e)
    }
  }

  private fun activeCertPem(): String? = prefs().getString(ACTIVE_CERT_PEM_PREF_KEY, null)

  private fun parseActiveCert(): X509Certificate? {
    val pem = activeCertPem() ?: return null
    val cf = CertificateFactory.getInstance("X.509")
    return cf.generateCertificate(ByteArrayInputStream(pem.toByteArray())) as X509Certificate
  }

  override fun isClientCertInstalled(promise: Promise) {
    try {
      val alias = activeCertAlias()
      // Also require the PEM pref (#30) -- a device upgrading in-place
      // from a pre-#30 build has the Keystore alias but never wrote that
      // pref, which would otherwise route it past Setup into a LoginScreen
      // that crashes every request via buildSslContext()'s
      // "no active cert stored" IllegalStateException.
      promise.resolve(alias != null && keyStore().containsAlias(alias) && activeCertPem() != null)
    } catch (e: Exception) {
      promise.reject("MTLS_CHECK_FAILED", e.message, e)
    }
  }

  override fun getActiveCertInfo(promise: Promise) {
    try {
      val alias = activeCertAlias()
      val certId = prefs().getString(ACTIVE_CERT_ID_PREF_KEY, null)
      if (alias == null || certId == null) {
        promise.resolve(null)
        return
      }
      val cert = parseActiveCert()
      if (cert == null) {
        promise.resolve(null)
        return
      }
      val result = com.facebook.react.bridge.Arguments.createMap()
      result.putString("expiresAt", cert.notAfter.toInstant().toString())
      result.putString("alias", alias)
      result.putString("certId", certId)
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("MTLS_GET_CERT_INFO_FAILED", e.message, e)
    }
  }

  override fun deleteKeyAlias(alias: String, promise: Promise) {
    try {
      val ks = keyStore()
      if (ks.containsAlias(alias)) {
        ks.deleteEntry(alias)
      }
      cachedMtlsClient?.let { if (it.first == alias) cachedMtlsClient = null }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("MTLS_DELETE_ALIAS_FAILED", e.message, e)
    }
  }

  override fun request(
    method: String,
    url: String,
    headersJson: String,
    body: String?,
    promise: Promise,
  ) {
    scope.launch {
      try {
        val alias = activeCertAlias()
          ?: throw IllegalStateException("no active client cert installed -- call installCert first")

        val cached = cachedMtlsClient
        val client = if (cached != null && cached.first == alias) {
          cached.second
        } else {
          val sslContext = buildSslContext(alias)
          val built = OkHttpClient.Builder()
            .sslSocketFactory(sslContext.socketFactory, systemDefaultTrustManager())
            .build()
          cachedMtlsClient = alias to built
          built
        }

        val result = executeRequest(client, method, url, headersJson, body)
        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("MTLS_REQUEST_FAILED", e.message, e)
      }
    }
  }

  override fun bootstrapRequest(
    method: String,
    url: String,
    headersJson: String,
    body: String?,
    promise: Promise,
  ) {
    scope.launch {
      try {
        // Same trust manager INSTANCE must back both the SSLContext and
        // the OkHttpClient.Builder.sslSocketFactory() call below -- two
        // separately-constructed instances (even if logically identical)
        // can cause OkHttp's own trust-manager introspection (it reflects
        // into the factory to find the X509TrustManager for later cert
        // pinning/CertificatePinner checks) to mismatch.
        val trustManager = pinnedCaTrustManager()
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf<javax.net.ssl.TrustManager>(trustManager), null)

        val client = OkHttpClient.Builder()
          .sslSocketFactory(sslContext.socketFactory, trustManager)
          .build()

        val result = executeRequest(client, method, url, headersJson, body)
        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("MTLS_BOOTSTRAP_REQUEST_FAILED", e.message, e)
      }
    }
  }

  private fun executeRequest(
    client: OkHttpClient,
    method: String,
    url: String,
    headersJson: String,
    body: String?,
  ): com.facebook.react.bridge.WritableMap {
    val headers = JSONObject(headersJson)
    val requestBuilder = Request.Builder().url(url)
    val keys = headers.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      requestBuilder.addHeader(key, headers.getString(key))
    }

    val mediaType = headers.optString("content-type", "application/json").toMediaTypeOrNull()
    val requestBody = body?.toRequestBody(mediaType)

    when (method.uppercase()) {
      "GET" -> requestBuilder.get()
      "POST" -> requestBuilder.post(requestBody ?: "".toRequestBody(mediaType))
      "PUT" -> requestBuilder.put(requestBody ?: "".toRequestBody(mediaType))
      "PATCH" -> requestBuilder.patch(requestBody ?: "".toRequestBody(mediaType))
      "DELETE" -> requestBuilder.delete(requestBody)
      else -> throw IllegalArgumentException("unsupported method: $method")
    }

    client.newCall(requestBuilder.build()).execute().use { response ->
      val responseHeaders = JSONObject()
      for (name in response.headers.names()) {
        responseHeaders.put(name, response.header(name))
      }
      val result = com.facebook.react.bridge.Arguments.createMap()
      result.putInt("status", response.code)
      result.putString("body", response.body?.string() ?: "")
      result.putString("headersJson", responseHeaders.toString())
      return result
    }
  }

  override fun downloadToFile(url: String, headersJson: String, destPath: String, promise: Promise) {
    scope.launch {
      try {
        val alias = activeCertAlias()
          ?: throw IllegalStateException("no active client cert installed -- call installCert first")

        val cached = cachedMtlsClient
        val client = if (cached != null && cached.first == alias) {
          cached.second
        } else {
          val sslContext = buildSslContext(alias)
          val built = OkHttpClient.Builder()
            .sslSocketFactory(sslContext.socketFactory, systemDefaultTrustManager())
            .build()
          cachedMtlsClient = alias to built
          built
        }

        val headers = JSONObject(headersJson)
        val requestBuilder = Request.Builder().url(url).get()
        val keys = headers.keys()
        while (keys.hasNext()) {
          val key = keys.next()
          requestBuilder.addHeader(key, headers.getString(key))
        }

        client.newCall(requestBuilder.build()).execute().use { response ->
          if (!response.isSuccessful) {
            throw java.io.IOException("download failed: HTTP ${response.code}")
          }
          val body = response.body ?: throw java.io.IOException("empty response body")
          java.io.File(destPath).parentFile?.mkdirs()
          java.io.File(destPath).outputStream().use { out ->
            body.byteStream().copyTo(out)
          }
          promise.resolve(response.code)
        }
      } catch (e: Exception) {
        promise.reject("MTLS_DOWNLOAD_FAILED", e.message, e)
      }
    }
  }

  /**
   * Builds an SSLContext presenting the Keystore-backed client cert via
   * a minimal X509ExtendedKeyManager wrapping the single active alias --
   * OkHttp/standard Java TLS have no simpler "just present this one
   * Keystore alias" API than implementing the KeyManager interface.
   */
  private fun buildSslContext(alias: String): SSLContext {
    val ks = keyStore()
    // The real CA-signed cert, NOT ks.getCertificate(alias) -- that still
    // holds the original self-signed placeholder, deliberately never
    // overwritten (see installCert()'s docs/DECISIONS.md #30 comment).
    val cert = parseActiveCert()
      ?: throw IllegalStateException("no active cert stored -- call installCert first")
    val keyManager = SingleAliasKeyManager(alias, arrayOf(cert), ks)

    val sslContext = SSLContext.getInstance("TLS")
    sslContext.init(arrayOf<KeyManager>(keyManager), null, null)
    return sslContext
  }

  /**
   * Trusts the system's default CA trust store for the SERVER cert
   * (pwm-app's own TLS cert, issued via Let's Encrypt per DEPLOY.md --
   * a normal publicly-trusted cert, not our internal CA). Only the
   * CLIENT side of this connection uses our internal CA
   * (SingleAliasKeyManager above); the server side is ordinary public
   * TLS, so the platform's default trust manager is correct here.
   */
  private fun systemDefaultTrustManager(): javax.net.ssl.X509TrustManager {
    val tmf = javax.net.ssl.TrustManagerFactory.getInstance(
      javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm(),
    )
    tmf.init(null as KeyStore?)
    return tmf.trustManagers.filterIsInstance<javax.net.ssl.X509TrustManager>().first()
  }

  /**
   * Trusts ONLY the internal CA root bundled at assets/pwm-ca-root.pem --
   * the system trust store is deliberately NOT consulted. Used solely for
   * the bootstrap (:8443) listener, which can never get a publicly-trusted
   * cert (no hostname, LAN-only) and whose own self-signed fallback no
   * mobile OS trusts by default. Pinning against our own CA root is the
   * standard fix for "trust my own self-hosted backend" -- see
   * docs/DECISIONS.md #28.
   */
  private fun pinnedCaTrustManager(): javax.net.ssl.X509TrustManager {
    val cf = CertificateFactory.getInstance("X.509")
    val caCert = reactContext.assets.open("pwm-ca-root.pem").use { cf.generateCertificate(it) }

    val trustStore = KeyStore.getInstance(KeyStore.getDefaultType())
    trustStore.load(null, null)
    trustStore.setCertificateEntry("pwm-ca-root", caCert)

    val tmf = javax.net.ssl.TrustManagerFactory.getInstance(
      javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm(),
    )
    tmf.init(trustStore)
    return tmf.trustManagers.filterIsInstance<javax.net.ssl.X509TrustManager>().first()
  }

  companion object {
    const val NAME = "NativeMtlsClient"
  }
}

/**
 * Minimal X509ExtendedKeyManager presenting exactly one Keystore alias
 * for client auth -- Java's TLS stack needs this interface to ask "which
 * alias do you want to present," and there's no simpler built-in for
 * "just always use this one Keystore entry."
 */
private class SingleAliasKeyManager(
  private val alias: String,
  private val chain: Array<X509Certificate>,
  private val keyStore: KeyStore,
) : X509ExtendedKeyManager() {
  override fun getClientAliases(keyType: String?, issuers: Array<out java.security.Principal>?) =
    arrayOf(alias)

  override fun chooseClientAlias(
    keyType: Array<out String>?,
    issuers: Array<out java.security.Principal>?,
    socket: java.net.Socket?,
  ) = alias

  override fun getServerAliases(keyType: String?, issuers: Array<out java.security.Principal>?): Array<String>? = null

  override fun chooseServerAlias(
    keyType: String?,
    issuers: Array<out java.security.Principal>?,
    socket: java.net.Socket?,
  ): String? = null

  // TLS 1.3 via Conscrypt's SSLEngine-based path (what OkHttp actually
  // uses, not the legacy Socket-based API) calls these engine-aware
  // overloads instead of chooseClientAlias(..., Socket) above -- without
  // overriding them, X509ExtendedKeyManager's default implementation may
  // not correctly resolve to this alias during the real handshake, even
  // though the Socket-based path (and anything that doesn't go through
  // SSLEngine) works fine. See docs/DECISIONS.md #30.
  override fun chooseEngineClientAlias(
    keyType: Array<out String>?,
    issuers: Array<out java.security.Principal>?,
    engine: javax.net.ssl.SSLEngine?,
  ) = alias

  override fun chooseEngineServerAlias(
    keyType: String?,
    issuers: Array<out java.security.Principal>?,
    engine: javax.net.ssl.SSLEngine?,
  ): String? = null

  override fun getCertificateChain(alias: String?): Array<X509Certificate> = chain

  override fun getPrivateKey(alias: String?): PrivateKey =
    keyStore.getKey(this.alias, null) as PrivateKey
}

/**
 * Bouncy Castle ContentSigner that delegates to the Keystore-resident
 * private key's Signature object -- never extracts the private key
 * itself (impossible for a hardware-backed key anyway), just uses the
 * Keystore's own signing operation to sign the CSR's TBS bytes.
 *
 * Bouncy Castle is used only as a library here (PKCS#10 ASN.1
 * encoding), never registered as a java.security.Provider -- avoids
 * the classpath conflict with Android's own stripped-down built-in BC
 * provider (see android/app/build.gradle's comment on the dependency).
 */
private class KeystoreContentSigner(alias: String) : ContentSigner {
  private val privateKey: PrivateKey = KeyStore.getInstance(KEYSTORE_PROVIDER)
    .apply { load(null) }
    .getKey(alias, null) as PrivateKey
  private val signature = Signature.getInstance(SIGNATURE_ALGORITHM)
  private val buffer = java.io.ByteArrayOutputStream()

  init {
    signature.initSign(privateKey)
  }

  override fun getAlgorithmIdentifier(): AlgorithmIdentifier =
    AlgorithmIdentifier(org.bouncycastle.asn1.x9.X9ObjectIdentifiers.ecdsa_with_SHA256)

  override fun getOutputStream(): OutputStream = buffer

  override fun getSignature(): ByteArray {
    signature.update(buffer.toByteArray())
    return signature.sign()
  }
}
