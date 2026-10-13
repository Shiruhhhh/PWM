import { describe, expect, it } from 'vitest';
import { parseVaultBlob, VAULT_BLOB_FORMAT_VERSION } from './vaultBlob.js';

const VALID_ENTRY = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  title: 'Example',
  username: 'alice',
  password: 'hunter2',
  url: 'https://example.com',
  notes: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('vault blob schema', () => {
  it('accepts a valid blob', () => {
    const blob = parseVaultBlob({
      version: VAULT_BLOB_FORMAT_VERSION,
      entries: [VALID_ENTRY],
    });
    expect(blob.entries).toHaveLength(1);
  });

  it('accepts an empty entries array', () => {
    const blob = parseVaultBlob({ version: VAULT_BLOB_FORMAT_VERSION, entries: [] });
    expect(blob.entries).toEqual([]);
  });

  it('rejects a wrong version number', () => {
    expect(() => parseVaultBlob({ version: 99, entries: [] })).toThrow();
  });

  it('rejects an entry with a non-uuid id', () => {
    expect(() =>
      parseVaultBlob({
        version: VAULT_BLOB_FORMAT_VERSION,
        entries: [{ ...VALID_ENTRY, id: 'not-a-uuid' }],
      }),
    ).toThrow();
  });

  it('rejects a missing required field', () => {
    const { title: _title, ...withoutTitle } = VALID_ENTRY;
    expect(() =>
      parseVaultBlob({ version: VAULT_BLOB_FORMAT_VERSION, entries: [withoutTitle] }),
    ).toThrow();
  });

  it('rejects malformed top-level JSON', () => {
    expect(() => parseVaultBlob(null)).toThrow();
    expect(() => parseVaultBlob('not an object')).toThrow();
  });
});
