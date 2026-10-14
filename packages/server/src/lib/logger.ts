import type { FastifyBaseLogger } from 'fastify';

/**
 * Structured event logging per docs/MONITORING.md — log login attempts,
 * session create/expiry, vault read/write (metadata only), cert events,
 * rate-limit triggers. NEVER log: password, authHash, vaultKey, recovery
 * key, decrypted vault contents, raw cert private keys.
 */

export function logLoginAttempt(
  log: FastifyBaseLogger,
  fields: { username: string; success: boolean },
): void {
  log.info({ event: 'login_attempt', username: fields.username, success: fields.success });
}

export function logSessionCreated(log: FastifyBaseLogger, fields: { userId: string }): void {
  log.info({ event: 'session_created', userId: fields.userId });
}

export function logSessionInvalidated(
  log: FastifyBaseLogger,
  fields: { userId: string; reason: string },
): void {
  log.info({ event: 'session_invalidated', userId: fields.userId, reason: fields.reason });
}

export function logVaultAccess(
  log: FastifyBaseLogger,
  fields: { userId: string; operation: 'read' | 'write'; revision: number },
): void {
  log.info({
    event: 'vault_access',
    userId: fields.userId,
    operation: fields.operation,
    revision: fields.revision,
  });
}

export function logCertEvent(
  log: FastifyBaseLogger,
  fields: { userId: string; event: 'issued' | 'renewed' | 'revoked'; certId: string },
): void {
  log.info({ event: `cert_${fields.event}`, userId: fields.userId, certId: fields.certId });
}

export function logRateLimitTriggered(
  log: FastifyBaseLogger,
  fields: { route: string; ip: string },
): void {
  log.warn({ event: 'rate_limit_triggered', route: fields.route, ip: fields.ip });
}
