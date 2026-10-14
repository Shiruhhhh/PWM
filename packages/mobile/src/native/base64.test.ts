import { bytesToBase64, base64ToBytes } from './base64';

describe('base64 codec', () => {
  it('round-trips empty input', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(base64ToBytes('')).toEqual(new Uint8Array([]));
  });

  it('round-trips arbitrary byte lengths (1, 2, 3 mod-3 cases)', () => {
    const cases = [
      new Uint8Array([1]),
      new Uint8Array([1, 2]),
      new Uint8Array([1, 2, 3]),
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array(Array.from({ length: 32 }, (_, i) => i * 7)),
    ];
    for (const bytes of cases) {
      const encoded = bytesToBase64(bytes);
      expect(base64ToBytes(encoded)).toEqual(bytes);
    }
  });

  it('matches known base64 answers', () => {
    expect(bytesToBase64(new Uint8Array([102, 111, 111]))).toBe('Zm9v'); // "foo"
    expect(bytesToBase64(new Uint8Array([102, 111]))).toBe('Zm8='); // "fo"
    expect(bytesToBase64(new Uint8Array([102]))).toBe('Zg=='); // "f"
  });

  it('decodes known base64 answers', () => {
    expect(base64ToBytes('Zm9v')).toEqual(new Uint8Array([102, 111, 111]));
    expect(base64ToBytes('Zm8=')).toEqual(new Uint8Array([102, 111]));
    expect(base64ToBytes('Zg==')).toEqual(new Uint8Array([102]));
  });

  it('round-trips random bytes across many lengths', () => {
    for (let len = 0; len < 64; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 31 + 7) % 256;
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });
});
