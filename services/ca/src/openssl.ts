import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, rm } from 'node:fs/promises';
import {
  randomBytes,
  createHash,
  createPublicKey,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
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
const APPROVED_EC_CURVES = new Set(['prime256v1', 'secp384r1', 'ed25519', 'ed448']);

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
 * Extracts the CSR's public key via `openssl req -pubkey` and loads it
 * with Node's own `crypto.createPublicKey`, which gives structured
 * `asymmetricKeyType`/`asymmetricKeyDetails` instead of regex-scraping
 * openssl's human-readable `-text` debug dump (fragile across openssl
 * versions/builds).
 */
async function extractPublicKey(csrPath: string): Promise<KeyObject> {
  let stdout: string;
  try {
    const result = await execFileAsync('openssl', ['req', '-in', csrPath, '-noout', '-pubkey']);
    stdout = result.stdout;
  } catch {
    throw new InvalidCsrError();
  }
  try {
    return createPublicKey(stdout);
  } catch {
    throw new InvalidCsrError('CSR public key could not be parsed');
  }
}

/**
 * Validates CSR key strength per CA_SERVICE_SPEC.md ("reject weak keys,
 * e.g. RSA < 2048 or non-approved curve").
 */
export async function validateCsrKeyStrength(csrPem: string): Promise<void> {
  await withTempFile(csrPem, async (csrPath) => {
    const publicKey = await extractPublicKey(csrPath);
    const details = publicKey.asymmetricKeyDetails;

    if (publicKey.asymmetricKeyType === 'rsa') {
      const bits = details?.modulusLength ?? 0;
      if (bits < MIN_RSA_BITS) {
        throw new WeakKeyError(`RSA key too small (${bits} bits, minimum ${MIN_RSA_BITS})`);
      }
      return;
    }

    if (publicKey.asymmetricKeyType === 'ec') {
      const curve = details?.namedCurve;
      if (!curve || !APPROVED_EC_CURVES.has(curve)) {
        throw new WeakKeyError(`unapproved EC curve: ${curve ?? 'unknown'}`);
      }
      return;
    }

    if (publicKey.asymmetricKeyType === 'ed25519' || publicKey.asymmetricKeyType === 'ed448') {
      return;
    }

    throw new WeakKeyError(`unapproved key type: ${publicKey.asymmetricKeyType ?? 'unknown'}`);
  });
}

/**
 * Parses an RFC 2253 distinguished name string into its attribute pairs,
 * honoring backslash-escaped `,`/`+`/`=`/`<`/`>`/`#`/`;`/`\` so a CN
 * containing any of those characters is still extracted correctly
 * (a naive split on `,` truncates at the first escaped comma).
 */
function parseRfc2253Dn(dn: string): Map<string, string> {
  const attrs = new Map<string, string>();
  let key = '';
  let value = '';
  let inValue = false;
  let escaped = false;

  for (const char of dn) {
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (!inValue && char === '=') {
      inValue = true;
      continue;
    }
    if (inValue && (char === ',' || char === '+')) {
      attrs.set(key.trim(), value);
      key = '';
      value = '';
      inValue = false;
      continue;
    }
    if (inValue) {
      value += char;
    } else {
      key += char;
    }
  }
  if (key.trim() !== '') {
    attrs.set(key.trim(), value);
  }
  return attrs;
}

/** Rejects a CSR whose subject CN doesn't match the request body's deviceCn — prevents issuing a cert for an identity the caller didn't ask for. */
export async function validateCsrSubjectCn(csrPem: string, deviceCn: string): Promise<void> {
  await withTempFile(csrPem, async (csrPath) => {
    let stdout: string;
    try {
      const result = await execFileAsync('openssl', [
        'req',
        '-in',
        csrPath,
        '-noout',
        '-subject',
        '-nameopt',
        'RFC2253',
      ]);
      stdout = result.stdout;
    } catch {
      throw new InvalidCsrError();
    }

    // `-subject` output is prefixed with the DN itself (no "subject=" label
    // under -nameopt RFC2253); strip a leading label if openssl adds one.
    const dn = stdout.replace(/^subject\s*=\s*/, '').trim();
    const csrCn = parseRfc2253Dn(dn).get('CN');
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

// The actual openssl sign invocation reads-then-increments the shared
// `${caCertPath()}.srl` serial file; serialize it so concurrent /sign
// calls can't race on that file (which could otherwise issue two certs
// with the same serial number).
let signQueue: Promise<unknown> = Promise.resolve();

/**
 * Validates and signs a CSR with the CA key/cert, expiry per
 * CA_SERVICE_SPEC.md (90 days). Subject CN is whatever the CSR itself
 * carries (validated above to match `deviceCn`).
 */
export async function signCsr(csrPem: string, deviceCn: string): Promise<SignedCert> {
  await validateCsrKeyStrength(csrPem);
  await validateCsrSubjectCn(csrPem, deviceCn);

  const result = signQueue.then(() => signCsrUnsafe(csrPem));
  signQueue = result.catch(() => undefined);
  return result;
}

async function signCsrUnsafe(csrPem: string): Promise<SignedCert> {
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
      // Deliberately NOT deleting `${caCertPath()}.srl` here: it's the CA's
      // shared serial-number counter, meant to persist and increment across
      // every /sign call. Deleting it let concurrent signs race (one
      // request's cleanup removing the file between another's read and
      // write), forcing -CAcreateserial to reinit and risking duplicate
      // cert serials.
      await rm(outPath, { force: true });
    }
  });
}
