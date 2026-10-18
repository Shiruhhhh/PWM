import NativeAppInfo from '../../specs/NativeAppInfo';

export async function getInstalledVersionCode(): Promise<number> {
  return NativeAppInfo.getInstalledVersionCode();
}

export async function installApk(apkPath: string): Promise<void> {
  await NativeAppInfo.installApk(apkPath);
}

export async function getCacheDir(): Promise<string> {
  return NativeAppInfo.getCacheDir();
}
