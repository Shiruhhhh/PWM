import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';
import { requireSession } from './requireSession.js';

const GENERIC_FORBIDDEN = { error: 'forbidden' } as const;

/**
 * Guard for /admin/* routes: valid session + valid mTLS cert (already
 * enforced by the public listener's require_and_verify) + is_admin on
 * the session's user. Per docs/DECISIONS.md #22: non-admin authenticated
 * users get a generic 403 -- don't leak that admin routes exist beyond
 * the 403 itself.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireSession(request, reply);
  if (reply.sent) {
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: request.userId! } });
  if (!user?.isAdmin) {
    return reply.code(403).send(GENERIC_FORBIDDEN);
  }
}
