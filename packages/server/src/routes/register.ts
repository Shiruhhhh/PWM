import type { App } from '../types.js';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { registerRequestSchema, registerResponseSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { generateSessionToken, sessionExpiryFromNow } from '../lib/session.js';
import { getRegistrationOpen } from '../lib/serverConfig.js';
import { logSessionCreated } from '../lib/logger.js';

const SERVER_SALT_LENGTH_BYTES = 16;

/**
 * POST /register (LAN/VPN-only listener per docs/DECISIONS.md #22) —
 * server generates serverSalt, computes Argon2id(authHash, serverSalt),
 * stores result. Never stores raw authHash. Rejects if username taken.
 *
 * Gated by the registrationOpen flag. Auto-logs in on success (same
 * response shape POST /login returns) so /login never needs to exist on
 * the LAN-only listener. First-ever registered user (userCount === 0 at
 * insert time, checked inside the same transaction as the insert to
 * avoid a race between two near-simultaneous first registrations)
 * becomes admin automatically -- no hardcoded admin account.
 */
export function registerRegisterRoute(app: App): void {
  app.post(
    '/register',
    {
      schema: {
        body: registerRequestSchema,
        response: {
          200: registerResponseSchema,
          403: z.object({ error: z.string() }),
          409: z.object({ error: z.string() }),
        },
      },
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const {
        username,
        clientSalt,
        kdfParams,
        authHash,
        wrappedVaultKeyPassword,
        wrappedVaultKeyRecovery,
      } = request.body;

      const registrationOpen = await getRegistrationOpen();
      if (!registrationOpen) {
        return reply.code(403).send({ error: 'registration is closed' });
      }

      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing) {
        return reply.code(409).send({ error: 'username taken' });
      }

      const serverSalt = randomBytes(SERVER_SALT_LENGTH_BYTES);
      const authHashBuf = Buffer.from(authHash, 'base64');
      const storedAuthHash = await argon2.hash(authHashBuf, {
        type: argon2.argon2id,
        memoryCost: kdfParams.memoryKiB,
        timeCost: kdfParams.iterations,
        parallelism: kdfParams.parallelism,
        hashLength: 32,
        salt: serverSalt,
        raw: true,
      });

      const sessionToken = generateSessionToken();
      const expiresAt = sessionExpiryFromNow();

      const user = await prisma.$transaction(async (tx) => {
        // Checked inside the transaction (not before it) so two
        // near-simultaneous first registrations can't both observe
        // count === 0 and both become admin.
        const userCount = await tx.user.count();
        const created = await tx.user.create({
          data: {
            username,
            clientSalt: Buffer.from(clientSalt, 'base64'),
            kdfParams,
            serverSalt,
            authHash: Buffer.from(storedAuthHash),
            wrappedVaultKeyPassword: Buffer.from(wrappedVaultKeyPassword, 'base64'),
            wrappedVaultKeyRecovery: Buffer.from(wrappedVaultKeyRecovery, 'base64'),
            isAdmin: userCount === 0,
          },
        });

        await tx.vaultBlob.create({
          data: {
            userId: created.id,
            encryptedBlob: Buffer.alloc(0),
            revision: 0,
            blobFormatVersion: 1,
          },
        });

        await tx.session.create({
          data: { token: sessionToken, userId: created.id, expiresAt },
        });

        return created;
      });

      logSessionCreated(request.log, { userId: user.id });

      return {
        sessionToken,
        expiresAt: expiresAt.toISOString(),
        wrappedVaultKeyPassword: Buffer.from(user.wrappedVaultKeyPassword).toString('base64'),
        userId: user.id,
      };
    },
  );
}
