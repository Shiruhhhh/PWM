/**
 * Pure sync-decision logic per SCREENS_UX.md "Sync logic (client side)".
 * Deliberately separated from the Zustand store so it's trivially unit
 * testable without mocking network/store state -- per TESTING.md's call
 * for sync-conflict-resolution unit tests.
 */

export type SyncAction =
  { type: 'noop' } | { type: 'pull' } | { type: 'push' } | { type: 'conflict' };

export interface SyncDecisionInput {
  serverRevision: number;
  lastKnownSyncedRevision: number;
  localDirty: boolean;
}

/**
 * Decides what to do on foreground/resume, per SCREENS_UX.md:
 * - server revision equal to last-known-synced -> no-op (unless local dirty, then push)
 * - server newer, no local dirty -> pull
 * - local dirty, server unchanged -> push
 * - both changed -> conflict (v1: last-write-wins with a warning, decided by the caller)
 */
export function decideSyncAction(input: SyncDecisionInput): SyncAction {
  const serverChanged = input.serverRevision !== input.lastKnownSyncedRevision;

  if (!serverChanged && !input.localDirty) {
    return { type: 'noop' };
  }
  if (serverChanged && !input.localDirty) {
    return { type: 'pull' };
  }
  if (!serverChanged && input.localDirty) {
    return { type: 'push' };
  }
  return { type: 'conflict' };
}

/**
 * v1 conflict resolution: last-write-wins. The caller decides which side
 * "wins" by what it passes as `winner` -- this function only encodes the
 * policy that on conflict, exactly one side's blob is kept, no merge.
 * True per-item merge is deferred (docs/DECISIONS.md "Deferred to v2").
 */
export function resolveConflictLastWriteWins<T>(
  local: T,
  server: T,
  winner: 'local' | 'server',
): T {
  return winner === 'local' ? local : server;
}
