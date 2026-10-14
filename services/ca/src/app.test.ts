import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

const execFileAsync = promisify(execFile);

let app: FastifyInstance;
let dir: string;
let goodCsr: string;
let weakCsr: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-ca-app-test-'));
  process.env.CA_DATA_DIR = dir;

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
    join(dir, 'good.key'),
    '-out',
    join(dir, 'good.csr'),
    '-subj',
    '/CN=device-good',
  ]);
  goodCsr = await readFile(join(dir, 'good.csr'), 'utf8');

  await execFileAsync('openssl', [
    'req',
    '-new',
    '-newkey',
    'rsa:1024',
    '-noenc',
    '-keyout',
    join(dir, 'weak.key'),
    '-out',
    join(dir, 'weak.csr'),
    '-subj',
    '/CN=device-weak',
  ]);
  weakCsr = await readFile(join(dir, 'weak.csr'), 'utf8');

  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
  delete process.env.CA_DATA_DIR;
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /sign', () => {
  it('signs a valid CSR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sign',
      payload: { csr: goodCsr, requestingUserId: 'user-1', deviceCn: 'device-good' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cert).toContain('BEGIN CERTIFICATE');
    expect(body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a weak-key CSR with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sign',
      payload: { csr: weakCsr, requestingUserId: 'user-1', deviceCn: 'device-weak' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects mismatched deviceCn with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sign',
      payload: { csr: goodCsr, requestingUserId: 'user-1', deviceCn: 'not-the-csr-cn' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('appends an issuance.log entry on success', async () => {
    await app.inject({
      method: 'POST',
      url: '/sign',
      payload: { csr: goodCsr, requestingUserId: 'user-2', deviceCn: 'device-good' },
    });
    const raw = await readFile(join(dir, 'issuance.log'), 'utf8');
    expect(raw).toContain('device-good');
  });
});

describe('POST /revoke + GET /crl', () => {
  it('adds a fingerprint to the CRL and it is retrievable', async () => {
    const revokeRes = await app.inject({
      method: 'POST',
      url: '/revoke',
      payload: { fingerprint: 'deadbeef' },
    });
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.json().crlVersion).toMatch(/^[0-9a-f]{16}$/);

    const crlRes = await app.inject({ method: 'GET', url: '/crl' });
    expect(crlRes.statusCode).toBe(200);
    const entries = crlRes.json() as Array<{ fingerprint: string }>;
    expect(entries.some((e) => e.fingerprint === 'deadbeef')).toBe(true);
  });
});
