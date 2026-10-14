package com.pwm.mobile.nativemodules

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.lambdapioneer.argon2kt.Argon2Kt
import com.lambdapioneer.argon2kt.Argon2Mode
import com.pwm.mobile.specs.NativeArgon2Spec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Argon2id hashing via argon2kt (JNI binding over the same P-H-C reference
 * C implementation the server's Node `argon2` package also binds to --
 * same algorithm family, byte-identical output given identical inputs).
 * Hermes has no native-module support for the npm `argon2` package used
 * by packages/core server-side, so this mirrors deriveMasterKey's exact
 * parameters natively. See docs/DECISIONS.md.
 */
class Argon2Module(reactContext: ReactApplicationContext) : NativeArgon2Spec(reactContext) {

  private val argon2Kt = Argon2Kt()
  private val scope = CoroutineScope(Dispatchers.Default)

  override fun getName() = NAME

  override fun hash(
    passwordUtf8: String,
    saltBase64: String,
    memoryKiB: Double,
    iterations: Double,
    parallelism: Double,
    hashLengthBytes: Double,
    promise: Promise,
  ) {
    scope.launch {
      try {
        val passwordBytes = passwordUtf8.toByteArray(Charsets.UTF_8)
        val saltBytes = Base64.decode(saltBase64, Base64.NO_WRAP)

        val result = argon2Kt.hash(
          mode = Argon2Mode.ARGON2_ID,
          password = passwordBytes,
          salt = saltBytes,
          tCostInIterations = iterations.toInt(),
          mCostInKibibyte = memoryKiB.toInt(),
          parallelism = parallelism.toInt(),
          hashLengthInBytes = hashLengthBytes.toInt(),
        )

        val hashBase64 = Base64.encodeToString(result.rawHashAsByteArray(), Base64.NO_WRAP)
        promise.resolve(hashBase64)
      } catch (e: Exception) {
        promise.reject("ARGON2_HASH_FAILED", e.message, e)
      }
    }
  }

  companion object {
    const val NAME = "NativeArgon2"
  }
}
