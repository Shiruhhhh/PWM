import type { App } from '../types.js';
import { z } from 'zod';
import {
  adminRegistrationRequestSchema,
  adminUsersResponseSchema,
  adminSetUserAdminRequestSchema,
} from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../lib/requireAdmin.js';
import { setRegistrationOpen } from '../lib/serverConfig.js';
import { notYetImplementedCaClient, type CaClient } from '../lib/caClient.js';
import { logCertEvent } from '../lib/logger.js';

/**
 * /admin/* route group (public mTLS listener, is_admin required) per
 * docs/DECISIONS.md #22. No endpoint lets an admin create an account on
 * someone else's behalf -- self-registration (gated by registrationOpen)
 * is the only account-creation path; this group only ever gates/manages.
 */
export function registerAdminRoutes(
  app: App,
  caClient: CaClient = notYetImplementedCaClient,
): void {
  app.patch(
    '/admin/registration',
    {
      preHandler: requireAdmin,
      schema: { body: adminRegistrationRequestSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      await setRegistrationOpen(request.body.open);
      return reply.code(204).send();
    },
  );

  app.get(
    '/admin/users',
    {
      preHandler: requireAdmin,
      schema: { response: { 200: adminUsersResponseSchema } },
    },
    async () => {
      const users = await prisma.user.findMany({
        include: { _count: { select: { clientCerts: true } } },
        orderBy: { createdAt: 'asc' },
      });

      return {
        users: users.map((user) => ({
          id: user.id,
          username: user.username,
          createdAt: user.createdAt.toISOString(),
          certCount: user._count.clientCerts,
          isAdmin: user.isAdmin,
        })),
      };
    },
  );

  app.post(
    '/admin/certs/:certId/revoke',
    {
      preHandler: requireAdmin,
      schema: {
        params: z.object({ certId: z.string().uuid() }),
        response: { 204: z.undefined(), 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const { certId } = request.params;
      // Deliberately NOT scoped to the admin's own userId, unlike the
      // user-facing /cert/revoke -- an admin can revoke any account's cert.
      const cert = await prisma.clientCert.findUnique({ where: { id: certId } });
      if (!cert) {
        return reply.code(404).send({ error: 'cert not found' });
      }

      await caClient.revoke({ fingerprint: cert.fingerprint });

      await prisma.clientCert.update({
        where: { id: certId },
        data: { revoked: true, revokedAt: new Date() },
      });

      logCertEvent(request.log, {
        userId: cert.userId,
        event: 'revoked',
        certId: cert.id,
      });

      return reply.code(204).send();
    },
  );

  app.patch(
    '/admin/users/:id/admin',
    {
      preHandler: requireAdmin,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: adminSetUserAdminRequestSchema,
        response: { 204: z.undefined(), 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await prisma.user.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'user not found' });
      }

      await prisma.user.update({ where: { id }, data: { isAdmin: request.body.isAdmin } });
      return reply.code(204).send();
    },
  );
}
