import * as argon2 from 'argon2';

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

/**
 * Derives `masterKey` from the master password via Argon2id.
 * `salt` is the per-user client_salt (16 bytes, random, generated at
 * registration, not secret — see CRYPTO_SPEC.md §1).
 */
export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  params: Argon2Params = ARGON2ID_PARAMS,
): Promise<Uint8Array> {
  if (salt.length !== CLIENT_SALT_LENGTH_BYTES) {
    throw new Error(`salt must be ${CLIENT_SALT_LENGTH_BYTES} bytes, got ${salt.length}`);
  }
  const raw = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: params.memoryKiB,
    timeCost: params.iterations,
    parallelism: params.parallelism,
    hashLength: params.hashLength,
    salt: Buffer.from(salt),
    raw: true,
  });
  return new Uint8Array(raw);
}

/**
 * Server-side second Argon2id pass over `authKey`, per CRYPTO_SPEC.md §2.
 * `serverSalt` is separate from the client-side `salt` above, generated
 * and held server-side only.
 */
export async function hashAuthKey(
  authKey: Uint8Array,
  serverSalt: Uint8Array,
  params: Argon2Params = ARGON2ID_PARAMS,
): Promise<Uint8Array> {
  const raw = await argon2.hash(Buffer.from(authKey), {
    type: argon2.argon2id,
    memoryCost: params.memoryKiB,
    timeCost: params.iterations,
    parallelism: params.parallelism,
    hashLength: params.hashLength,
    salt: Buffer.from(serverSalt),
    raw: true,
  });
  return new Uint8Array(raw);
}
