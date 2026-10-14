import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, caKeyPath, caCertPath } from './config.js';

const execFileAsync = promisify(execFile);

export class WeakKeyError extends Error {
  constructor(message = 'CSR uses a weak or unapproved key') {
    super(message);
    this.name = 'WeakKeyError';
  }
}

export class InvalidCsrError extends Error {
  constructor(message = 'CSR is malformed') {
    super(message);
    this.name = 'InvalidCsrError';
  }
}

const MIN_RSA_BITS = 2048;
const APPROVED_EC_CURVES = new Set(['prime256v1', 'secp384r1', 'ED25519', 'ED448']);

async function withTempFile<T>(contents: string, fn: (path: string) => Promise<T>): Promise<T> {
  const path = join(tmpdir(), `pwm-ca-${randomBytes(8).toString('hex')}.pem`);
  await writeFile(path, contents, { mode: 0o600 });
  try {
    return await fn(path);
  } finally {
    await rm(path, { force: true });
  }
}

/**
 * Validates CSR key strength per CA_SERVICE_SPEC.md ("reject weak keys,
 * e.g. RSA < 2048 or non-approved curve"). Shells out to openssl rather
 * than pulling in node-forge, per docs/DEPENDENCIES.md.
 */
export async function validateCsrKeyStrength(csrPem: string): Promise<void> {
  await withTempFile(csrPem, async (csrPath) => {
    let stdout: string;
    try {
      const result = await execFileAsync('openssl', ['req', '-in', csrPath, '-noout', '-text']);
      stdout = result.stdout;
    } catch {
      throw new InvalidCsrError();
    }

    const rsaMatch = /Public-Key:\s*\((\d+)\s*bit\)/.exec(stdout);
    if (rsaMatch) {
      const bits = Number(rsaMatch[1]);
      if (bits < MIN_RSA_BITS) {
        throw new WeakKeyError(`RSA key too small (${bits} bits, minimum ${MIN_RSA_BITS})`);
      }
      return;
    }

    const curveMatch = /ASN1 OID:\s*(\S+)/.exec(stdout);
    const edMatch = /Public Key Algorithm:\s*(ED25519|ED448)/.exec(stdout);
    const curve = edMatch?.[1] ?? curveMatch?.[1];
    if (!curve || !APPROVED_EC_CURVES.has(curve)) {
      throw new WeakKeyError(`unapproved key type/curve: ${curve ?? 'unknown'}`);
    }
  });
}

/** Rejects a CSR whose subject CN doesn't match the request body's deviceCn — prevents issuing a cert for an identity the caller didn't ask for. */
export async function validateCsrSubjectCn(csrPem: string, deviceCn: string): Promise<void> {
  await withTempFile(csrPem, async (csrPath) => {
    let stdout: string;
    try {
      const result = await execFileAsync('openssl', ['req', '-in', csrPath, '-noout', '-subject']);
      stdout = result.stdout;
    } catch {
      throw new InvalidCsrError();
    }

    const cnMatch = /CN\s*=\s*([^,/\n]+)/.exec(stdout);
    const csrCn = cnMatch?.[1]?.trim();
    if (!csrCn || csrCn !== deviceCn) {
      throw new InvalidCsrError(
        `CSR subject CN (${csrCn ?? 'none'}) does not match deviceCn (${deviceCn})`,
      );
    }
  });
}

export interface SignedCert {
  certPem: string;
  fingerprint: string;
  expiresAt: string;
}

/**
 * Validates and signs a CSR with the CA key/cert, expiry per
 * CA_SERVICE_SPEC.md (90 days). Subject CN is whatever the CSR itself
 * carries (validated above to match `deviceCn`).
 */
export async function signCsr(csrPem: string, deviceCn: string): Promise<SignedCert> {
  await validateCsrKeyStrength(csrPem);
  await validateCsrSubjectCn(csrPem, deviceCn);

  return withTempFile(csrPem, async (csrPath) => {
    const outPath = join(tmpdir(), `pwm-ca-out-${randomBytes(8).toString('hex')}.crt`);
    try {
      await execFileAsync('openssl', [
        'x509',
        '-req',
        '-in',
        csrPath,
        '-CA',
        caCertPath(),
        '-CAkey',
        caKeyPath(),
        '-CAcreateserial',
        '-days',
        String(config.certExpiryDays),
        '-sha256',
        '-out',
        outPath,
      ]);

      const certPem = await readFile(outPath, 'utf8');
      const cert = new X509Certificate(certPem);
      const fingerprint = createHash('sha256').update(cert.raw).digest('hex');
      const expiresAt = new Date(cert.validTo).toISOString();
      return { certPem, fingerprint, expiresAt };
    } finally {
      await rm(outPath, { force: true });
      await rm(`${caCertPath()}.srl`, { force: true }).catch(() => undefined);
    }
  });
}
