package com.pwm.mobile.nativemodules

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.pwm.mobile.specs.NativeKeystoreSpec
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
private const val TRANSFORMATION = "AES/GCM/NoPadding"
private const val GCM_TAG_LENGTH_BITS = 128
private const val GCM_IV_LENGTH_BYTES = 12
private const val PREFS_NAME = "pwm_native_storage"

/**
 * Android Keystore-backed wrap/unwrap for the cached vaultKey, per
 * SCREENS_UX.md "Native module needs" #1. Keys are generated with
 * setUserAuthenticationRequired(true) and no validity-duration window
 * (biometric-only, per CryptoObject binding) so every wrap/unwrap call
 * requires a fresh BiometricPrompt success — see docs/DECISIONS.md.
 *
 * All RN bridge calls run off the main thread implicitly via the
 * TurboModule async dispatch; the BiometricPrompt itself must be shown
 * from the UI thread, so we post back to it for that part only.
 */
class KeystoreModule(private val reactContext: ReactApplicationContext) :
  NativeKeystoreSpec(reactContext) {

  override fun getName() = NAME

  private fun keyStore(): KeyStore =
    KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }

  override fun ensureKeyExists(keyAlias: String, promise: Promise) {
    try {
      val ks = keyStore()
      if (!ks.containsAlias(keyAlias)) {
        val keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
          keyAlias,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          .setUserAuthenticationRequired(true)
          .setInvalidatedByBiometricEnrollment(true)
          .build()
        keyGen.init(spec)
        keyGen.generateKey()
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("KEYSTORE_KEY_GEN_FAILED", e.message, e)
    }
  }

  private fun secretKey(keyAlias: String): SecretKey {
    val ks = keyStore()
    return ks.getKey(keyAlias, null) as SecretKey
  }

  private fun biometricManager(): BiometricManager = BiometricManager.from(reactContext)

  private fun checkBiometricAvailable(): Boolean {
    val result = biometricManager().canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
    return result == BiometricManager.BIOMETRIC_SUCCESS
  }

  override fun isBiometricAvailable(promise: Promise) {
    promise.resolve(checkBiometricAvailable())
  }

  /**
   * Shows a BiometricPrompt bound to `cipher` via a CryptoObject, resolving
   * `onReady` with the authenticated cipher on success. Must run on the UI
   * thread; the activity comes from the current ReactApplicationContext.
   */
  private fun authenticateAndRun(
    cipher: Cipher,
    promptTitle: String,
    promise: Promise,
    onAuthenticated: (Cipher) -> Unit,
  ) {
    val activity = reactContext.currentActivity
    if (activity !is androidx.fragment.app.FragmentActivity) {
      promise.reject("NO_ACTIVITY", "BiometricPrompt requires a FragmentActivity")
      return
    }

    activity.runOnUiThread {
      val executor = ContextCompat.getMainExecutor(reactContext)
      val callback = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          val authenticatedCipher = result.cryptoObject?.cipher
          if (authenticatedCipher == null) {
            promise.reject("BIOMETRIC_NO_CRYPTO_OBJECT", "authentication result missing cipher")
            return
          }
          try {
            onAuthenticated(authenticatedCipher)
          } catch (e: Exception) {
            promise.reject("KEYSTORE_OP_FAILED", e.message, e)
          }
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          promise.reject("BIOMETRIC_ERROR_$errorCode", errString.toString())
        }

        override fun onAuthenticationFailed() {
          // Not terminal -- BiometricPrompt keeps listening for retries;
          // only onAuthenticationError/onAuthenticationSucceeded end the flow.
        }
      }

      val prompt = BiometricPrompt(activity, executor, callback)
      val promptInfo = BiometricPrompt.PromptInfo.Builder()
        .setTitle(promptTitle)
        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        .setNegativeButtonText("Cancel")
        .build()
      prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
    }
  }

  override fun wrapKey(keyAlias: String, plaintextBase64: String, promptTitle: String, promise: Promise) {
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, secretKey(keyAlias))

      authenticateAndRun(cipher, promptTitle, promise) { authenticatedCipher ->
        val plaintext = Base64.decode(plaintextBase64, Base64.NO_WRAP)
        val ciphertext = authenticatedCipher.doFinal(plaintext)
        val iv = authenticatedCipher.iv

        // Wire format: iv(12 bytes) || ciphertext-and-tag, base64-encoded.
        // Each wrap uses a fresh IV (Cipher.ENCRYPT_MODE with no explicit
        // IV generates a random one), so storing it alongside the
        // ciphertext is required to decrypt later.
        val out = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, out, 0, iv.size)
        System.arraycopy(ciphertext, 0, out, iv.size, ciphertext.size)
        promise.resolve(Base64.encodeToString(out, Base64.NO_WRAP))
      }
    } catch (e: KeyPermanentlyInvalidatedException) {
      promise.reject("KEY_INVALIDATED", "Keystore key invalidated (biometrics changed) -- re-enroll required", e)
    } catch (e: Exception) {
      promise.reject("KEYSTORE_WRAP_FAILED", e.message, e)
    }
  }

  override fun unwrapKey(keyAlias: String, wrappedBase64: String, promptTitle: String, promise: Promise) {
    try {
      val wrapped = Base64.decode(wrappedBase64, Base64.NO_WRAP)
      if (wrapped.size < GCM_IV_LENGTH_BYTES) {
        promise.reject("KEYSTORE_UNWRAP_FAILED", "wrapped value too short")
        return
      }
      val iv = wrapped.copyOfRange(0, GCM_IV_LENGTH_BYTES)
      val ciphertext = wrapped.copyOfRange(GCM_IV_LENGTH_BYTES, wrapped.size)

      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, secretKey(keyAlias), GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))

      authenticateAndRun(cipher, promptTitle, promise) { authenticatedCipher ->
        val plaintext = authenticatedCipher.doFinal(ciphertext)
        promise.resolve(Base64.encodeToString(plaintext, Base64.NO_WRAP))
      }
    } catch (e: KeyPermanentlyInvalidatedException) {
      promise.reject("KEY_INVALIDATED", "Keystore key invalidated (biometrics changed) -- re-enroll required", e)
    } catch (e: Exception) {
      promise.reject("KEYSTORE_UNWRAP_FAILED", e.message, e)
    }
  }

  override fun deleteKey(keyAlias: String, promise: Promise) {
    try {
      val ks = keyStore()
      if (ks.containsAlias(keyAlias)) {
        ks.deleteEntry(keyAlias)
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("KEYSTORE_DELETE_FAILED", e.message, e)
    }
  }

  private fun prefs() =
    reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  override fun setItem(key: String, value: String, promise: Promise) {
    prefs().edit().putString(key, value).apply()
    promise.resolve(null)
  }

  override fun getItem(key: String, promise: Promise) {
    promise.resolve(prefs().getString(key, null))
  }

  override fun removeItem(key: String, promise: Promise) {
    prefs().edit().remove(key).apply()
    promise.resolve(null)
  }

  companion object {
    const val NAME = "NativeKeystore"
  }
}
