import 'react-native-get-random-values';

/**
 * Password generator per SCREENS_UX.md EntryEditScreen: configurable
 * length, charset toggles, cryptographically secure random. Never
 * Math.random() -- see docs/DEPENDENCIES.md "Explicitly avoided".
 * react-native-get-random-values polyfills crypto.getRandomValues,
 * which Hermes lacks natively.
 */

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?';

export interface PasswordGeneratorOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
}

export class InvalidPasswordOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPasswordOptionsError';
  }
}

function buildCharset(options: PasswordGeneratorOptions): string {
  let charset = '';
  if (options.upper) charset += UPPER;
  if (options.lower) charset += LOWER;
  if (options.digits) charset += DIGITS;
  if (options.symbols) charset += SYMBOLS;
  return charset;
}

/**
 * Generates a random password from the selected charsets. Uses rejection
 * sampling (not modulo) against crypto.getRandomValues to avoid modulo
 * bias toward lower charset indices.
 */
export function generatePassword(options: PasswordGeneratorOptions): string {
  if (!Number.isInteger(options.length) || options.length <= 0) {
    throw new InvalidPasswordOptionsError(
      `length must be a positive integer, got ${options.length}`,
    );
  }
  const charset = buildCharset(options);
  if (charset.length === 0) {
    throw new InvalidPasswordOptionsError(
      'at least one charset (upper/lower/digits/symbols) must be enabled',
    );
  }

  const maxValidByte = Math.floor(256 / charset.length) * charset.length - 1;
  const out: string[] = [];
  const buffer = new Uint8Array(1);

  while (out.length < options.length) {
    crypto.getRandomValues(buffer);
    const byte = buffer[0];
    if (byte > maxValidByte) {
      continue; // reject biased values, redraw
    }
    out.push(charset[byte % charset.length]);
  }

  return out.join('');
}
