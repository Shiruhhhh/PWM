import { createSessionApiClient } from './apiClient';
import { getServerBaseUrl } from './config';
import { getInstalledVersionCode, getCacheDir, installApk } from '../native/appInfo';
import { mtlsDownloadToFile } from '../native/mtlsClient';
import { useUpdateStore } from '../state/updateStore';

/**
 * Checks the backend's GET /app/version against this device's own
 * installed versionCode, per TASKS.md Phase 7. Call on launch/foreground
 * while a session is active -- same calling convention as
 * certRenewal.ts's runCertRenewalCheck. Sets updateStore's `available`
 * when the server reports something newer; never clears it to null on a
 * "still outdated" result (that would fight the user's dismiss), only
 * updates/sets it, or leaves it alone if the server is NOT newer.
 */
export async function checkForUpdate(sessionToken: string): Promise<void> {
  const baseUrl = await getServerBaseUrl();
  if (!baseUrl) {
    return;
  }

  const [installedVersionCode, api] = [
    await getInstalledVersionCode(),
    createSessionApiClient({ baseUrl, sessionToken }),
  ];

  const serverVersion = await api.appVersion();
  if (serverVersion.versionCode > installedVersionCode) {
    useUpdateStore.getState().setAvailable(serverVersion);
  }
}

/**
 * Fire-and-forget wrapper, matching certRenewal.ts's runCertRenewalCheck
 * -- failures are swallowed (an update check failing shouldn't disrupt
 * anything else; the next check will just try again).
 */
export function runUpdateCheck(sessionToken: string): void {
  checkForUpdate(sessionToken).catch(() => undefined);
}

/**
 * Downloads the server's APK via the authenticated GET /app/apk endpoint
 * (same mTLS session) to this app's own cache dir, then triggers
 * Android's standard install-confirmation flow. Called from the update
 * banner's "Update now" tap. The user still gets the OS's own install
 * dialog -- this cannot and does not bypass it.
 */
export async function downloadAndInstallUpdate(sessionToken: string): Promise<void> {
  const baseUrl = await getServerBaseUrl();
  if (!baseUrl) {
    throw new Error('server address not configured');
  }

  const cacheDir = await getCacheDir();
  // Matches file_provider_paths.xml's <cache-path name="updates" path="updates/">.
  const destPath = `${cacheDir}/updates/pwm-update.apk`;

  await mtlsDownloadToFile(
    `${baseUrl}/app/apk`,
    { authorization: `Bearer ${sessionToken}` },
    destPath,
  );
  await installApk(destPath);
}
