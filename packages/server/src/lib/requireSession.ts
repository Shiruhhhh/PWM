import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';
import { GENERIC_SESSION_ERROR } from './errors.js';
import { SESSION_TTL_DAYS } from './session.js';
import { parseClientCertHeader } from './clientCert.js';
import { crlCache } from './crlCache.js';

/**
 * Session guard for session-required endpoints. Returns 401 uniformly on
 * missing/expired/invalid session, per docs/API_SPEC.md "Error handling
 * conventions" — no further detail leaked.
 *
 * On success, rolls the session's expires_at forward per the rolling
 * 90-day TTL policy (docs/API_SPEC.md "Session TTL policy") and attaches
 * the resolved userId to the request.
 *
 * Also checks the forwarded client cert (Client-Cert header, set by
 * Caddy — see infra/Caddyfile) against the CRL, per
 * docs/CA_SERVICE_SPEC.md's correction (docs/DECISIONS.md #17): stock
 * Caddy verifies a cert chains to our CA but has no revocation support,
 * so the app catches revoked-but-still-CA-trusted certs instead. Caddy
 * is the real enforcement point guaranteeing every real request carries
 * this header — if it's absent (e.g. a direct test/inject call that
 * bypasses Caddy), the check is skipped rather than rejected, since its
 * job is narrowly to catch the revocation gap, not to re-implement mTLS
 * presence enforcement at the app layer.
 */
export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const certHeader = request.headers['client-cert'];
  const certHeaderValue = Array.isArray(certHeader) ? certHeader[0] : certHeader;
  if (certHeaderValue) {
    const parsed = parseClientCertHeader(certHeaderValue);
    if (parsed) {
      const dbCert = await prisma.clientCert.findUnique({
        where: { fingerprint: parsed.fingerprintSha256 },
      });
      if (crlCache.isRevoked(parsed.fingerprintSha256) || dbCert?.revoked) {
        return reply.code(401).send(GENERIC_SESSION_ERROR);
      }
    }
  }

  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  if (!token) {
    return reply.code(401).send(GENERIC_SESSION_ERROR);
  }

  const session = await prisma.session.findUnique({ where: { token } });
  const now = new Date();

  if (!session || session.expiresAt <= now) {
    return reply.code(401).send(GENERIC_SESSION_ERROR);
  }

  const newExpiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.update({
    where: { token },
    data: { expiresAt: newExpiresAt, lastUsedAt: now },
  });

  request.userId = session.userId;
  request.sessionToken = token;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    sessionToken?: string;
  }
}
