import { describe, expect, it } from 'vitest';
import {
  generateRecoveryKey,
  mnemonicToRecoveryKey,
  recoveryKeyToMnemonic,
  RECOVERY_KEY_LENGTH_BYTES,
} from './recoveryKey.js';

describe('recovery key generation', () => {
  it('generates 32 random bytes', () => {
    const key = generateRecoveryKey();
    expect(key.length).toBe(RECOVERY_KEY_LENGTH_BYTES);
  });

  it('generates different keys on each call', () => {
    const a = generateRecoveryKey();
    const b = generateRecoveryKey();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe('mnemonic round-trip', () => {
  it('round-trips an arbitrary 32-byte key through a 24-word mnemonic', () => {
    const key = generateRecoveryKey();
    const mnemonic = recoveryKeyToMnemonic(key);
    expect(mnemonic.split(' ')).toHaveLength(24);
    const recovered = mnemonicToRecoveryKey(mnemonic);
    expect(Buffer.from(recovered).equals(Buffer.from(key))).toBe(true);
  });

  it('known-answer: all-zero entropy produces a fixed mnemonic', () => {
    const key = new Uint8Array(32).fill(0);
    const mnemonic = recoveryKeyToMnemonic(key);
    expect(mnemonic).toBe(
      'abandon abandon abandon abandon abandon abandon abandon abandon ' +
        'abandon abandon abandon abandon abandon abandon abandon abandon ' +
        'abandon abandon abandon abandon abandon abandon abandon art',
    );
  });

  it('rejects a mnemonic that fails the BIP39 checksum', () => {
    const key = generateRecoveryKey();
    const mnemonic = recoveryKeyToMnemonic(key);
    const words = mnemonic.split(' ');
    words[0] = words[0] === 'zoo' ? 'zebra' : 'zoo'; // corrupt a word
    const corrupted = words.join(' ');
    expect(() => mnemonicToRecoveryKey(corrupted)).toThrow(/checksum/);
  });

  it('rejects a mnemonic with the wrong word count', () => {
    expect(() => mnemonicToRecoveryKey('abandon abandon abandon')).toThrow();
  });
});
