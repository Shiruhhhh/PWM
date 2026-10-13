/**
 * Internal mTLS client for pwm-ca (CA signing service), per
 * docs/CA_SERVICE_SPEC.md. Implemented as an injectable interface so
 * routes can be tested without a real CA service — Phase 3 wires the
 * real HTTP+mTLS implementation and the actual pwm-ca base URL/cert config.
 */
export interface CaClient {
  sign(params: {
    csr: string;
    requestingUserId: string;
    deviceCn: string;
  }): Promise<{ cert: string; fingerprint: string; expiresAt: string }>;

  revoke(params: { fingerprint: string }): Promise<{ crlVersion: string }>;
}

export class CaServiceUnavailableError extends Error {
  constructor(message = 'CA signing service unavailable') {
    super(message);
    this.name = 'CaServiceUnavailableError';
  }
}

/**
 * Placeholder until Phase 3's pwm-ca service exists and this is wired to
 * call it over internal mTLS. Always fails loudly rather than silently
 * minting fake certs.
 */
export const notYetImplementedCaClient: CaClient = {
  async sign() {
    throw new CaServiceUnavailableError('pwm-ca not yet implemented (Phase 3)');
  },
  async revoke() {
    throw new CaServiceUnavailableError('pwm-ca not yet implemented (Phase 3)');
  },
};
