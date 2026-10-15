import { createApiClient } from './apiClient';
import { getServerBaseUrl } from './config';
import { generateCsr, installCert, getActiveCertInfo, deleteKeyAlias } from '../native/mtlsClient';

/** Renew when within this many days of expiry -- certs are issued for 90 days (CA_SERVICE_SPEC.md), renew well before that. */
const RENEWAL_THRESHOLD_DAYS = 14;

export function isNearExpiry(expiresAtIso: string, now: Date = new Date()): boolean {
  const expiresAt = new Date(expiresAtIso);
  const msRemaining = expiresAt.getTime() - now.getTime();
  return msRemaining <= RENEWAL_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Background cert-renewal check per SCREENS_UX.md "Cert renewal": no
 * dedicated screen, checked near expiry, surfaced only as a
 * toast/notification. Call on app foreground/launch while a session is
 * active. Keeps the OLD cert active (per API_SPEC.md's "grace period"
 * note) until the new one is installed and a real authenticated
 * request confirms it actually works, then deletes the old Keystore
 * alias and calls /cert/revoke on it.
 *
 * Returns a short status the caller can surface as a toast, or null if
 * no action was needed.
 */
export async function checkAndRenewCertIfNeeded(sessionToken: string): Promise<string | null> {
  const activeCertInfo = await getActiveCertInfo();
  if (!activeCertInfo || !isNearExpiry(activeCertInfo.expiresAt)) {
    return null;
  }

  const baseUrl = await getServerBaseUrl();
  if (!baseUrl) {
    return null;
  }
  const api = createApiClient({ baseUrl, sessionToken });

  const oldAlias = activeCertInfo.alias;
  const oldCertId = activeCertInfo.certId;
  const { csr, deviceCn, tempAlias: newAlias } = await generateCsr();

  try {
    const result = await api.certRenew({ csr });
    await installCert(newAlias, result.newCert, result.certId);

    // Confirm the new cert actually works end-to-end before touching
    // the old one -- a real authenticated request over the now-active
    // (new) cert.
    await api.getVault();

    await deleteKeyAlias(oldAlias);
    // Revoke the old cert server-side too, per API_SPEC.md's grace-period
    // note -- not just deleting the local Keystore alias.
    await api.certRevoke({ certId: oldCertId });
    return `Device certificate renewed (${deviceCn}).`;
  } catch (err) {
    // New cert install or confirmation failed -- the old alias is still
    // untouched and still installed (installCert only flips the active
    // alias pointer on success), so the app keeps working on the old
    // cert until the next renewal check. Clean up the unused new alias.
    await deleteKeyAlias(newAlias).catch(() => undefined);
    throw err;
  }
}
