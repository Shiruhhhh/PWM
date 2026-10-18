import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { App } from '../types.js';
import { requireSession } from '../lib/requireSession.js';

/**
 * GET /app/apk (session required) per docs/TASKS.md Phase 7. Streams the
 * APK file from APP_RELEASES_DIR, populated by scripts/deploy-apk.sh --
 * same directory and deploy mechanism as /app/version (registerAppVersionRoute).
 * No admin-upload endpoint, no multipart handling needed server-side at all.
 */
export function registerAppApkRoute(app: App): void {
  app.get('/app/apk', { preHandler: requireSession }, async (request, reply) => {
    const releasesDir = process.env.APP_RELEASES_DIR ?? '/etc/pwm-app-releases';
    const apkPath = join(releasesDir, 'app-release.apk');

    const { size } = await stat(apkPath);
    reply.header('content-type', 'application/vnd.android.package-archive');
    reply.header('content-length', size);
    return reply.send(createReadStream(apkPath));
  });
}
