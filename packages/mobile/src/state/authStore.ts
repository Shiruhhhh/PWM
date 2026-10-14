import { create } from 'zustand';

export type Screen =
  'setup' | 'login' | 'vaultList' | 'entryDetail' | 'entryEdit' | 'settings' | 'recovery';

interface AuthState {
  screen: Screen;
  sessionToken: string | null;
  userId: string | null;
  username: string | null;
  biometricEnrolled: boolean;
  /** In-memory only, per SCREENS_UX.md "App lifecycle" #2 -- never persisted. */
  consecutiveBiometricFailures: number;
  /** Which entry EntryDetailScreen/EntryEditScreen should show -- null means "new entry" on EntryEditScreen. */
  selectedEntryId: string | null;

  setScreen(screen: Screen): void;
  navigateToEntry(entryId: string | null, screen: 'entryDetail' | 'entryEdit'): void;
  setSession(params: { sessionToken: string; userId: string; username: string }): void;
  clearSession(): void;
  setBiometricEnrolled(enrolled: boolean): void;
  recordBiometricFailure(): void;
  resetBiometricFailures(): void;
}

/** Per SCREENS_UX.md "App lifecycle" #2: after 3 consecutive failures, skip biometric retries for that unlock attempt. */
export const MAX_CONSECUTIVE_BIOMETRIC_FAILURES = 3;

export const useAuthStore = create<AuthState>((set) => ({
  screen: 'login',
  sessionToken: null,
  userId: null,
  username: null,
  biometricEnrolled: false,
  consecutiveBiometricFailures: 0,
  selectedEntryId: null,

  setScreen: (screen) => set({ screen }),

  navigateToEntry: (entryId, screen) => set({ selectedEntryId: entryId, screen }),

  setSession: ({ sessionToken, userId, username }) =>
    set({ sessionToken, userId, username, consecutiveBiometricFailures: 0 }),

  clearSession: () => set({ sessionToken: null, userId: null, username: null, screen: 'login' }),

  setBiometricEnrolled: (enrolled) => set({ biometricEnrolled: enrolled }),

  recordBiometricFailure: () =>
    set((state) => ({ consecutiveBiometricFailures: state.consecutiveBiometricFailures + 1 })),

  resetBiometricFailures: () => set({ consecutiveBiometricFailures: 0 }),
}));

/** Pure helper (no store access) -- whether to keep offering biometric retry for this unlock attempt. */
export function shouldOfferBiometric(consecutiveFailures: number): boolean {
  return consecutiveFailures < MAX_CONSECUTIVE_BIOMETRIC_FAILURES;
}
