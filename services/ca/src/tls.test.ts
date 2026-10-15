import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Agent, fetch as undiciFetch } from 'undici';
import { buildApp } from './app.js';

/**
 * Real end-to-end mTLS test over an actual network listener (not
 * `.inject()`, which bypasses TLS entirely) -- verifies the gap found
 * during Phase 6 deploy (docs/DECISIONS.md #25): pwm-ca's HTTPS listener
 * must present a valid server cert AND reject any connection without a
 * client cert signed by the same CA, matching docs/CA_SERVICE_SPEC.md's
 * "internal mTLS" requirement and packages/server/src/lib/caClient.ts's
 * existing mTLS-presenting design.
 */
const execFileAsync = promisify(execFile);

let app: FastifyInstance;
let dir: string;
let port: number;
let caCertPem: string;
let clientCertPem: string;
let clientKeyPem: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-ca-tls-test-'));
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
  caCertPem = await readFile(join(dir, 'ca.crt'), 'utf8');

  // Server cert, SAN IP:127.0.0.1 -- the test connects to the loopback
  // listener, so the SAN has to match that, not pwm-ca's real static IP.
  await execFileAsync('openssl', [
    'req',
    '-new',
    '-newkey',
    'ed25519',
    '-noenc',
    '-keyout',
    join(dir, 'server.key'),
    '-out',
    join(dir, 'server.csr'),
    '-subj',
    '/CN=pwm-ca',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ]);
  await execFileAsync('openssl', [
    'x509',
    '-req',
    '-in',
    join(dir, 'server.csr'),
    '-CA',
    join(dir, 'ca.crt'),
    '-CAkey',
    join(dir, 'ca.key'),
    '-CAcreateserial',
    '-days',
    '1',
    '-sha256',
    '-copy_extensions',
    'copy',
    '-out',
    join(dir, 'server.crt'),
  ]);

  // Client cert, signed by the same CA -- stands in for pwm-app's
  // bootstrap-provisioned client cert.
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
    '-sha256',
    '-out',
    join(dir, 'client.crt'),
  ]);
  clientCertPem = await readFile(join(dir, 'client.crt'), 'utf8');
  clientKeyPem = await readFile(join(dir, 'client.key'), 'utf8');

  const serverCertPem = await readFile(join(dir, 'server.crt'), 'utf8');
  const serverKeyPem = await readFile(join(dir, 'server.key'), 'utf8');

  app = buildApp({
    https: {
      cert: serverCertPem,
      key: serverKeyPem,
      ca: caCertPem,
      requestCert: true,
      rejectUnauthorized: true,
    },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a network listener address');
  }
  port = address.port;
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
  delete process.env.CA_DATA_DIR;
});

describe('pwm-ca HTTPS/mTLS listener', () => {
  it('accepts a request presenting a client cert signed by the trusted CA', async () => {
    const dispatcher = new Agent({
      connect: { cert: clientCertPem, key: clientKeyPem, ca: caCertPem },
    });
    const res = await undiciFetch(`https://127.0.0.1:${port}/health`, { dispatcher });
    expect(res.status).toBe(200);
    await dispatcher.close();
  });

  it('rejects a request with no client cert at all', async () => {
    const dispatcher = new Agent({ connect: { ca: caCertPem } });
    await expect(undiciFetch(`https://127.0.0.1:${port}/health`, { dispatcher })).rejects.toThrow();
    await dispatcher.close();
  });

  it('rejects a request with a client cert NOT signed by the trusted CA', async () => {
    await execFileAsync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'ed25519',
      '-noenc',
      '-days',
      '1',
      '-keyout',
      join(dir, 'other-ca.key'),
      '-out',
      join(dir, 'other-ca.crt'),
      '-subj',
      '/CN=Other CA',
    ]);
    await execFileAsync('openssl', [
      'req',
      '-new',
      '-newkey',
      'ed25519',
      '-noenc',
      '-keyout',
      join(dir, 'untrusted-client.key'),
      '-out',
      join(dir, 'untrusted-client.csr'),
      '-subj',
      '/CN=impostor',
    ]);
    await execFileAsync('openssl', [
      'x509',
      '-req',
      '-in',
      join(dir, 'untrusted-client.csr'),
      '-CA',
      join(dir, 'other-ca.crt'),
      '-CAkey',
      join(dir, 'other-ca.key'),
      '-CAcreateserial',
      '-days',
      '1',
      '-sha256',
      '-out',
      join(dir, 'untrusted-client.crt'),
    ]);
    const untrustedCertPem = await readFile(join(dir, 'untrusted-client.crt'), 'utf8');
    const untrustedKeyPem = await readFile(join(dir, 'untrusted-client.key'), 'utf8');

    const dispatcher = new Agent({
      connect: { cert: untrustedCertPem, key: untrustedKeyPem, ca: caCertPem },
    });
    await expect(undiciFetch(`https://127.0.0.1:${port}/health`, { dispatcher })).rejects.toThrow();
    await dispatcher.close();
  });
});
