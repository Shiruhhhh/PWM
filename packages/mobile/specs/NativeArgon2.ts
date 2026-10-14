import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Native Argon2id hashing, backed by argon2kt (JNI binding over the same
 * P-H-C reference C implementation the server's Node `argon2` package also
 * binds to — same algorithm, same byte output given identical inputs).
 * Needed because Hermes has no native-module support for the `argon2` npm
 * package used by packages/core on the server side — see docs/DECISIONS.md.
 *
 * All binary values cross the bridge as base64 strings (TurboModule codegen
 * doesn't reliably support typed binary arrays across RN versions), matching
 * the base64 convention already used in docs/API_SPEC.md and packages/core.
 */
export interface Spec extends TurboModule {
  /**
   * Computes an Argon2id hash. `passwordUtf8` is the password as a UTF-8
   * string; `saltBase64` and the returned hash are base64. Params match
   * CRYPTO_SPEC.md's Argon2Params shape exactly (memoryKiB, iterations,
   * parallelism, hashLength).
   */
  hash(
    passwordUtf8: string,
    saltBase64: string,
    memoryKiB: number,
    iterations: number,
    parallelism: number,
    hashLengthBytes: number,
  ): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeArgon2');
