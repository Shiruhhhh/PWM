import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { App } from '../types.js';
import { appVersionResponseSchema } from '@pwm/core';
import { requireSession } from '../lib/requireSession.js';

const GENERIC_VERSION_UNAVAILABLE_ERROR = { error: 'version info unavailable' } as const;

/**
 * GET /app/version (session required) per docs/TASKS.md Phase 7 (in-app
 * update mechanism). Reads a version.json file from APP_RELEASES_DIR,
 * populated by scripts/deploy-apk.sh -- not a database row, not an
 * admin-upload endpoint, per the resolved design (see DECISIONS.md).
 *
 * A missing/malformed version.json (deploy script never run yet, or ran
 * with a bad value) is a deployment mistake, not a normal runtime state
 * -- logged server-side as a real error, but surfaced to the client as a
 * generic 503 rather than an unhandled 500/raw stack trace, matching
 * requireSession.ts's generic-error convention.
 */
export function registerAppVersionRoute(app: App): void {
  app.get(
    '/app/version',
    {
      preHandler: requireSession,
      schema: {
        response: { 200: appVersionResponseSchema, 503: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const releasesDir = process.env.APP_RELEASES_DIR ?? '/etc/pwm-app-releases';
      try {
        const raw = await readFile(join(releasesDir, 'version.json'), 'utf8');
        return appVersionResponseSchema.parse(JSON.parse(raw));
      } catch (err) {
        request.log.error(
          { event: 'app_version_read_failed', err },
          'failed to read/parse version.json -- has scripts/deploy-apk.sh been run?',
        );
        return reply.code(503).send(GENERIC_VERSION_UNAVAILABLE_ERROR);
      }
    },
  );
}
