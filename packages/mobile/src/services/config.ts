/**
 * Self-hosted deployment target. Per PROXMOX_NETWORK.md/DEPLOY.md, each
 * install points at its own server -- not a hardcoded SaaS endpoint. A
 * real v1 build surfaces this as a first-run "server address" field;
 * stored (non-sensitive, just a URL) via nativeStorage once set.
 */
import { nativeStorage } from '../native/keystore';

const SERVER_URL_STORAGE_KEY = 'pwm_server_base_url';

export async function getServerBaseUrl(): Promise<string | null> {
  return nativeStorage.getItem(SERVER_URL_STORAGE_KEY);
}

export async function setServerBaseUrl(url: string): Promise<void> {
  await nativeStorage.setItem(SERVER_URL_STORAGE_KEY, url);
}
