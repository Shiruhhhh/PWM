/**
 * Self-hosted deployment target. Per PROXMOX_NETWORK.md/DEPLOY.md, each
 * install points at its own server -- not a hardcoded SaaS endpoint. A
 * real v1 build surfaces these as first-run "server address" fields;
 * stored (non-sensitive, just URLs) via nativeStorage once set.
 *
 * Two separate URLs per docs/DECISIONS.md #22's two-listener design:
 * - serverBaseUrl: the public mTLS listener (port 443, DDNS hostname) --
 *   everything except /register and /cert/initial.
 * - bootstrapBaseUrl: the LAN/VPN-only listener (port 8443, LAN IP, e.g.
 *   192.168.1.10:8443) -- only reachable while on the home LAN/VPN, only
 *   ever used for /register and /cert/initial during first-device setup.
 */
import { nativeStorage } from '../native/keystore';

const SERVER_URL_STORAGE_KEY = 'pwm_server_base_url';
const BOOTSTRAP_URL_STORAGE_KEY = 'pwm_bootstrap_base_url';

export async function getServerBaseUrl(): Promise<string | null> {
  return nativeStorage.getItem(SERVER_URL_STORAGE_KEY);
}

export async function setServerBaseUrl(url: string): Promise<void> {
  await nativeStorage.setItem(SERVER_URL_STORAGE_KEY, url);
}

export async function getBootstrapBaseUrl(): Promise<string | null> {
  return nativeStorage.getItem(BOOTSTRAP_URL_STORAGE_KEY);
}

export async function setBootstrapBaseUrl(url: string): Promise<void> {
  await nativeStorage.setItem(BOOTSTRAP_URL_STORAGE_KEY, url);
}
