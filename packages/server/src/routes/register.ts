import type { App } from '../types.js';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { registerRequestSchema, registerResponseSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';

const SERVER_SALT_LENGTH_BYTES = 16;

/**
 * POST /register — server generates serverSalt, computes
 * Argon2id(authHash, serverSalt), stores result. Never stores raw
 * authHash. Rejects if username taken, per docs/API_SPEC.md.
 */
export function registerRegisterRoute(app: App): void {
  app.post(
    '/register',
    {
      schema: {
        body: registerRequestSchema,
        response: {
          200: registerResponseSchema,
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

      const user = await prisma.user.create({
        data: {
          username,
          clientSalt: Buffer.from(clientSalt, 'base64'),
          kdfParams,
          serverSalt,
          authHash: Buffer.from(storedAuthHash),
          wrappedVaultKeyPassword: Buffer.from(wrappedVaultKeyPassword, 'base64'),
          wrappedVaultKeyRecovery: Buffer.from(wrappedVaultKeyRecovery, 'base64'),
        },
      });

      await prisma.vaultBlob.create({
        data: {
          userId: user.id,
          encryptedBlob: Buffer.alloc(0),
          revision: 0,
          blobFormatVersion: 1,
        },
      });

      return { userId: user.id };
    },
  );
}
