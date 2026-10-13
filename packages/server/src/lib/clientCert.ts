import { createHash, X509Certificate } from 'node:crypto';

/**
 * Parses the Client-Cert header Caddy forwards per RFC 9440 (the
 * :base64:-wrapped DER cert — see infra/Caddyfile) and computes its
 * SHA-256 fingerprint, matching docs/CA_SERVICE_SPEC.md's
 * `{ fingerprint, revokedAt }` CRL entry shape.
 */
export function parseClientCertHeader(header: string): { fingerprintSha256: string } | null {
  const match = /^:([A-Za-z0-9+/=]+):$/.exec(header.trim());
  if (!match) {
    return null;
  }

  let der: Buffer;
  try {
    der = Buffer.from(match[1], 'base64');
    new X509Certificate(der); // throws if not a well-formed cert
  } catch {
    return null;
  }

  const fingerprintSha256 = createHash('sha256').update(der).digest('hex');
  return { fingerprintSha256 };
}
