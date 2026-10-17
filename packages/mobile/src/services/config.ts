/**
 * Self-hosted deployment target. Per PROXMOX_NETWORK.md/DEPLOY.md, each
 * install points at its own server -- not a hardcoded SaaS endpoint.
 * Baked into the APK at build time via react-native-config (packages/mobile/
 * .env, gitignored -- see .env.example), so a normal install never has to
 * touch this. Overridable at runtime (stored via nativeStorage) in case the
 * DDNS host or LAN IP ever changes without a new APK build.
 *
 * Two separate URLs per docs/DECISIONS.md #22's two-listener design:
 * - serverBaseUrl: the public mTLS listener (port 443, DDNS hostname) --
 *   everything except /register and /cert/initial.
 * - bootstrapBaseUrl: the LAN/VPN-only listener (port 8443, LAN IP, e.g.
 *   192.168.1.10:8443) -- only reachable while on the home LAN/VPN, only
 *   ever used for /register and /cert/initial during first-device setup.
 */
import Config from 'react-native-config';
import { nativeStorage } from '../native/keystore';

const SERVER_URL_STORAGE_KEY = 'pwm_server_base_url';
const BOOTSTRAP_URL_STORAGE_KEY = 'pwm_bootstrap_base_url';

export function getDefaultServerBaseUrl(): string | null {
  return Config.SERVER_URL ?? null;
}

export function getDefaultBootstrapBaseUrl(): string | null {
  return Config.BOOTSTRAP_URL ?? null;
}

export async function getServerBaseUrl(): Promise<string | null> {
  const override = await nativeStorage.getItem(SERVER_URL_STORAGE_KEY);
  return override ?? getDefaultServerBaseUrl();
}

export async function setServerBaseUrl(url: string): Promise<void> {
  await nativeStorage.setItem(SERVER_URL_STORAGE_KEY, url);
}

export async function getBootstrapBaseUrl(): Promise<string | null> {
  const override = await nativeStorage.getItem(BOOTSTRAP_URL_STORAGE_KEY);
  return override ?? getDefaultBootstrapBaseUrl();
}

export async function setBootstrapBaseUrl(url: string): Promise<void> {
  await nativeStorage.setItem(BOOTSTRAP_URL_STORAGE_KEY, url);
}

/**
 * Transient bridge for the register-succeeded-but-cert-initial-failed
 * gap: /register (LAN listener) can't be safely retried once the
 * username exists (409 forever), but its session token was never
 * persisted anywhere, so a crash/retry between register and
 * cert/initial had no way back in except re-registering under a new
 * username. Persisted only for the duration of setup; cleared the
 * moment cert/initial succeeds (see SetupScreen.tsx).
 */
const PENDING_SETUP_SESSION_KEY = 'pwm_pending_setup_session';

export interface PendingSetupSession {
  sessionToken: string;
  userId: string;
  username: string;
}

export async function getPendingSetupSession(): Promise<PendingSetupSession | null> {
  const raw = await nativeStorage.getItem(PENDING_SETUP_SESSION_KEY);
  return raw ? (JSON.parse(raw) as PendingSetupSession) : null;
}

export async function setPendingSetupSession(session: PendingSetupSession): Promise<void> {
  await nativeStorage.setItem(PENDING_SETUP_SESSION_KEY, JSON.stringify(session));
}

export async function clearPendingSetupSession(): Promise<void> {
  await nativeStorage.removeItem(PENDING_SETUP_SESSION_KEY);
}
