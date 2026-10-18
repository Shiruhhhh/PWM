jest.mock('../../specs/NativeMtlsClient', () => ({
  __esModule: true,
  default: {
    generateKeyAndCsr: jest.fn(),
    installCert: jest.fn(),
    isClientCertInstalled: jest.fn(),
    getActiveCertInfo: jest.fn(),
    deleteKeyAlias: jest.fn(),
    request: jest.fn(),
    bootstrapRequest: jest.fn(),
    downloadToFile: jest.fn(),
  },
}));
jest.mock('../../specs/NativeAppInfo', () => ({
  __esModule: true,
  default: {
    getInstalledVersionCode: jest.fn(),
    installApk: jest.fn(),
    getCacheDir: jest.fn(),
  },
}));
jest.mock('./config', () => ({
  getServerBaseUrl: jest.fn(),
}));

import NativeMtlsClient from '../../specs/NativeMtlsClient';
import NativeAppInfo from '../../specs/NativeAppInfo';
import { getServerBaseUrl } from './config';
import { checkForUpdate } from './appUpdate';
import { useUpdateStore } from '../state/updateStore';

const mockGetServerBaseUrl = getServerBaseUrl as jest.MockedFunction<typeof getServerBaseUrl>;
const mockGetInstalledVersionCode = NativeAppInfo.getInstalledVersionCode as jest.MockedFunction<
  typeof NativeAppInfo.getInstalledVersionCode
>;
const mockRequest = NativeMtlsClient.request as jest.MockedFunction<
  typeof NativeMtlsClient.request
>;

beforeEach(() => {
  useUpdateStore.setState({ available: null });
  jest.clearAllMocks();
  mockGetServerBaseUrl.mockResolvedValue('https://pwm.example.com');
});

describe('checkForUpdate', () => {
  it('sets updateStore.available when the server reports a newer versionCode', async () => {
    mockGetInstalledVersionCode.mockResolvedValue(1);
    mockRequest.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ versionCode: 3, versionName: '1.2.0' }),
      headersJson: '{}',
    });

    await checkForUpdate('session-token');

    expect(useUpdateStore.getState().available).toEqual({ versionCode: 3, versionName: '1.2.0' });
  });

  it('does not set updateStore.available when the server version is not newer', async () => {
    mockGetInstalledVersionCode.mockResolvedValue(5);
    mockRequest.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ versionCode: 5, versionName: '2.0.0' }),
      headersJson: '{}',
    });

    await checkForUpdate('session-token');

    expect(useUpdateStore.getState().available).toBeNull();
  });

  it('does nothing when no server address is configured yet', async () => {
    mockGetServerBaseUrl.mockResolvedValue(null);

    await checkForUpdate('session-token');

    expect(mockGetInstalledVersionCode).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().available).toBeNull();
  });
});
