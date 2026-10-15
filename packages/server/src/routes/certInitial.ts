import type { App } from '../types.js';
import { certInitialRequestSchema, certInitialResponseSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { requireSession } from '../lib/requireSession.js';
import { notYetImplementedCaClient, type CaClient } from '../lib/caClient.js';
import { logCertEvent } from '../lib/logger.js';

/**
 * POST /cert/initial (LAN/VPN-only listener, session required, NO
 * existing-cert check) -- issues a brand-new device's first client
 * cert. Deliberately skips the "must already have a valid cert" check
 * /cert/renew does, since there isn't one yet. See docs/DECISIONS.md #22.
 */
export function registerCertInitialRoute(
  app: App,
  caClient: CaClient = notYetImplementedCaClient,
): void {
  app.post(
    '/cert/initial',
    {
      preHandler: requireSession,
      schema: {
        body: certInitialRequestSchema,
        response: { 200: certInitialResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const { csr, deviceCn } = request.body;

      const result = await caClient.sign({
        csr,
        requestingUserId: userId,
        deviceCn,
      });

      const cert = await prisma.clientCert.create({
        data: {
          userId,
          certCn: deviceCn,
          fingerprint: result.fingerprint,
          issuedAt: new Date(),
          expiresAt: new Date(result.expiresAt),
        },
      });

      logCertEvent(request.log, { userId, event: 'issued', certId: cert.id });

      return reply.code(200).send({ cert: result.cert, certId: cert.id });
    },
  );
}
