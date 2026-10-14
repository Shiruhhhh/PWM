/**
 * Argon2id parameter constants/types only — no native binding import.
 * Split out from argon2.ts so packages/mobile (which needs these for
 * its own native Argon2id module call, see docs/DECISIONS.md) can
 * import them without Metro's bundler pulling in the Node-only `argon2`
 * package that argon2.ts imports — Metro bundles a whole module file's
 * top-level imports regardless of which named export is actually used,
 * and Hermes can't run `argon2`'s native binding anyway.
 */

/**
 * Argon2id parameters per CRYPTO_SPEC.md §1. These are the v1 defaults used
 * at registration; per-user `kdfParams` are stored server-side so future
 * tuning doesn't break existing users (see DECISIONS.md #3).
 */
export const ARGON2ID_PARAMS = {
  algorithm: 'argon2id' as const,
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 4,
  hashLength: 32,
} as const;

export interface Argon2Params {
  algorithm: 'argon2id';
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
}

export const CLIENT_SALT_LENGTH_BYTES = 16;
