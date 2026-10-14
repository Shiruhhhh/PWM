import NativeArgon2 from '../../specs/NativeArgon2';
import type { Argon2Params } from '@pwm/core';
import { bytesToBase64, base64ToBytes } from './base64';

/**
 * Native-module-backed Argon2id, matching packages/core's
 * deriveMasterKey/hashAuthKey signatures (password: string,
 * salt: Uint8Array, params) so call sites read identically to the
 * server's Node implementation. See specs/NativeArgon2.ts.
 */
export async function nativeArgon2Hash(
  password: string,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  const hashBase64 = await NativeArgon2.hash(
    password,
    bytesToBase64(salt),
    params.memoryKiB,
    params.iterations,
    params.parallelism,
    params.hashLength,
  );
  return base64ToBytes(hashBase64);
}
