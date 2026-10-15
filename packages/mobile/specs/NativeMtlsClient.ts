import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * mTLS client-cert networking + cert lifecycle, per THREAT_MODEL.md /
 * API_SPEC.md / docs/DECISIONS.md #22. The client cert's private key
 * lives in a SEPARATE Keystore alias from the vaultKey-wrap key
 * (NativeKeystore.ts) and is NOT setUserAuthenticationRequired(true) --
 * this key authenticates the device for every HTTP request, so gating
 * it behind a biometric prompt per-request would be unusable. It's a
 * device-trust credential, not a vault-secrecy one; a plain
 * hardware-backed (StrongBox/TEE where available) hardware key is the
 * right strength for that job.
 *
 * Binary values cross the bridge as base64/PEM strings, same convention
 * as NativeArgon2.ts/NativeKeystore.ts.
 */
export interface Spec extends TurboModule {
  /**
   * Generates a new EC (P-256) keypair in a fresh Keystore alias (never
   * reuses an existing one -- renewal/initial-issuance always gets a
   * brand-new key) and returns a PKCS#10 CSR (PEM) for it, with the
   * given Common Name as the CSR's subject CN. The alias is NOT
   * installed as "the" client cert alias until installCert() is called
   * with the signed result -- this lets the caller discard it (e.g. if
   * the network request to /cert/initial or /cert/renew fails) without
   * ever having touched the active cert.
   */
  generateKeyAndCsr(tempAlias: string, deviceCn: string): Promise<string>;

  /**
   * Installs `certPem` (the CA-signed cert for `tempAlias`'s keypair,
   * from generateKeyAndCsr) as the active client cert used by
   * request()/isClientCertInstalled(). `certId` is the server-assigned
   * ClientCert row id (from /cert/initial or /cert/renew's response) --
   * stored alongside the alias so the device can later call
   * /cert/revoke (which requires it) on its OWN currently-active cert,
   * e.g. from SettingsScreen's "forget this device" action. If an
   * active cert already exists, it's replaced -- the OLD Keystore
   * alias is deliberately NOT deleted here (the caller does that,
   * after confirming the new cert actually works end-to-end and
   * optionally after calling /cert/revoke on the old one -- see
   * docs/API_SPEC.md's cert/renew "grace period" note).
   */
  installCert(tempAlias: string, certPem: string, certId: string): Promise<void>;

  /** Whether an active client cert is installed and ready to present. */
  isClientCertInstalled(): Promise<boolean>;

  /**
   * The active client cert's expiry (ISO 8601), its server-assigned
   * certId, and the Keystore alias currently active, or null if none
   * installed yet.
   */
  getActiveCertInfo(): Promise<{ expiresAt: string; alias: string; certId: string } | null>;

  /** Deletes a Keystore alias (e.g. the old one after a confirmed-working renewal). */
  deleteKeyAlias(alias: string): Promise<void>;

  /**
   * Makes an HTTPS request presenting the active client cert via OkHttp
   * (RN's/Android's plain fetch/URLConnection APIs can't present a
   * client cert at all). Throws if no active cert is installed.
   */
  request(
    method: string,
    url: string,
    headersJson: string,
    body: string | null,
  ): Promise<{ status: number; body: string; headersJson: string }>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeMtlsClient');
