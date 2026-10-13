/**
 * AAD encoding for vault blob AES-GCM per CRYPTO_SPEC.md §3: `userId || blobFormatVersion`.
 * userId as UTF-8 bytes, blobFormatVersion as a 4-byte big-endian uint32 —
 * deterministic, unambiguous, room for version growth.
 */
export function buildVaultBlobAad(userId: string, blobFormatVersion: number): Uint8Array {
  const userIdBytes = new TextEncoder().encode(userId);
  const versionBytes = new Uint8Array(4);
  new DataView(versionBytes.buffer).setUint32(0, blobFormatVersion, false);

  const out = new Uint8Array(userIdBytes.length + versionBytes.length);
  out.set(userIdBytes, 0);
  out.set(versionBytes, userIdBytes.length);
  return out;
}
