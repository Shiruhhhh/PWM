import { create } from 'zustand';
import type { VaultEntry } from '@pwm/core';

interface VaultState {
  entries: VaultEntry[];
  revision: number;
  /** Last revision successfully synced with the server (distinct from `revision`, which may be ahead if dirty). */
  lastKnownSyncedRevision: number;
  dirty: boolean;

  setEntries(entries: VaultEntry[], revision: number): void;
  upsertEntry(entry: VaultEntry): void;
  removeEntry(id: string): void;
  markSynced(revision: number): void;
  /** Cleared on lock/background, per SCREENS_UX.md "App lifecycle" #4 -- vault contents never linger in memory while locked. */
  clear(): void;
}

export const useVaultStore = create<VaultState>((set) => ({
  entries: [],
  revision: 0,
  lastKnownSyncedRevision: 0,
  dirty: false,

  setEntries: (entries, revision) =>
    set({ entries, revision, lastKnownSyncedRevision: revision, dirty: false }),

  upsertEntry: (entry) =>
    set((state) => {
      const idx = state.entries.findIndex((e) => e.id === entry.id);
      const entries =
        idx === -1
          ? [...state.entries, entry]
          : state.entries.map((e, i) => (i === idx ? entry : e));
      return { entries, dirty: true };
    }),

  removeEntry: (id) =>
    set((state) => ({
      entries: state.entries.filter((e) => e.id !== id),
      dirty: true,
    })),

  markSynced: (revision) => set({ revision, lastKnownSyncedRevision: revision, dirty: false }),

  clear: () => set({ entries: [], revision: 0, lastKnownSyncedRevision: 0, dirty: false }),
}));
