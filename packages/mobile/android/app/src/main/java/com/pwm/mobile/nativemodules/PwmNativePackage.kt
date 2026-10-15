package com.pwm.mobile.nativemodules

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers PWM's custom TurboModules (NativeArgon2, NativeKeystore, NativeMtlsClient). */
class PwmNativePackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      Argon2Module.NAME -> Argon2Module(reactContext)
      KeystoreModule.NAME -> KeystoreModule(reactContext)
      MtlsClientModule.NAME -> MtlsClientModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      Argon2Module.NAME to ReactModuleInfo(
        name = Argon2Module.NAME,
        className = Argon2Module.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true,
      ),
      KeystoreModule.NAME to ReactModuleInfo(
        name = KeystoreModule.NAME,
        className = KeystoreModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true,
      ),
      MtlsClientModule.NAME to ReactModuleInfo(
        name = MtlsClientModule.NAME,
        className = MtlsClientModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true,
      ),
    )
  }
}
