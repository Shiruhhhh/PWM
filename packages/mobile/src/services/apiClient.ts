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
  CertInitialRequest,
  CertInitialResponse,
  AdminRegistrationRequest,
  AdminUsersResponse,
  AdminSetUserAdminRequest,
} from '@pwm/core';
import { mtlsRequest, bootstrapPinnedRequest, MtlsRequestError } from '../native/mtlsClient';

/**
 * Two separate clients per docs/DECISIONS.md #22's two-listener design:
 * - createBootstrapApiClient: no client cert to present (there isn't one
 *   yet), talks to the LAN/VPN-only listener. Used ONLY for /register
 *   and /cert/initial, during first-device setup. That listener can
 *   never get a publicly-trusted cert (bare port, no hostname), so this
 *   pins against our own internal CA root instead of relying on system
 *   TLS trust -- see docs/DECISIONS.md #28. RN's plain fetch has no way
 *   to do that, so this also goes through the native module, same as
 *   createApiClient below, just with a different (unauthenticated,
 *   pinned) trust path instead of presenting a client cert.
 * - createApiClient: real mTLS (presents the active Keystore-backed
 *   client cert via the native module -- RN's plain fetch can't do
 *   this at all). Talks to the public listener, used for everything else.
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

// ---- Bootstrap client (LAN-only listener, plain TLS, no client cert) ----

export interface BootstrapApiClientConfig {
  baseUrl: string;
  sessionToken?: string;
}

async function bootstrapRequest<T>(
  config: BootstrapApiClientConfig,
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.sessionToken) {
    headers.authorization = `Bearer ${config.sessionToken}`;
  }

  const result = await bootstrapPinnedRequest<T>(
    init.method,
    `${config.baseUrl}${path}`,
    headers,
    init.body,
  );

  if (result.status >= 400) {
    throw new ApiError(`request to ${path} failed: ${result.status}`, result.status, result.json);
  }
  if (result.status === 204) {
    return undefined as T;
  }
  return result.json;
}

export function createBootstrapApiClient(config: BootstrapApiClientConfig) {
  return {
    register: (body: RegisterRequest): Promise<RegisterResponse> =>
      bootstrapRequest(config, '/register', { method: 'POST', body }),

    certInitial: (body: CertInitialRequest): Promise<CertInitialResponse> =>
      bootstrapRequest(config, '/cert/initial', { method: 'POST', body }),
  };
}

export type BootstrapApiClient = ReturnType<typeof createBootstrapApiClient>;

// ---- Main client (public mTLS listener) ----

interface InternalApiClientConfig {
  baseUrl: string;
  sessionToken?: string;
}

async function request<T>(
  config: InternalApiClientConfig,
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.sessionToken) {
    headers.authorization = `Bearer ${config.sessionToken}`;
  }

  try {
    const res = await mtlsRequest<T>(init.method, `${config.baseUrl}${path}`, headers, init.body);
    return res.json;
  } catch (err) {
    if (err instanceof MtlsRequestError && err.status === 409) {
      const body = err.body as RevisionConflictResponse | undefined;
      throw new RevisionConflictError(body?.currentRevision ?? -1);
    }
    if (err instanceof MtlsRequestError) {
      throw new ApiError(`request to ${path} failed: ${err.status}`, err.status ?? 0, err.body);
    }
    throw err;
  }
}

/**
 * Pre-session endpoints only (getLoginParams/login) -- no sessionToken
 * field exists on this config at all, so there's no way to accidentally
 * build one of these and use it for a session-required call (see
 * docs/DECISIONS.md #31 -- that's exactly how LoginScreen.tsx's getVault()
 * call silently sent no Authorization header and 401'd every time).
 */
export interface UnauthenticatedApiClientConfig {
  baseUrl: string;
}

export function createUnauthenticatedApiClient(config: UnauthenticatedApiClientConfig) {
  return {
    getLoginParams: (username: string): Promise<LoginParamsResponse> =>
      request(config, `/login/params?username=${encodeURIComponent(username)}`, { method: 'GET' }),

    login: (body: LoginRequest): Promise<LoginResponse> =>
      request(config, '/login', { method: 'POST', body }),

    // Recovery routes have no requireSession preHandler server-side, by
    // design -- you've forgotten your password, there's no session to
    // have yet (see docs/DECISIONS.md #31's investigation).
    getRecoveryWrappedKey: (username: string): Promise<RecoveryWrappedKeyResponse> =>
      request(config, `/recovery/wrapped-key?username=${encodeURIComponent(username)}`, {
        method: 'GET',
      }),

    recoveryPasswordChange: (body: RecoveryPasswordChangeRequest): Promise<void> =>
      request(config, '/recovery/password-change', { method: 'POST', body }),
  };
}

export type UnauthenticatedApiClient = ReturnType<typeof createUnauthenticatedApiClient>;

/**
 * Every session-required endpoint -- sessionToken is mandatory here (not
 * optional like the old single ApiClientConfig was), so a call site that
 * forgets it is a compile error, not a runtime 401. See docs/DECISIONS.md
 * #31/#3 (code review follow-up).
 */
export interface SessionApiClientConfig {
  baseUrl: string;
  sessionToken: string;
}

export function createSessionApiClient(config: SessionApiClientConfig) {
  return {
    getVault: (): Promise<GetVaultResponse> => request(config, '/vault', { method: 'GET' }),

    putVault: (body: PutVaultRequest): Promise<void> =>
      request(config, '/vault', { method: 'PUT', body }),

    passwordChange: (body: PasswordChangeRequest): Promise<void> =>
      request(config, '/password-change', { method: 'POST', body }),

    certRenew: (body: CertRenewRequest): Promise<CertRenewResponse> =>
      request(config, '/cert/renew', { method: 'POST', body }),

    certRevoke: (body: CertRevokeRequest): Promise<void> =>
      request(config, '/cert/revoke', { method: 'POST', body }),

    adminSetRegistrationOpen: (body: AdminRegistrationRequest): Promise<void> =>
      request(config, '/admin/registration', { method: 'PATCH', body }),

    adminListUsers: (): Promise<AdminUsersResponse> =>
      request(config, '/admin/users', { method: 'GET' }),

    adminRevokeCert: (certId: string): Promise<void> =>
      request(config, `/admin/certs/${encodeURIComponent(certId)}/revoke`, { method: 'POST' }),

    adminSetUserAdmin: (userId: string, body: AdminSetUserAdminRequest): Promise<void> =>
      request(config, `/admin/users/${encodeURIComponent(userId)}/admin`, {
        method: 'PATCH',
        body,
      }),
  };
}

export type SessionApiClient = ReturnType<typeof createSessionApiClient>;
