import type { App } from '../types.js';
import * as argon2 from 'argon2';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { loginRequestSchema, loginResponseSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { GENERIC_AUTH_ERROR } from '../lib/errors.js';
import { generateSessionToken, sessionExpiryFromNow } from '../lib/session.js';
import { logLoginAttempt, logSessionCreated } from '../lib/logger.js';
import type { KdfParams } from '@pwm/core';

/**
 * POST /login — recomputes Argon2id(authHash, storedServerSalt),
 * constant-time compare against stored hash. Same generic failure
 * response whether username missing or hash mismatch, per
 * docs/API_SPEC.md "Error handling conventions".
 */
export function registerLoginRoute(app: App): void {
  app.post(
    '/login',
    {
      schema: {
        body: loginRequestSchema,
        response: {
          200: loginResponseSchema,
          401: z.object({ error: z.string() }),
        },
      },
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { username, authHash } = request.body;
      const user = await prisma.user.findUnique({ where: { username } });

      if (!user) {
        logLoginAttempt(request.log, { username, success: false });
        return reply.code(401).send(GENERIC_AUTH_ERROR);
      }

      const kdfParams = user.kdfParams as KdfParams;
      const authHashBuf = Buffer.from(authHash, 'base64');
      const storedAuthHash = Buffer.from(user.authHash);
      const computedHash = await argon2.hash(authHashBuf, {
        type: argon2.argon2id,
        memoryCost: kdfParams.memoryKiB,
        timeCost: kdfParams.iterations,
        parallelism: kdfParams.parallelism,
        hashLength: 32,
        salt: Buffer.from(user.serverSalt),
        raw: true,
      });

      const matches =
        computedHash.length === storedAuthHash.length &&
        timingSafeEqual(computedHash, storedAuthHash);

      if (!matches) {
        logLoginAttempt(request.log, { username, success: false });
        return reply.code(401).send(GENERIC_AUTH_ERROR);
      }

      const token = generateSessionToken();
      const expiresAt = sessionExpiryFromNow();
      await prisma.session.create({
        data: { token, userId: user.id, expiresAt },
      });

      logLoginAttempt(request.log, { username, success: true });
      logSessionCreated(request.log, { userId: user.id });

      return {
        sessionToken: token,
        expiresAt: expiresAt.toISOString(),
        wrappedVaultKeyPassword: Buffer.from(user.wrappedVaultKeyPassword).toString('base64'),
        userId: user.id,
      };
    },
  );
}
