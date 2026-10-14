import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  httpCaClient,
  notYetImplementedCaClient,
  CaServiceUnavailableError,
  type MtlsClientCertConfig,
} from './caClient.js';

const execFileAsync = promisify(execFile);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

let dir: string;
let mtls: MtlsClientCertConfig;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-caclient-test-'));

  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'ed25519',
    '-noenc',
    '-days',
    '1',
    '-keyout',
    join(dir, 'ca.key'),
    '-out',
    join(dir, 'ca.crt'),
    '-subj',
    '/CN=Test CA',
  ]);
  await execFileAsync('openssl', [
    'req',
    '-new',
    '-newkey',
    'ed25519',
    '-noenc',
    '-keyout',
    join(dir, 'client.key'),
    '-out',
    join(dir, 'client.csr'),
    '-subj',
    '/CN=pwm-app',
  ]);
  await execFileAsync('openssl', [
    'x509',
    '-req',
    '-in',
    join(dir, 'client.csr'),
    '-CA',
    join(dir, 'ca.crt'),
    '-CAkey',
    join(dir, 'ca.key'),
    '-CAcreateserial',
    '-days',
    '1',
    '-out',
    join(dir, 'client.crt'),
  ]);

  mtls = {
    certPem: await readFile(join(dir, 'client.crt'), 'utf8'),
    keyPem: await readFile(join(dir, 'client.key'), 'utf8'),
    caPem: await readFile(join(dir, 'ca.crt'), 'utf8'),
  };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('httpCaClient', () => {
  it('sign() posts CSR params, presents the client cert via dispatcher, returns the parsed response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ cert: 'CERT_PEM', fingerprint: 'abc', expiresAt: '2026-01-01T00:00:00Z' }),
      );
    const client = httpCaClient('https://pwm-ca.internal', mtls, fetchImpl);

    const result = await client.sign({
      csr: 'CSR_PEM',
      requestingUserId: 'user-1',
      deviceCn: 'device-1',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pwm-ca.internal/sign',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ csr: 'CSR_PEM', requestingUserId: 'user-1', deviceCn: 'device-1' }),
        dispatcher: expect.anything(),
      }),
    );
    expect(result).toEqual({
      cert: 'CERT_PEM',
      fingerprint: 'abc',
      expiresAt: '2026-01-01T00:00:00Z',
    });
  });

  it('sign() throws CaServiceUnavailableError on non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const client = httpCaClient('https://pwm-ca.internal', mtls, fetchImpl);

    await expect(client.sign({ csr: 'x', requestingUserId: 'u', deviceCn: 'd' })).rejects.toThrow(
      CaServiceUnavailableError,
    );
  });

  it('revoke() posts fingerprint and returns crlVersion', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ crlVersion: 'v1' }));
    const client = httpCaClient('https://pwm-ca.internal', mtls, fetchImpl);

    const result = await client.revoke({ fingerprint: 'fp' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pwm-ca.internal/revoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fingerprint: 'fp' }),
        dispatcher: expect.anything(),
      }),
    );
    expect(result).toEqual({ crlVersion: 'v1' });
  });

  it('revoke() throws CaServiceUnavailableError on non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    const client = httpCaClient('https://pwm-ca.internal', mtls, fetchImpl);

    await expect(client.revoke({ fingerprint: 'fp' })).rejects.toThrow(CaServiceUnavailableError);
  });

  it('close() closes the underlying mTLS dispatcher without throwing', async () => {
    const client = httpCaClient('https://pwm-ca.internal', mtls);
    await expect(client.close()).resolves.toBeUndefined();
  });
});

describe('notYetImplementedCaClient', () => {
  it('close() is a no-op that resolves without throwing', async () => {
    await expect(notYetImplementedCaClient.close()).resolves.toBeUndefined();
  });
});
