import type { FastifyBaseLogger } from 'fastify';
import { crlCache } from './crlCache.js';
import type { CaClient } from './caClient.js';

/**
 * Polls pwm-ca's GET /crl periodically, per docs/CA_SERVICE_SPEC.md.
 * Takes a CaClient (not a raw URL/fetch) so this reuses the exact same
 * mTLS-presenting connection sign()/revoke() use — GET /crl is behind
 * the same "internal mTLS" requirement as every other pwm-ca endpoint,
 * not exempt just because it's a read. See docs/DECISIONS.md #27.
 */
export interface CrlPollerOptions {
  caClient: CaClient;
  logger: FastifyBaseLogger;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 min, per docs/CA_SERVICE_SPEC.md

export function startCrlPoller(options: CrlPollerOptions): { stop(): void } {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  async function poll(): Promise<void> {
    const entries = await options.caClient.getCrl();
    crlCache.replace(entries);
  }

  const timer = setInterval(() => {
    poll().catch((err: unknown) => {
      // Stale CRL is safer than crashing the app — log and keep the
      // last-known-good cache until the next successful poll.
      options.logger.error({ event: 'crl_poll_failed', err });
    });
  }, intervalMs);

  poll().catch((err: unknown) => {
    options.logger.error({ event: 'crl_poll_failed', initial: true, err });
  });

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
