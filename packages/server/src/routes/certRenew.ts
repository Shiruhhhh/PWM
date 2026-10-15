import type { App } from '../types.js';
import { z } from 'zod';
import { certRenewRequestSchema, certRenewResponseSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { requireSession } from '../lib/requireSession.js';
import { notYetImplementedCaClient, type CaClient } from '../lib/caClient.js';
import { logCertEvent } from '../lib/logger.js';

/**
 * POST /cert/renew (session required, current valid client cert) —
 * validates session + current cert not expired/revoked, forwards CSR to
 * CA signing LXC, logs rotation, keeps old cert active for grace period
 * until new one confirmed, per docs/API_SPEC.md.
 */
export function registerCertRenewRoute(
  app: App,
  caClient: CaClient = notYetImplementedCaClient,
): void {
  app.post(
    '/cert/renew',
    {
      preHandler: requireSession,
      schema: {
        body: certRenewRequestSchema,
        response: {
          200: certRenewResponseSchema,
          403: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const { csr } = request.body;

      const activeCert = await prisma.clientCert.findFirst({
        where: { userId, revoked: false, expiresAt: { gt: new Date() } },
      });
      if (!activeCert) {
        return reply.code(403).send({ error: 'no valid client cert for this session' });
      }

      const result = await caClient.sign({
        csr,
        requestingUserId: userId,
        deviceCn: activeCert.certCn,
      });

      const newCertRow = await prisma.clientCert.create({
        data: {
          userId,
          certCn: activeCert.certCn,
          fingerprint: result.fingerprint,
          issuedAt: new Date(),
          expiresAt: new Date(result.expiresAt),
        },
      });

      logCertEvent(request.log, { userId, event: 'renewed', certId: newCertRow.id });

      return { newCert: result.cert, certId: newCertRow.id };
    },
  );
}
