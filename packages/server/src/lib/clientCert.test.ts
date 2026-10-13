import { describe, expect, it } from 'vitest';
import { parseClientCertHeader } from './clientCert.js';

// A real, minimal, self-signed X.509 test cert (DER, base64), generated via:
//   openssl req -x509 -newkey ed25519 -keyout /dev/null -out /dev/null \
//     -days 3650 -nodes -subj "/CN=pwm-test-fixture"
// Not tied to any real identity or CA — exists only to be "a well-formed
// X.509 cert" for parseClientCertHeader to validate.
const TEST_CERT_DER_BASE64 =
  'MIIBSjCB/aADAgECAhQduTBZ3jWe/y/OLN+7Dh1drLXzjzAFBgMrZXAwGzEZMBcGA1UEAwwQcHdtLXRlc3QtZml4dHVyZTAeFw0yNjEwMTMyMzAwMTJaFw0zNjEwMTAyMzAwMTJaMBsxGTAXBgNVBAMMEHB3bS10ZXN0LWZpeHR1cmUwKjAFBgMrZXADIQCmwOXbI5y8UsZj1F8a7ZKLMxmC2v10fGK8gnNNNFOuxKNTMFEwHQYDVR0OBBYEFKBH0sOQbhnK86vHXP3YO4Y8rwe+MB8GA1UdIwQYMBaAFKBH0sOQbhnK86vHXP3YO4Y8rwe+MA8GA1UdEwEB/wQFMAMBAf8wBQYDK2VwA0EAeg7/QaBIOq0jFmOnN13Vz0MljTNdB74oBU+sxHHsQtsnsiUN7UIwuBuu5OIzvulU+MB7c4UQFyWHkjIDcQafDA==';

describe('parseClientCertHeader', () => {
  it('rejects a header not wrapped in colons', () => {
    expect(parseClientCertHeader('not-wrapped')).toBeNull();
  });

  it('rejects a header with invalid base64 content', () => {
    expect(parseClientCertHeader(':!!!not-base64!!!:')).toBeNull();
  });

  it('rejects a header whose decoded bytes are not a valid X.509 cert', () => {
    const notACert = Buffer.from('hello world').toString('base64');
    expect(parseClientCertHeader(`:${notACert}:`)).toBeNull();
  });

  it('accepts a well-formed cert header and computes its SHA-256 fingerprint', () => {
    const result = parseClientCertHeader(`:${TEST_CERT_DER_BASE64}:`);
    expect(result).not.toBeNull();
    expect(result?.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same cert bytes always produce the same fingerprint', () => {
    const header = `:${TEST_CERT_DER_BASE64}:`;
    const a = parseClientCertHeader(header);
    const b = parseClientCertHeader(header);
    expect(a?.fingerprintSha256).toBe(b?.fingerprintSha256);
  });

  it('tolerates surrounding whitespace', () => {
    const result = parseClientCertHeader(`  :${TEST_CERT_DER_BASE64}:  `);
    expect(result).not.toBeNull();
  });
});
