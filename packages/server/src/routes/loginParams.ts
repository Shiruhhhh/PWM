import type { App } from '../types.js';
import { z } from 'zod';
import { kdfParamsSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { fakeClientSalt, FAKE_KDF_PARAMS } from '../lib/fakeLoginParams.js';

const querySchema = z.object({ username: z.string() });
const responseSchema = z.object({
  clientSalt: z.string(),
  kdfParams: kdfParamsSchema,
});

/**
 * GET /login/params — no session required, per docs/API_SPEC.md.
 * Same generic response shape whether username exists or not —
 * prevents enumeration (Bitwarden prelogin pattern).
 */
export function registerLoginParamsRoute(app: App): void {
  app.get(
    '/login/params',
    {
      schema: { querystring: querySchema, response: { 200: responseSchema } },
      config: {
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
    },
    async (request) => {
      const { username } = request.query;
      const user = await prisma.user.findUnique({ where: { username } });

      if (!user) {
        const secret = process.env.ENUMERATION_HMAC_SECRET;
        if (!secret) {
          throw new Error('ENUMERATION_HMAC_SECRET must be set');
        }
        return {
          clientSalt: fakeClientSalt(username, secret).toString('base64'),
          kdfParams: FAKE_KDF_PARAMS,
        };
      }

      return {
        clientSalt: Buffer.from(user.clientSalt).toString('base64'),
        kdfParams: user.kdfParams as z.infer<typeof kdfParamsSchema>,
      };
    },
  );
}
