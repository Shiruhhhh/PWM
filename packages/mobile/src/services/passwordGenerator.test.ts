import { generatePassword, InvalidPasswordOptionsError } from './passwordGenerator';

describe('generatePassword', () => {
  it('generates a password of the requested length', () => {
    const pw = generatePassword({
      length: 16,
      upper: true,
      lower: true,
      digits: true,
      symbols: true,
    });
    expect(pw).toHaveLength(16);
  });

  it('only uses characters from enabled charsets', () => {
    const pw = generatePassword({
      length: 200,
      upper: true,
      lower: false,
      digits: false,
      symbols: false,
    });
    expect(pw).toMatch(/^[A-Z]+$/);
  });

  it('respects digits-only charset', () => {
    const pw = generatePassword({
      length: 200,
      upper: false,
      lower: false,
      digits: true,
      symbols: false,
    });
    expect(pw).toMatch(/^[0-9]+$/);
  });

  it('mixes all charsets when all enabled, over a long sample', () => {
    const pw = generatePassword({
      length: 500,
      upper: true,
      lower: true,
      digits: true,
      symbols: true,
    });
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[!@#$%^&*()\-_=+[\]{};:,.<>?]/);
  });

  it('throws if no charset is enabled', () => {
    expect(() =>
      generatePassword({ length: 10, upper: false, lower: false, digits: false, symbols: false }),
    ).toThrow(InvalidPasswordOptionsError);
  });

  it('throws on non-positive or non-integer length', () => {
    expect(() =>
      generatePassword({ length: 0, upper: true, lower: false, digits: false, symbols: false }),
    ).toThrow(InvalidPasswordOptionsError);
    expect(() =>
      generatePassword({ length: -5, upper: true, lower: false, digits: false, symbols: false }),
    ).toThrow(InvalidPasswordOptionsError);
    expect(() =>
      generatePassword({ length: 1.5, upper: true, lower: false, digits: false, symbols: false }),
    ).toThrow(InvalidPasswordOptionsError);
  });

  it('produces different output across calls (not deterministic)', () => {
    const a = generatePassword({
      length: 32,
      upper: true,
      lower: true,
      digits: true,
      symbols: true,
    });
    const b = generatePassword({
      length: 32,
      upper: true,
      lower: true,
      digits: true,
      symbols: true,
    });
    expect(a).not.toBe(b);
  });
});
