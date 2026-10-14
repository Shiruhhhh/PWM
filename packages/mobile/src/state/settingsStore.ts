import { create } from 'zustand';
import { nativeStorage } from '../native/keystore';
import { DEFAULT_IDLE_TIMEOUT_MS, isValidIdleTimeoutMs } from './idleTimer';

const IDLE_TIMEOUT_STORAGE_KEY = 'pwm_settings_idle_timeout_ms';
const BIOMETRIC_PREF_STORAGE_KEY = 'pwm_settings_biometric_enabled';

interface SettingsState {
  idleTimeoutMs: number;
  biometricEnabled: boolean;
  loaded: boolean;

  load(): Promise<void>;
  setIdleTimeoutMs(value: number): Promise<void>;
  setBiometricEnabled(value: boolean): Promise<void>;
}

/**
 * Persisted via the native module's plain on-disk storage (per decision
 * #6's "configurable" requirement) -- not Keystore-wrapped, since these
 * are non-sensitive preferences, not secrets. Explicitly not plain
 * AsyncStorage either (see docs/DEPENDENCIES.md "Explicitly avoided") --
 * routed through the same native storage surface as everything else for
 * consistency, even though encryption-at-rest doesn't matter here.
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
  biometricEnabled: true,
  loaded: false,

  load: async () => {
    const [storedTimeout, storedBiometric] = await Promise.all([
      nativeStorage.getItem(IDLE_TIMEOUT_STORAGE_KEY),
      nativeStorage.getItem(BIOMETRIC_PREF_STORAGE_KEY),
    ]);

    const idleTimeoutMs =
      storedTimeout !== null && isValidIdleTimeoutMs(Number(storedTimeout))
        ? Number(storedTimeout)
        : DEFAULT_IDLE_TIMEOUT_MS;
    const biometricEnabled = storedBiometric === null ? true : storedBiometric === 'true';

    set({ idleTimeoutMs, biometricEnabled, loaded: true });
  },

  setIdleTimeoutMs: async (value) => {
    if (!isValidIdleTimeoutMs(value)) {
      throw new Error(`invalid idle timeout: ${value}`);
    }
    await nativeStorage.setItem(IDLE_TIMEOUT_STORAGE_KEY, String(value));
    set({ idleTimeoutMs: value });
  },

  setBiometricEnabled: async (value) => {
    await nativeStorage.setItem(BIOMETRIC_PREF_STORAGE_KEY, String(value));
    set({ biometricEnabled: value });
  },
}));

export { IDLE_TIMEOUT_STORAGE_KEY, BIOMETRIC_PREF_STORAGE_KEY };
