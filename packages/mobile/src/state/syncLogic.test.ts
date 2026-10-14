import { decideSyncAction, resolveConflictLastWriteWins } from './syncLogic';

describe('decideSyncAction', () => {
  it('no-ops when server revision matches last-known-synced and nothing is dirty', () => {
    expect(
      decideSyncAction({ serverRevision: 5, lastKnownSyncedRevision: 5, localDirty: false }),
    ).toEqual({ type: 'noop' });
  });

  it('pulls when server is newer and nothing local is dirty', () => {
    expect(
      decideSyncAction({ serverRevision: 6, lastKnownSyncedRevision: 5, localDirty: false }),
    ).toEqual({ type: 'pull' });
  });

  it('pushes when local is dirty and server is unchanged', () => {
    expect(
      decideSyncAction({ serverRevision: 5, lastKnownSyncedRevision: 5, localDirty: true }),
    ).toEqual({ type: 'push' });
  });

  it('flags a conflict when both server and local have changed', () => {
    expect(
      decideSyncAction({ serverRevision: 6, lastKnownSyncedRevision: 5, localDirty: true }),
    ).toEqual({ type: 'conflict' });
  });

  it('treats a server revision that moved backward as "changed" too (still pull, not noop)', () => {
    expect(
      decideSyncAction({ serverRevision: 4, lastKnownSyncedRevision: 5, localDirty: false }),
    ).toEqual({ type: 'pull' });
  });
});

describe('resolveConflictLastWriteWins', () => {
  it('keeps the local blob when local wins', () => {
    expect(resolveConflictLastWriteWins('local-blob', 'server-blob', 'local')).toBe('local-blob');
  });

  it('keeps the server blob when server wins', () => {
    expect(resolveConflictLastWriteWins('local-blob', 'server-blob', 'server')).toBe('server-blob');
  });
});
