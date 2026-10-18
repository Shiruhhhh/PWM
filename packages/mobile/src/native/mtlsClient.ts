import NativeMtlsClient from '../../specs/NativeMtlsClient';
import { generateUuid } from '../services/uuid';

export class MtlsRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'MtlsRequestError';
  }
}

export class NoCertInstalledError extends Error {
  constructor() {
    super('no active mTLS client cert installed');
    this.name = 'NoCertInstalledError';
  }
}

export interface MtlsResponse<T> {
  status: number;
  json: T;
}

/**
 * Generates a brand-new Keystore keypair (temp alias, discarded unless
 * installCertResult() is called) and returns a PKCS#10 CSR (PEM) for
 * it, with a freshly-generated random deviceCn. Returns both so the
 * caller can send {csr, deviceCn} to /cert/initial or /cert/renew and
 * then install the result -- the alias itself is never exposed beyond
 * this pairing, so callers can't accidentally install the wrong cert
 * onto the wrong key.
 */
export async function generateCsr(): Promise<{ csr: string; deviceCn: string; tempAlias: string }> {
  const tempAlias = `pwm-mtls-${generateUuid()}`;
  const deviceCn = generateUuid();
  const csr = await NativeMtlsClient.generateKeyAndCsr(tempAlias, deviceCn);
  return { csr, deviceCn, tempAlias };
}

/**
 * Installs the CA-signed cert (from /cert/initial or /cert/renew) for a
 * tempAlias produced by generateCsr(). `certId` is the server-assigned
 * ClientCert row id from that same response -- persisted alongside the
 * cert so the device can later call /cert/revoke on its own active
 * cert (SettingsScreen's "forget this device").
 */
export async function installCert(
  tempAlias: string,
  certPem: string,
  certId: string,
): Promise<void> {
  await NativeMtlsClient.installCert(tempAlias, certPem, certId);
}

export async function isClientCertInstalled(): Promise<boolean> {
  return NativeMtlsClient.isClientCertInstalled();
}

export async function getActiveCertInfo(): Promise<{
  expiresAt: string;
  alias: string;
  certId: string;
} | null> {
  return NativeMtlsClient.getActiveCertInfo();
}

export async function deleteKeyAlias(alias: string): Promise<void> {
  await NativeMtlsClient.deleteKeyAlias(alias);
}

/** Downloads a GET response's body straight to a local file -- see specs/NativeMtlsClient.ts's docstring for why this bypasses mtlsRequest()'s JSON-string path. */
export async function mtlsDownloadToFile(
  url: string,
  headers: Record<string, string>,
  destPath: string,
): Promise<number> {
  return NativeMtlsClient.downloadToFile(url, JSON.stringify(headers), destPath);
}

/**
 * Makes an mTLS request presenting the active client cert, per
 * THREAT_MODEL.md / docs/DECISIONS.md #22 -- RN's plain fetch can't
 * present a client cert at all, so this is the real networking path
 * for anything behind the public mTLS listener. Throws
 * NoCertInstalledError if there's no active cert yet (use the
 * LAN-listener-only /register + /cert/initial flow for a brand-new
 * device instead).
 */
export async function mtlsRequest<TResponseBody>(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<MtlsResponse<TResponseBody>> {
  try {
    const result = await NativeMtlsClient.request(
      method,
      url,
      JSON.stringify(headers),
      body === undefined ? null : JSON.stringify(body),
    );

    let json: TResponseBody;
    try {
      json =
        result.body === ''
          ? (undefined as TResponseBody)
          : (JSON.parse(result.body) as TResponseBody);
    } catch {
      throw new MtlsRequestError(`non-JSON response body: ${result.body}`, result.status);
    }

    if (result.status >= 400) {
      // json is already parsed at this point -- attach it so callers
      // (e.g. apiClient.ts's putVault, which needs the 409's
      // currentRevision) don't have to re-fetch or guess.
      throw new MtlsRequestError(`request failed: ${result.status}`, result.status, json);
    }

    return { status: result.status, json };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('no active client cert installed')) {
      throw new NoCertInstalledError();
    }
    throw err;
  }
}

/**
 * Same shape as mtlsRequest above, but for the LAN/VPN-only bootstrap
 * listener (/register, /cert/initial) -- no client cert presented;
 * pins against the bundled internal CA root instead of relying on
 * system TLS trust, since that listener can never get a
 * publicly-trusted cert. See docs/DECISIONS.md #28.
 */
export async function bootstrapPinnedRequest<TResponseBody>(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<MtlsResponse<TResponseBody>> {
  const result = await NativeMtlsClient.bootstrapRequest(
    method,
    url,
    JSON.stringify(headers),
    body === undefined ? null : JSON.stringify(body),
  );

  let json: TResponseBody;
  try {
    json =
      result.body === ''
        ? (undefined as TResponseBody)
        : (JSON.parse(result.body) as TResponseBody);
  } catch {
    throw new MtlsRequestError(`non-JSON response body: ${result.body}`, result.status);
  }

  return { status: result.status, json };
}
