/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// TurboModules aren't registered in Jest's Node environment (no real
// Android runtime) -- mock the two native modules at the boundary, same
// as cryptoFlows.test.ts does for NativeArgon2 individually. This smoke
// test only exercises the cold-start render path, not real crypto.
jest.mock('../specs/NativeArgon2', () => ({
  __esModule: true,
  default: { hash: jest.fn(async () => '') },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {
    getString: jest.fn(async () => ''),
    setString: jest.fn(),
  },
}));
jest.mock('../specs/NativeKeystore', () => ({
  __esModule: true,
  default: {
    ensureKeyExists: jest.fn(async () => undefined),
    wrapKey: jest.fn(async () => ''),
    unwrapKey: jest.fn(async () => ''),
    deleteKey: jest.fn(async () => undefined),
    isBiometricAvailable: jest.fn(async () => false),
    setItem: jest.fn(async () => undefined),
    getItem: jest.fn(async () => null),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../specs/NativeMtlsClient', () => ({
  __esModule: true,
  default: {
    generateKeyAndCsr: jest.fn(async () => ''),
    installCert: jest.fn(async () => undefined),
    isClientCertInstalled: jest.fn(async () => false),
    getActiveCertInfo: jest.fn(async () => null),
    deleteKeyAlias: jest.fn(async () => undefined),
    request: jest.fn(async () => ({ status: 200, body: '{}', headersJson: '{}' })),
    bootstrapRequest: jest.fn(async () => ({ status: 200, body: '{}', headersJson: '{}' })),
    downloadToFile: jest.fn(async () => 200),
  },
}));
jest.mock('../specs/NativeAppInfo', () => ({
  __esModule: true,
  default: {
    getInstalledVersionCode: jest.fn(async () => 1),
    installApk: jest.fn(async () => undefined),
    getCacheDir: jest.fn(async () => '/tmp/test-cache'),
  },
}));

import App from '../App';

test('renders correctly (cold start, no cached session -> login screen)', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
