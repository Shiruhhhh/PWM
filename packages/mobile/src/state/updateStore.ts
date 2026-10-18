import { create } from 'zustand';

interface UpdateInfo {
  versionCode: number;
  versionName: string;
}

interface UpdateState {
  /** Set once an update check finds the server has a newer version than installed. Null = no update known, or dismissed. */
  available: UpdateInfo | null;
  setAvailable(info: UpdateInfo | null): void;
  dismiss(): void;
}

/**
 * Update-available banner state, per TASKS.md Phase 7 -- dismissible,
 * non-blocking. Dismissing only clears it for this session's lifetime
 * (in-memory, not persisted); the next launch/foreground check will
 * re-surface it if still outdated, same as checkAndRenewCertIfNeeded's
 * re-check-every-time pattern in certRenewal.ts.
 */
export const useUpdateStore = create<UpdateState>((set) => ({
  available: null,
  setAvailable: (info) => set({ available: info }),
  dismiss: () => set({ available: null }),
}));
