import { Agent } from 'undici';

/**
 * Internal mTLS client for pwm-ca (CA signing service), per
 * docs/CA_SERVICE_SPEC.md. Implemented as an injectable interface so
 * routes can be tested without a real CA service.
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
 * Placeholder for environments where `CA_SERVICE_URL` isn't set (e.g. unit
 * tests for routes that don't exercise cert flows). Always fails loudly
 * rather than silently minting fake certs.
 */
export const notYetImplementedCaClient: CaClient = {
  async sign() {
    throw new CaServiceUnavailableError('pwm-ca not configured (CA_SERVICE_URL unset)');
  },
  async revoke() {
    throw new CaServiceUnavailableError('pwm-ca not configured (CA_SERVICE_URL unset)');
  },
};

export interface MtlsClientCertConfig {
  /** PEM client cert, from the manual bootstrap runbook (services/ca/scripts/bootstrap.sh). */
  certPem: string;
  /** PEM client private key, never committed — loaded from disk/secret store at startup. */
  keyPem: string;
  /** PEM CA cert, to verify pwm-ca's own server cert (internal CA, not a public one). */
  caPem: string;
}

/**
 * Real pwm-ca client, per docs/CA_SERVICE_SPEC.md. Talks over the internal
 * mTLS link between pwm-app and pwm-ca (192.168.1.10 -> 192.168.1.11,
 * firewalled per PROXMOX_NETWORK.md). Presents the app-to-CA client cert
 * provisioned by the manual bootstrap runbook on every request — without
 * it, pwm-ca has no way to authenticate the caller for /sign and /revoke.
 */
export function httpCaClient(
  baseUrl: string,
  mtls: MtlsClientCertConfig,
  fetchImpl: typeof fetch = fetch,
): CaClient {
  const dispatcher = new Agent({
    connect: {
      cert: mtls.certPem,
      key: mtls.keyPem,
      ca: mtls.caPem,
    },
  });

  async function request(path: string, body: unknown): Promise<unknown> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // @ts-expect-error -- undici-specific fetch option, not in the lib.dom.d.ts RequestInit type
      dispatcher,
    });
    if (!res.ok) {
      throw new CaServiceUnavailableError(`pwm-ca ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  return {
    async sign({ csr, requestingUserId, deviceCn }) {
      return (await request('/sign', { csr, requestingUserId, deviceCn })) as {
        cert: string;
        fingerprint: string;
        expiresAt: string;
      };
    },

    async revoke({ fingerprint }) {
      return (await request('/revoke', { fingerprint })) as { crlVersion: string };
    },
  };
}
