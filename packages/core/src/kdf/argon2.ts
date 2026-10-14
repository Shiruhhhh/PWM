import * as argon2 from 'argon2';
import { ARGON2ID_PARAMS, CLIENT_SALT_LENGTH_BYTES, type Argon2Params } from './argon2Params.js';

/**
 * Node-only Argon2id functions (native binding) — NOT exported from
 * packages/core's main index.ts. See argon2Params.ts's docstring for
 * why: Metro can't bundle the `argon2` native package for mobile, so
 * this file is only safe for packages/server and Node-based tests to
 * import directly (import from './kdf/argon2.js' or '@pwm/core/node',
 * not the bare '@pwm/core' barrel).
 */
export { ARGON2ID_PARAMS, CLIENT_SALT_LENGTH_BYTES, type Argon2Params };

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
