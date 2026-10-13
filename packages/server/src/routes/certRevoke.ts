import type { App } from '../types.js';
import { certRevokeRequestSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { requireSession } from '../lib/requireSession.js';
import { notYetImplementedCaClient, type CaClient } from '../lib/caClient.js';
import { logCertEvent } from '../lib/logger.js';

/**
 * POST /cert/revoke (session required) — marks cert revoked in DB,
 * pushes revocation to CA signing LXC's CRL. "Lost my phone" button in
 * SettingsScreen, per docs/API_SPEC.md.
 */
export function registerCertRevokeRoute(
  app: App,
  caClient: CaClient = notYetImplementedCaClient,
): void {
  app.post(
    '/cert/revoke',
    {
      preHandler: requireSession,
      schema: { body: certRevokeRequestSchema },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const { certId } = request.body;

      const cert = await prisma.clientCert.findFirst({ where: { id: certId, userId } });
      if (!cert) {
        return reply.code(404).send({ error: 'cert not found' });
      }

      await caClient.revoke({ fingerprint: cert.fingerprint });

      await prisma.clientCert.update({
        where: { id: certId },
        data: { revoked: true, revokedAt: new Date() },
      });

      logCertEvent(request.log, { userId, event: 'revoked', certId: cert.fingerprint });

      return reply.code(204).send();
    },
  );
}
