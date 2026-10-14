import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCrl, appendRevocation, appendIssuanceLog, crlVersion } from './storage.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-ca-storage-'));
  process.env.CA_DATA_DIR = dir;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.CA_DATA_DIR;
});

describe('readCrl', () => {
  it('returns empty array when crl.json does not exist', async () => {
    expect(await readCrl()).toEqual([]);
  });
});

describe('appendRevocation', () => {
  it('persists a revocation entry and returns the updated list', async () => {
    const entries = await appendRevocation({
      fingerprint: 'abc123',
      revokedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(entries).toEqual([{ fingerprint: 'abc123', revokedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(await readCrl()).toEqual(entries);
  });

  it('accumulates multiple entries across calls', async () => {
    await appendRevocation({ fingerprint: 'one', revokedAt: '2026-01-01T00:00:00.000Z' });
    await appendRevocation({ fingerprint: 'two', revokedAt: '2026-01-02T00:00:00.000Z' });
    const entries = await readCrl();
    expect(entries.map((e) => e.fingerprint)).toEqual(['one', 'two']);
  });

  it('does not lose entries under concurrent calls (read-modify-write race)', async () => {
    const calls = Array.from({ length: 20 }, (_, i) =>
      appendRevocation({ fingerprint: `fp-${i}`, revokedAt: '2026-01-01T00:00:00.000Z' }),
    );
    await Promise.all(calls);
    const entries = await readCrl();
    expect(entries).toHaveLength(20);
    const fingerprints = new Set(entries.map((e) => e.fingerprint));
    expect(fingerprints.size).toBe(20);
  });
});

describe('appendIssuanceLog', () => {
  it('appends JSONL without truncating existing entries', async () => {
    await appendIssuanceLog({
      cn: 'device-a',
      fingerprint: 'fp-a',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-04-01T00:00:00.000Z',
    });
    await appendIssuanceLog({
      cn: 'device-b',
      fingerprint: 'fp-b',
      issuedAt: '2026-01-02T00:00:00.000Z',
      expiresAt: '2026-04-02T00:00:00.000Z',
    });
    const raw = await readFile(join(dir, 'issuance.log'), 'utf8');
    const lines = raw
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].cn).toBe('device-a');
    expect(lines[1].cn).toBe('device-b');
  });
});

describe('crlVersion', () => {
  it('is stable for identical content and changes when content changes', () => {
    const a = [{ fingerprint: 'x', revokedAt: '2026-01-01T00:00:00.000Z' }];
    const b = [{ fingerprint: 'y', revokedAt: '2026-01-01T00:00:00.000Z' }];
    expect(crlVersion(a)).toBe(crlVersion(a));
    expect(crlVersion(a)).not.toBe(crlVersion(b));
  });
});
