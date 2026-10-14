/**
 * Minimal base64 codec for crossing the RN bridge (Hermes has neither
 * Node's Buffer nor a global btoa/atob). Only used to shuttle
 * already-encrypted/hashed bytes to and from the native modules —
 * never touches plaintext secrets directly (those stay as Uint8Array
 * until the moment they're handed to a native call).
 */
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += CHARS[b0 >> 2];
    out += CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : CHARS[b2 & 0x3f];
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIdx = 0;

  for (let i = 0; i < clean.length; i += 4) {
    const c0 = CHARS.indexOf(clean[i]);
    const c1 = CHARS.indexOf(clean[i + 1]);
    const c2 = clean[i + 2] === undefined ? -1 : CHARS.indexOf(clean[i + 2]);
    const c3 = clean[i + 3] === undefined ? -1 : CHARS.indexOf(clean[i + 3]);

    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0) out[outIdx++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (c3 >= 0) out[outIdx++] = ((c2 & 0x03) << 6) | c3;
  }
  return out.subarray(0, outIdx);
}
