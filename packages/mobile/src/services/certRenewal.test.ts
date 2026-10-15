jest.mock('../../specs/NativeMtlsClient', () => ({
  __esModule: true,
  default: {
    generateKeyAndCsr: jest.fn(),
    installCert: jest.fn(),
    isClientCertInstalled: jest.fn(),
    getActiveCertInfo: jest.fn(),
    deleteKeyAlias: jest.fn(),
    request: jest.fn(),
  },
}));
jest.mock('../../specs/NativeKeystore', () => ({
  __esModule: true,
  default: {
    ensureKeyExists: jest.fn(),
    wrapKey: jest.fn(),
    unwrapKey: jest.fn(),
    deleteKey: jest.fn(),
    isBiometricAvailable: jest.fn(),
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import { isNearExpiry } from './certRenewal';

describe('isNearExpiry', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('is false when expiry is well in the future', () => {
    expect(isNearExpiry('2026-06-01T00:00:00.000Z', now)).toBe(false);
  });

  it('is true when expiry is within the 14-day threshold', () => {
    expect(isNearExpiry('2026-01-10T00:00:00.000Z', now)).toBe(true);
  });

  it('is true exactly at the 14-day boundary', () => {
    expect(isNearExpiry('2026-01-15T00:00:00.000Z', now)).toBe(true);
  });

  it('is true when already expired', () => {
    expect(isNearExpiry('2025-12-01T00:00:00.000Z', now)).toBe(true);
  });
});
