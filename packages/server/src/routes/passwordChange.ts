import type { App } from '../types.js';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { passwordChangeRequestSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { requireSession } from '../lib/requireSession.js';
import { logSessionInvalidated } from '../lib/logger.js';

const SERVER_SALT_LENGTH_BYTES = 16;

/**
 * POST /password-change (session required) — single DB transaction: new
 * salt, kdf_params, re-hashed auth_hash, new wrapped_vault_key_password.
 * Invalidates other active sessions (keep current one), per
 * docs/API_SPEC.md. Old values retained until write confirmed, rollback
 * on any failure mid-write — Prisma's $transaction gives this atomically.
 */
export function registerPasswordChangeRoute(app: App): void {
  app.post(
    '/password-change',
    {
      preHandler: requireSession,
      schema: { body: passwordChangeRequestSchema },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const currentToken = request.sessionToken!;
      const { newClientSalt, newKdfParams, newAuthHash, newWrappedVaultKeyPassword } = request.body;

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
          where: { id: userId },
          data: {
            clientSalt: Buffer.from(newClientSalt, 'base64'),
            kdfParams: newKdfParams,
            serverSalt: newServerSalt,
            authHash: Buffer.from(newStoredAuthHash),
            wrappedVaultKeyPassword: Buffer.from(newWrappedVaultKeyPassword, 'base64'),
          },
        }),
        prisma.session.deleteMany({
          where: { userId, token: { not: currentToken } },
        }),
      ]);

      logSessionInvalidated(request.log, { userId, reason: 'password_change' });

      return reply.code(204).send();
    },
  );
}
