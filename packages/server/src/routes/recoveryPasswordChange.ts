import type { App } from '../types.js';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { recoveryPasswordChangeRequestSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { GENERIC_AUTH_ERROR } from '../lib/errors.js';
import { logSessionInvalidated } from '../lib/logger.js';

const SERVER_SALT_LENGTH_BYTES = 16;

/**
 * POST /recovery/password-change — no session required. Per
 * docs/API_SPEC.md "recovery is purely a local unwrap-then-rewrap
 * operation": the client already proved possession of the recovery key
 * by successfully unwrapping wrappedVaultKeyRecovery locally (GET
 * /recovery/wrapped-key + CRYPTO_SPEC.md §5) before ever calling this.
 * The server has no way to verify that unwrap happened -- same trust
 * model GET /recovery/wrapped-key already accepts, extended here because
 * normal POST /password-change requires a session recovery can't have
 * (see docs/DECISIONS.md #20).
 *
 * Same atomic transaction as POST /password-change, except it
 * invalidates ALL sessions (there's no "current" session to keep).
 * Generic response whether the username exists or not, same as
 * /login/params and /recovery/wrapped-key, so this can't be used to
 * enumerate accounts either.
 */
export function registerRecoveryPasswordChangeRoute(app: App): void {
  app.post(
    '/recovery/password-change',
    {
      schema: {
        body: recoveryPasswordChangeRequestSchema,
        response: {
          204: z.undefined(),
          401: z.object({ error: z.string() }),
        },
      },
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { username, newClientSalt, newKdfParams, newAuthHash, newWrappedVaultKeyPassword } =
        request.body;

      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) {
        // Same generic shape as a real failure -- never reveal whether
        // the username exists, per API_SPEC.md "Error handling conventions".
        return reply.code(401).send(GENERIC_AUTH_ERROR);
      }

      const newServerSalt = randomBytes(SERVER_SALT_LENGTH_BYTES);
      const newAuthHashBuf = Buffer.from(newAuthHash, 'base64');
      const newStoredAuthHash = await argon2.hash(newAuthHashBuf, {
        type: argon2.argon2id,
        memoryCost: newKdfParams.memoryKiB,
        timeCost: newKdfParams.iterations,
        parallelism: newKdfParams.parallelism,
        hashLength: 32,
        salt: newServerSalt,
        raw: true,
      });

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            clientSalt: Buffer.from(newClientSalt, 'base64'),
            kdfParams: newKdfParams,
            serverSalt: newServerSalt,
            authHash: Buffer.from(newStoredAuthHash),
            wrappedVaultKeyPassword: Buffer.from(newWrappedVaultKeyPassword, 'base64'),
          },
        }),
        prisma.session.deleteMany({ where: { userId: user.id } }),
      ]);

      logSessionInvalidated(request.log, { userId: user.id, reason: 'recovery_password_change' });

      return reply.code(204).send();
    },
  );
}
