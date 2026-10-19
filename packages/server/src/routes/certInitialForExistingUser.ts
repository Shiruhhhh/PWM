import type { App } from '../types.js';
import * as argon2 from 'argon2';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  certInitialForExistingUserRequestSchema,
  certInitialForExistingUserResponseSchema,
} from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { GENERIC_AUTH_ERROR } from '../lib/errors.js';
import { generateSessionToken, sessionExpiryFromNow } from '../lib/session.js';
import { logLoginAttempt, logSessionCreated, logCertEvent } from '../lib/logger.js';
import { notYetImplementedCaClient, type CaClient } from '../lib/caClient.js';
import type { KdfParams } from '@pwm/core';

/**
 * POST /cert/initial-for-existing-user (LAN/VPN-only listener, no
 * session required). Re-pairs a device to an existing account that has
 * no client cert on this device yet (e.g. a fresh app install/reinstall
 * after the previous one's Keystore-backed cert was wiped) -- without
 * going through /register, which 409s on a taken username. Not a
 * general-purpose auth route: it exists narrowly for "prove you know
 * this account's password, get a cert for this device," nothing else.
 * /login stays exclusively mTLS-gated, untouched.
 *
 * Verifies the password exactly like /login (recompute
 * Argon2id(authHash, storedServerSalt), constant-time compare), then
 * issues a cert exactly like /cert/initial, in one call -- same generic
 * 401 on any auth failure (username missing or hash mismatch), per
 * docs/API_SPEC.md "Error handling conventions".
 */
export function registerCertInitialForExistingUserRoute(
  app: App,
  caClient: CaClient = notYetImplementedCaClient,
): void {
  app.post(
    '/cert/initial-for-existing-user',
    {
      schema: {
        body: certInitialForExistingUserRequestSchema,
        response: {
          200: certInitialForExistingUserResponseSchema,
          401: z.object({ error: z.string() }),
        },
      },
      config: {
        // Same brute-force exposure class as /login -- same limit.
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { username, authHash, csr, deviceCn } = request.body;
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

      logLoginAttempt(request.log, { username, success: true });

      const certResult = await caClient.sign({
        csr,
        requestingUserId: user.id,
        deviceCn,
      });

      const cert = await prisma.clientCert.create({
        data: {
          userId: user.id,
          certCn: deviceCn,
          fingerprint: certResult.fingerprint,
          issuedAt: new Date(),
          expiresAt: new Date(certResult.expiresAt),
        },
      });

      logCertEvent(request.log, { userId: user.id, event: 'issued', certId: cert.id });

      const sessionToken = generateSessionToken();
      const expiresAt = sessionExpiryFromNow();
      await prisma.session.create({
        data: { token: sessionToken, userId: user.id, expiresAt },
      });
      logSessionCreated(request.log, { userId: user.id });

      return {
        sessionToken,
        expiresAt: expiresAt.toISOString(),
        wrappedVaultKeyPassword: Buffer.from(user.wrappedVaultKeyPassword).toString('base64'),
        userId: user.id,
        cert: certResult.cert,
        certId: cert.id,
      };
    },
  );
}
