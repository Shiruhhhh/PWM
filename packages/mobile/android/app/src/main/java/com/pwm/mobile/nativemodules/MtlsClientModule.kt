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
          .setDigests(KeyProperties.DIGEST_SHA256)
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
      val entry = ks.getEntry(tempAlias, null) as? KeyStore.PrivateKeyEntry
        ?: throw IllegalStateException("no key found for alias $tempAlias -- call generateKeyAndCsr first")

      val cf = CertificateFactory.getInstance("X.509")
      val cert = cf.generateCertificate(ByteArrayInputStream(certPem.toByteArray())) as X509Certificate

      // Replaces the self-signed placeholder cert that
      // KeyPairGenerator/AndroidKeyStore attaches automatically with the
      // real CA-signed one -- the private key itself is never re-imported
      // (it can't leave the Keystore); only the cert chain changes.
      ks.setKeyEntry(tempAlias, entry.privateKey, null, arrayOf<Certificate>(cert))

      prefs().edit()
        .putString(ACTIVE_CERT_ALIAS_PREF_KEY, tempAlias)
        .putString(ACTIVE_CERT_ID_PREF_KEY, certId)
        .apply()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("MTLS_INSTALL_CERT_FAILED", e.message, e)
    }
  }

  override fun isClientCertInstalled(promise: Promise) {
    try {
      val alias = activeCertAlias()
      promise.resolve(alias != null && keyStore().containsAlias(alias))
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
      val cert = keyStore().getCertificate(alias) as? X509Certificate
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

        val sslContext = buildSslContext(alias)
        val client = OkHttpClient.Builder()
          .sslSocketFactory(sslContext.socketFactory, systemDefaultTrustManager())
          .build()

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
          promise.resolve(result)
        }
      } catch (e: Exception) {
        promise.reject("MTLS_REQUEST_FAILED", e.message, e)
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
    val cert = ks.getCertificate(alias) as X509Certificate
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
