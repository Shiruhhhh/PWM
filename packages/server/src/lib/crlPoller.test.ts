import { describe, it, expect, vi, afterEach } from 'vitest';
import { startCrlPoller } from './crlPoller.js';
import { crlCache } from './crlCache.js';
import type { CaClient } from './caClient.js';

/**
 * Regression coverage for docs/DECISIONS.md #27 -- the poller must go
 * through the injected CaClient (same mTLS-presenting connection as
 * sign()/revoke()), never a raw/bare fetch. Before this fix, nothing
 * tested the poller's actual wiring at all, which is how a plain
 * unauthenticated fetch call shipped unnoticed.
 */
function fakeLogger() {
  return { error: vi.fn() } as unknown as import('fastify').FastifyBaseLogger;
}

function fakeCaClient(overrides: Partial<CaClient> = {}): CaClient {
  return {
    sign: vi.fn(),
    revoke: vi.fn(),
    getCrl: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
    ...overrides,
  } as unknown as CaClient;
}

afterEach(() => {
  crlCache.replace([]);
});

describe('startCrlPoller', () => {
  it('calls caClient.getCrl() (not a raw fetch) and populates the cache', async () => {
    const caClient = fakeCaClient({
      getCrl: vi
        .fn()
        .mockResolvedValue([{ fingerprint: 'revoked-1', revokedAt: '2026-01-01T00:00:00Z' }]),
    });
    const logger = fakeLogger();

    const poller = startCrlPoller({ caClient, logger, intervalMs: 60_000 });
    await vi.waitFor(() => expect(caClient.getCrl).toHaveBeenCalledTimes(1));

    expect(crlCache.isRevoked('revoked-1')).toBe(true);
    poller.stop();
  });

  it('logs a structured error and keeps the stale cache on a failed poll', async () => {
    const caClient = fakeCaClient({
      getCrl: vi.fn().mockRejectedValue(new Error('mTLS handshake failed')),
    });
    const logger = fakeLogger();

    const poller = startCrlPoller({ caClient, logger, intervalMs: 60_000 });
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'crl_poll_failed', initial: true }),
      ),
    );
    poller.stop();
  });

  it('stop() prevents further polling', async () => {
    const caClient = fakeCaClient();
    const logger = fakeLogger();

    const poller = startCrlPoller({ caClient, logger, intervalMs: 10 });
    await vi.waitFor(() => expect(caClient.getCrl).toHaveBeenCalled());
    poller.stop();
    const callsAtStop = (caClient.getCrl as ReturnType<typeof vi.fn>).mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(caClient.getCrl).toHaveBeenCalledTimes(callsAtStop);
  });
});
