import { randomBytes } from '@noble/hashes/utils.js';
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

/**
 * Recovery key per CRYPTO_SPEC.md §5: 32 random bytes, shown once as a
 * 24-word BIP39 mnemonic. The mnemonic's entropy IS the recovery key —
 * round-trips exactly, with BIP39's checksum catching transcription errors.
 */
export const RECOVERY_KEY_LENGTH_BYTES = 32;

export function generateRecoveryKey(): Uint8Array {
  return randomBytes(RECOVERY_KEY_LENGTH_BYTES);
}

export function recoveryKeyToMnemonic(recoveryKey: Uint8Array): string {
  if (recoveryKey.length !== RECOVERY_KEY_LENGTH_BYTES) {
    throw new Error(`recoveryKey must be ${RECOVERY_KEY_LENGTH_BYTES} bytes`);
  }
  return entropyToMnemonic(recoveryKey, wordlist);
}

/** Throws if the mnemonic fails BIP39 checksum validation. */
export function mnemonicToRecoveryKey(mnemonic: string): Uint8Array {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('invalid recovery mnemonic (checksum failed)');
  }
  return mnemonicToEntropy(mnemonic, wordlist);
}
