import type { FastifyBaseLogger } from 'fastify';
import { crlCache, type CrlEntry } from './crlCache.js';

/** Polls pwm-ca's GET /crl periodically, per docs/CA_SERVICE_SPEC.md. */
export interface CrlPollerOptions {
  caServiceUrl: string;
  logger: FastifyBaseLogger;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 min, per docs/CA_SERVICE_SPEC.md

export function startCrlPoller(options: CrlPollerOptions): { stop(): void } {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function poll(): Promise<void> {
    const res = await fetchImpl(`${options.caServiceUrl}/crl`);
    if (!res.ok) {
      throw new Error(`CRL fetch failed: ${res.status}`);
    }
    const entries = (await res.json()) as CrlEntry[];
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
