import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Reads this installed app's own versionCode, for the in-app update check
 * (TASKS.md Phase 7). Android generates BuildConfig.VERSION_CODE at build
 * time, but nothing exposes it to JS by default -- react-native-config
 * only surfaces .env values, not Gradle's own build metadata.
 */
export interface Spec extends TurboModule {
  getInstalledVersionCode(): Promise<number>;

  /**
   * Triggers Android's standard package-install flow for a downloaded
   * APK already sitting at `apkPath` (an absolute path under this app's
   * own cache dir -- see appUpdate.ts's downloadToFile usage). Wraps it
   * in a FileProvider content:// Uri (required on API 24+, a plain
   * file:// Uri is rejected) and starts the install Activity. The user
   * still gets the OS's own "Install this update?" confirmation -- this
   * only opens that dialog, it cannot accept it on the user's behalf.
   */
  installApk(apkPath: string): Promise<void>;

  /**
   * This app's own cache directory (Context.getCacheDir(), absolute
   * path) -- where the update APK gets downloaded to before installApk()
   * is called. Matches the "updates/" sub-path declared in
   * file_provider_paths.xml.
   */
  getCacheDir(): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeAppInfo');
