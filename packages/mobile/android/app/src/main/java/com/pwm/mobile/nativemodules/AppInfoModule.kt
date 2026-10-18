package com.pwm.mobile.nativemodules

import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.pwm.mobile.specs.NativeAppInfoSpec
import java.io.File

/**
 * Reads this installed app's own versionCode and triggers the update
 * install flow, both via Android's own PackageManager/Intent APIs --
 * for the in-app update mechanism (TASKS.md Phase 7). See
 * specs/NativeAppInfo.ts.
 */
class AppInfoModule(reactContext: ReactApplicationContext) : NativeAppInfoSpec(reactContext) {

  override fun getName() = NAME

  override fun getInstalledVersionCode(promise: Promise) {
    try {
      val packageInfo = reactApplicationContext.packageManager
        .getPackageInfo(reactApplicationContext.packageName, 0)
      // PackageInfo.versionCode is deprecated in favor of longVersionCode
      // (API 28+, supports values beyond 32-bit), but this app's own
      // versionCode (set in app/build.gradle) is a small int and the
      // server's version.json schema is also a plain int -- no need for
      // the 64-bit variant.
      @Suppress("DEPRECATION")
      promise.resolve(packageInfo.versionCode)
    } catch (e: Exception) {
      promise.reject("APP_INFO_VERSION_CODE_FAILED", e.message, e)
    }
  }

  override fun installApk(apkPath: String, promise: Promise) {
    try {
      val file = File(apkPath)
      if (!file.exists()) {
        throw IllegalStateException("APK file not found at $apkPath")
      }

      val authority = "${reactApplicationContext.packageName}.fileprovider"
      val apkUri: Uri = FileProvider.getUriForFile(reactApplicationContext, authority, file)

      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(apkUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("APP_INFO_INSTALL_FAILED", e.message, e)
    }
  }

  override fun getCacheDir(promise: Promise) {
    promise.resolve(reactApplicationContext.cacheDir.absolutePath)
  }

  companion object {
    const val NAME = "NativeAppInfo"
  }
}
