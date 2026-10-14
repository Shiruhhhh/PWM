import { create } from 'zustand';

/**
 * The decrypted vaultKey, memory-only, never persisted -- per
 * CRYPTO_SPEC.md "Master password and vaultKey never leave the client in
 * any form" and SCREENS_UX.md's vaultStore description ("decrypted
 * entries, memory only, cleared on lock/background"). Separate from
 * vaultStore (entries) because vaultKey is needed by screens that don't
 * otherwise touch vault state (e.g. to encrypt before PUT /vault).
 */
interface VaultKeyState {
  vaultKey: Uint8Array | null;
  setVaultKey(key: Uint8Array | null): void;
  clear(): void;
}

export const useVaultKeyStore = create<VaultKeyState>((set) => ({
  vaultKey: null,
  setVaultKey: (vaultKey) => set({ vaultKey }),
  clear: () => set({ vaultKey: null }),
}));
