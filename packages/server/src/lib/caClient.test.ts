import { describe, it, expect, vi } from 'vitest';
import { httpCaClient, CaServiceUnavailableError } from './caClient.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('httpCaClient', () => {
  it('sign() posts CSR params and returns the parsed response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ cert: 'CERT_PEM', fingerprint: 'abc', expiresAt: '2026-01-01T00:00:00Z' }),
      );
    const client = httpCaClient('https://pwm-ca.internal', fetchImpl);

    const result = await client.sign({
      csr: 'CSR_PEM',
      requestingUserId: 'user-1',
      deviceCn: 'device-1',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pwm-ca.internal/sign',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ csr: 'CSR_PEM', requestingUserId: 'user-1', deviceCn: 'device-1' }),
      }),
    );
    expect(result).toEqual({
      cert: 'CERT_PEM',
      fingerprint: 'abc',
      expiresAt: '2026-01-01T00:00:00Z',
    });
  });

  it('sign() throws CaServiceUnavailableError on non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const client = httpCaClient('https://pwm-ca.internal', fetchImpl);

    await expect(client.sign({ csr: 'x', requestingUserId: 'u', deviceCn: 'd' })).rejects.toThrow(
      CaServiceUnavailableError,
    );
  });

  it('revoke() posts fingerprint and returns crlVersion', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ crlVersion: 'v1' }));
    const client = httpCaClient('https://pwm-ca.internal', fetchImpl);

    const result = await client.revoke({ fingerprint: 'fp' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pwm-ca.internal/revoke',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ fingerprint: 'fp' }) }),
    );
    expect(result).toEqual({ crlVersion: 'v1' });
  });

  it('revoke() throws CaServiceUnavailableError on non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    const client = httpCaClient('https://pwm-ca.internal', fetchImpl);

    await expect(client.revoke({ fingerprint: 'fp' })).rejects.toThrow(CaServiceUnavailableError);
  });
});
