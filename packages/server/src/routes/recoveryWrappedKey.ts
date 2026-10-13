import type { App } from '../types.js';
import { z } from 'zod';
import { recoveryWrappedKeyResponseSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { fakeWrappedVaultKeyRecovery } from '../lib/fakeLoginParams.js';

const querySchema = z.object({ username: z.string() });

/**
 * GET /recovery/wrapped-key — no session required, recovery key itself
 * is the credential. Hard rate-limited per-IP + per-username, per
 * docs/API_SPEC.md.
 */
export function registerRecoveryWrappedKeyRoute(app: App): void {
  app.get(
    '/recovery/wrapped-key',
    {
      schema: { querystring: querySchema, response: { 200: recoveryWrappedKeyResponseSchema } },
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
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
          wrappedVaultKeyRecovery: fakeWrappedVaultKeyRecovery(username, secret).toString('base64'),
          blobFormatVersion: 1,
        };
      }

      const vaultBlob = await prisma.vaultBlob.findUnique({ where: { userId: user.id } });

      return {
        wrappedVaultKeyRecovery: Buffer.from(user.wrappedVaultKeyRecovery).toString('base64'),
        blobFormatVersion: vaultBlob?.blobFormatVersion ?? 1,
      };
    },
  );
}
