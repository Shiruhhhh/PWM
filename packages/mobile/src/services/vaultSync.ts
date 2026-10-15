import { createApiClient, RevisionConflictError } from './apiClient';
import { getServerBaseUrl } from './config';
import { encryptVaultBlob, decryptVaultBlob } from './cryptoFlows';
import { useVaultStore } from '../state/vaultStore';
import { useVaultKeyStore } from '../state/vaultKeyStore';
import { useAuthStore } from '../state/authStore';
import { VAULT_BLOB_FORMAT_VERSION } from '@pwm/core';

export class SyncConflictError extends Error {
  constructor() {
    super('vault sync conflict -- server copy was kept (last-write-wins)');
    this.name = 'SyncConflictError';
  }
}

/**
 * Pushes the current local vault state via PUT /vault, per
 * SCREENS_UX.md "Sync logic (client side)". This is the actual wiring
 * that was missing -- vaultStore.upsertEntry/removeEntry only marked
 * `dirty`, nothing called this until now. Call after any local edit
 * (EntryEditScreen save, EntryDetailScreen delete).
 *
 * On a 409 (someone/something else wrote a newer revision first): v1
 * last-write-wins per decision -- pulls the server's current blob,
 * overwrites local state with it, and throws SyncConflictError so the
 * caller can show a warning (per SCREENS_UX.md, the local edit that
 * triggered this push is LOST -- not merged, not retried).
 */
export async function pushVaultIfDirty(): Promise<void> {
  const vaultState = useVaultStore.getState();
  if (!vaultState.dirty) {
    return;
  }

  const vaultKey = useVaultKeyStore.getState().vaultKey;
  const auth = useAuthStore.getState();
  const baseUrl = await getServerBaseUrl();
  if (!vaultKey || !auth.userId || !auth.sessionToken || !baseUrl) {
    return;
  }

  const api = createApiClient({ baseUrl, sessionToken: auth.sessionToken });
  const blob = {
    version: VAULT_BLOB_FORMAT_VERSION as 1,
    entries: vaultState.entries,
  };
  const encryptedBlob = encryptVaultBlob(blob, vaultKey, auth.userId);

  try {
    await api.putVault({
      encryptedBlob,
      expectedRevision: vaultState.lastKnownSyncedRevision,
      blobFormatVersion: VAULT_BLOB_FORMAT_VERSION,
    });
    useVaultStore.getState().markSynced(vaultState.lastKnownSyncedRevision + 1);
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      const serverVault = await api.getVault();
      const serverBlob = decryptVaultBlob(
        serverVault.encryptedBlob,
        vaultKey,
        auth.userId,
        serverVault.blobFormatVersion,
      );
      useVaultStore.getState().setEntries(serverBlob.entries, serverVault.revision);
      throw new SyncConflictError();
    }
    throw err;
  }
}
