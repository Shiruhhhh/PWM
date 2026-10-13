/**
 * App-layer CRL cache, per docs/CA_SERVICE_SPEC.md's correction
 * (docs/DECISIONS.md #17) — Caddy has no built-in revocation support,
 * so revoked-cert rejection happens here instead. pwm-app polls
 * GET /crl from pwm-ca periodically and keeps the result in memory.
 */
export interface CrlEntry {
  fingerprint: string;
  revokedAt: string;
}

export class CrlCache {
  private revokedFingerprints = new Set<string>();

  replace(entries: CrlEntry[]): void {
    this.revokedFingerprints = new Set(entries.map((e) => e.fingerprint));
  }

  isRevoked(fingerprint: string): boolean {
    return this.revokedFingerprints.has(fingerprint);
  }
}

export const crlCache = new CrlCache();
