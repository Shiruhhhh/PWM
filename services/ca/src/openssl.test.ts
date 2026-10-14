import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateCsrKeyStrength,
  validateCsrSubjectCn,
  signCsr,
  WeakKeyError,
  InvalidCsrError,
} from './openssl.js';

const execFileAsync = promisify(execFile);

let dir: string;
let goodCsr: string;
let weakCsr: string;
let commaCnCsr: string;
let multiValuedRdnCsr: string;
let caCertDir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-ca-test-'));

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

  await execFileAsync('openssl', [
    'req',
    '-new',
    '-newkey',
    'ed25519',
    '-noenc',
    '-keyout',
    join(dir, 'comma.key'),
    '-out',
    join(dir, 'comma.csr'),
    '-subj',
    '/CN=device\\,with-comma',
  ]);
  commaCnCsr = await readFile(join(dir, 'comma.csr'), 'utf8');

  await execFileAsync('openssl', [
    'req',
    '-new',
    '-newkey',
    'ed25519',
    '-noenc',
    '-keyout',
    join(dir, 'mvrdn.key'),
    '-out',
    join(dir, 'mvrdn.csr'),
    '-subj',
    '/CN=device-mv+O=Foo',
  ]);
  multiValuedRdnCsr = await readFile(join(dir, 'mvrdn.csr'), 'utf8');

  caCertDir = await mkdtemp(join(tmpdir(), 'pwm-ca-authority-'));
  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'ed25519',
    '-noenc',
    '-days',
    '1',
    '-keyout',
    join(caCertDir, 'ca.key'),
    '-out',
    join(caCertDir, 'ca.crt'),
    '-subj',
    '/CN=Test CA',
  ]);
  process.env.CA_DATA_DIR = caCertDir;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(caCertDir, { recursive: true, force: true });
});

describe('validateCsrKeyStrength', () => {
  it('accepts an ed25519 CSR', async () => {
    await expect(validateCsrKeyStrength(goodCsr)).resolves.toBeUndefined();
  });

  it('rejects an RSA-1024 CSR', async () => {
    await expect(validateCsrKeyStrength(weakCsr)).rejects.toThrow(WeakKeyError);
  });

  it('rejects malformed input', async () => {
    await expect(validateCsrKeyStrength('not a csr')).rejects.toThrow(InvalidCsrError);
  });
});

describe('validateCsrSubjectCn', () => {
  it('accepts matching CN', async () => {
    await expect(validateCsrSubjectCn(goodCsr, 'device-good')).resolves.toBeUndefined();
  });

  it('rejects mismatched CN', async () => {
    await expect(validateCsrSubjectCn(goodCsr, 'some-other-device')).rejects.toThrow(
      InvalidCsrError,
    );
  });

  it('matches a CN containing a comma (RFC2253-escaped in openssl output)', async () => {
    await expect(validateCsrSubjectCn(commaCnCsr, 'device,with-comma')).resolves.toBeUndefined();
  });

  it('correctly extracts CN from a multi-valued RDN (CN=x+O=y), not folding O into the CN value', async () => {
    await expect(validateCsrSubjectCn(multiValuedRdnCsr, 'device-mv')).resolves.toBeUndefined();
  });

  it('rejects a multi-valued-RDN CSR against the wrong CN, confirming O was not merged in', async () => {
    await expect(validateCsrSubjectCn(multiValuedRdnCsr, 'device-mv+O=Foo')).rejects.toThrow(
      InvalidCsrError,
    );
  });
});

describe('signCsr', () => {
  it('signs a valid CSR and returns cert, fingerprint, expiresAt', async () => {
    const result = await signCsr(goodCsr, 'device-good');
    expect(result.certPem).toContain('BEGIN CERTIFICATE');
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a weak-key CSR without signing', async () => {
    await expect(signCsr(weakCsr, 'device-weak')).rejects.toThrow(WeakKeyError);
  });
});
