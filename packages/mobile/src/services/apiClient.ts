import type {
  LoginParamsResponse,
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  GetVaultResponse,
  PutVaultRequest,
  RevisionConflictResponse,
  PasswordChangeRequest,
  RecoveryWrappedKeyResponse,
  RecoveryPasswordChangeRequest,
  CertRenewRequest,
  CertRenewResponse,
  CertRevokeRequest,
} from '@pwm/core';

/**
 * Thin fetch wrapper over API_SPEC.md's endpoints. mTLS client-cert
 * presentation is handled at the platform networking layer (Android's
 * TLS stack + the cert installed via /cert/renew), not here -- this
 * module only shapes requests/responses to match the zod schemas in
 * packages/core so server and client agree on wire format.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class RevisionConflictError extends ApiError {
  constructor(public readonly currentRevision: number) {
    super('vault revision conflict', 409);
    this.name = 'RevisionConflictError';
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  sessionToken?: string;
}

async function request<T>(
  config: ApiClientConfig,
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.sessionToken) {
    headers.authorization = `Bearer ${config.sessionToken}`;
  }

  const res = await fetch(`${config.baseUrl}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    if (res.status === 409 && body && typeof body === 'object' && 'currentRevision' in body) {
      throw new RevisionConflictError((body as RevisionConflictResponse).currentRevision);
    }
    throw new ApiError(`request to ${path} failed: ${res.status}`, res.status, body);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function createApiClient(config: ApiClientConfig) {
  return {
    getLoginParams: (username: string): Promise<LoginParamsResponse> =>
      request(config, `/login/params?username=${encodeURIComponent(username)}`, { method: 'GET' }),

    register: (body: RegisterRequest): Promise<RegisterResponse> =>
      request(config, '/register', { method: 'POST', body }),

    login: (body: LoginRequest): Promise<LoginResponse> =>
      request(config, '/login', { method: 'POST', body }),

    getVault: (): Promise<GetVaultResponse> => request(config, '/vault', { method: 'GET' }),

    putVault: (body: PutVaultRequest): Promise<void> =>
      request(config, '/vault', { method: 'PUT', body }),

    passwordChange: (body: PasswordChangeRequest): Promise<void> =>
      request(config, '/password-change', { method: 'POST', body }),

    getRecoveryWrappedKey: (username: string): Promise<RecoveryWrappedKeyResponse> =>
      request(config, `/recovery/wrapped-key?username=${encodeURIComponent(username)}`, {
        method: 'GET',
      }),

    recoveryPasswordChange: (body: RecoveryPasswordChangeRequest): Promise<void> =>
      request(config, '/recovery/password-change', { method: 'POST', body }),

    certRenew: (body: CertRenewRequest): Promise<CertRenewResponse> =>
      request(config, '/cert/renew', { method: 'POST', body }),

    certRevoke: (body: CertRevokeRequest): Promise<void> =>
      request(config, '/cert/revoke', { method: 'POST', body }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
