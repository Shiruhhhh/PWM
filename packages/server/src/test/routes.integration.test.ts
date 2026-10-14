import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  encrypt,
  decrypt,
  buildVaultBlobAad,
  splitMasterKey,
  wrapVaultKey,
  unwrapVaultKey,
  generateRecoveryKey,
  parseVaultBlob,
  VAULT_BLOB_FORMAT_VERSION,
} from '@pwm/core';
// deriveMasterKey is Node-only (native argon2 binding) -- not exported
// from the main @pwm/core barrel so Metro can bundle @pwm/core for
// mobile without pulling in a package Hermes can't run. Server-side
// code (tests included) imports it from the '@pwm/core/node' subpath.
import { deriveMasterKey } from '@pwm/core/node';
import { createTestContext, teardownTestContext, type TestContext } from './testApp.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
}, 30000);

afterAll(async () => {
  await teardownTestContext(ctx);
});

const CLIENT_SALT = new Uint8Array(16).fill(0x01);
const KDF_PARAMS = {
  algorithm: 'argon2id' as const,
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 4,
};

async function deriveKeys(username: string, password: string) {
  const masterKey = await deriveMasterKey(password, CLIENT_SALT);
  const { vaultKey, authKey, vaultWrapKey } = splitMasterKey(masterKey);
  return { masterKey, vaultKey, authKey, vaultWrapKey };
}

describe('full account lifecycle: register -> login -> vault -> password-change -> recovery', () => {
  const username = `alice-${Date.now()}`;
  const password = 'first-password-123';
  let userId: string;
  let sessionToken: string;
  let recoveryKey: Uint8Array;

  it('registers a new account', async () => {
    const { authKey, vaultKey, vaultWrapKey } = await deriveKeys(username, password);
    recoveryKey = generateRecoveryKey();

    const wrappedByPassword = wrapVaultKey(vaultKey, vaultWrapKey, username);
    const wrappedByRecovery = wrapVaultKey(vaultKey, recoveryKey, username);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/register',
      payload: {
        username,
        clientSalt: Buffer.from(CLIENT_SALT).toString('base64'),
        kdfParams: KDF_PARAMS,
        authHash: Buffer.from(authKey).toString('base64'),
        wrappedVaultKeyPassword: Buffer.from(wrappedByPassword).toString('base64'),
        wrappedVaultKeyRecovery: Buffer.from(wrappedByRecovery).toString('base64'),
      },
    });

    expect(res.statusCode).toBe(200);
    userId = res.json().userId;
    expect(userId).toBeTruthy();
  });

  it('rejects a duplicate username', async () => {
    const { authKey } = await deriveKeys(username, password);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/register',
      payload: {
        username,
        clientSalt: Buffer.from(CLIENT_SALT).toString('base64'),
        kdfParams: KDF_PARAMS,
        authHash: Buffer.from(authKey).toString('base64'),
        wrappedVaultKeyPassword: Buffer.from(new Uint8Array(61)).toString('base64'),
        wrappedVaultKeyRecovery: Buffer.from(new Uint8Array(61)).toString('base64'),
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('GET /login/params returns the real clientSalt for a known user', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/login/params?username=${username}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().clientSalt).toBe(Buffer.from(CLIENT_SALT).toString('base64'));
  });

  it('GET /login/params returns a plausible (fake) response for an unknown user', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/login/params?username=nobody-such-user',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().clientSalt).toBeTruthy();
  });

  it('logs in with correct credentials and gets a session', async () => {
    const { authKey } = await deriveKeys(username, password);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/login',
      payload: { username, authHash: Buffer.from(authKey).toString('base64') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionToken).toBeTruthy();
    sessionToken = body.sessionToken;
  });

  it('rejects login with wrong password, generic error', async () => {
    const { authKey } = await deriveKeys(username, 'wrong-password');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/login',
      payload: { username, authHash: Buffer.from(authKey).toString('base64') },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid credentials' });
  });

  it('rejects login for a nonexistent username with the same generic error', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/login',
      payload: { username: 'nobody-such-user', authHash: 'deadbeef' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid credentials' });
  });

  it('GET /vault without a session returns 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/vault' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /vault with a valid session returns the (empty) vault', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/vault',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision).toBe(0);
  });

  it('PUT /vault writes a new blob and bumps revision', async () => {
    const { vaultKey } = await deriveKeys(username, password);
    const blob = parseVaultBlob({
      version: VAULT_BLOB_FORMAT_VERSION,
      entries: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          title: 'Test',
          username: 'bob',
          password: 'secret',
          url: 'https://example.com',
          notes: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const aad = buildVaultBlobAad(userId, blob.version);
    const encrypted = encrypt(vaultKey, new TextEncoder().encode(JSON.stringify(blob)), aad);

    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/vault',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: {
        encryptedBlob: Buffer.from(encrypted).toString('base64'),
        expectedRevision: 0,
        blobFormatVersion: VAULT_BLOB_FORMAT_VERSION,
      },
    });
    expect(res.statusCode).toBe(204);

    const getRes = await ctx.app.inject({
      method: 'GET',
      url: '/vault',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const body = getRes.json();
    expect(body.revision).toBe(1);

    const decrypted = decrypt(vaultKey, Buffer.from(body.encryptedBlob, 'base64'), aad);
    const roundTripped = parseVaultBlob(JSON.parse(new TextDecoder().decode(decrypted)));
    expect(roundTripped).toEqual(blob);
  });

  it('PUT /vault with a stale expectedRevision returns 409 + currentRevision', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/vault',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: {
        encryptedBlob: Buffer.from(new Uint8Array(29)).toString('base64'),
        expectedRevision: 0, // stale, actual is now 1
        blobFormatVersion: VAULT_BLOB_FORMAT_VERSION,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ currentRevision: 1 });
  });

  it('password-change rotates credentials and invalidates other sessions', async () => {
    const newPassword = 'second-password-456';
    const { authKey: oldAuthKey } = await deriveKeys(username, password);

    // Create a second session to prove it gets invalidated.
    const secondLoginRes = await ctx.app.inject({
      method: 'POST',
      url: '/login',
      payload: { username, authHash: Buffer.from(oldAuthKey).toString('base64') },
    });
    const secondSessionToken = secondLoginRes.json().sessionToken;

    const newMasterKey = await deriveMasterKey(newPassword, CLIENT_SALT);
    const {
      authKey: newAuthKey,
      vaultKey,
      vaultWrapKey: newVaultWrapKey,
    } = splitMasterKey(newMasterKey);
    const newWrappedByPassword = wrapVaultKey(vaultKey, newVaultWrapKey, username);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/password-change',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: {
        newClientSalt: Buffer.from(CLIENT_SALT).toString('base64'),
        newKdfParams: KDF_PARAMS,
        newAuthHash: Buffer.from(newAuthKey).toString('base64'),
        newWrappedVaultKeyPassword: Buffer.from(newWrappedByPassword).toString('base64'),
      },
    });
    expect(res.statusCode).toBe(204);

    // Original session (the one that made the request) still works.
    const stillWorksRes = await ctx.app.inject({
      method: 'GET',
      url: '/vault',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(stillWorksRes.statusCode).toBe(200);

    // Second session was invalidated.
    const invalidatedRes = await ctx.app.inject({
      method: 'GET',
      url: '/vault',
      headers: { authorization: `Bearer ${secondSessionToken}` },
    });
    expect(invalidatedRes.statusCode).toBe(401);

    // Old password no longer works for a fresh login.
    const oldLoginRes = await ctx.app.inject({
      method: 'POST',
      url: '/login',
      payload: { username, authHash: Buffer.from(oldAuthKey).toString('base64') },
    });
    expect(oldLoginRes.statusCode).toBe(401);

    // New password works.
    const newLoginRes = await ctx.app.inject({
      method: 'POST',
      url: '/login',
      payload: { username, authHash: Buffer.from(newAuthKey).toString('base64') },
    });
    expect(newLoginRes.statusCode).toBe(200);
  });

  it('GET /recovery/wrapped-key returns the recovery-wrapped vaultKey for a known user', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/recovery/wrapped-key?username=${username}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.wrappedVaultKeyRecovery).toBeTruthy();

    const unwrapped = unwrapVaultKey(
      Buffer.from(body.wrappedVaultKeyRecovery, 'base64'),
      recoveryKey,
      username,
    );
    expect(unwrapped.length).toBe(32);
  });

  it('GET /recovery/wrapped-key returns a plausible (fake) response for an unknown user', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/recovery/wrapped-key?username=nobody-such-user',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().wrappedVaultKeyRecovery).toBeTruthy();
  });

  it('POST /recovery/password-change resets credentials without a session, new password works after', async () => {
    const recoveredKeyRes = await ctx.app.inject({
      method: 'GET',
      url: `/recovery/wrapped-key?username=${username}`,
    });
    const vaultKey = unwrapVaultKey(
      Buffer.from(recoveredKeyRes.json().wrappedVaultKeyRecovery, 'base64'),
      recoveryKey,
      username,
    );

    const recoveryNewPassword = 'recovered-password-789';
    const recoveryNewMasterKey = await deriveMasterKey(recoveryNewPassword, CLIENT_SALT);
    const { authKey: recoveryNewAuthKey, vaultWrapKey: recoveryNewVaultWrapKey } =
      splitMasterKey(recoveryNewMasterKey);
    const recoveryNewWrappedByPassword = wrapVaultKey(vaultKey, recoveryNewVaultWrapKey, username);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/recovery/password-change',
      // Deliberately NO authorization header -- this is the whole point.
      payload: {
        username,
        newClientSalt: Buffer.from(CLIENT_SALT).toString('base64'),
        newKdfParams: KDF_PARAMS,
        newAuthHash: Buffer.from(recoveryNewAuthKey).toString('base64'),
        newWrappedVaultKeyPassword: Buffer.from(recoveryNewWrappedByPassword).toString('base64'),
      },
    });
    expect(res.statusCode).toBe(204);

    // The old session (from before recovery) is now invalidated too --
    // recovery invalidates ALL sessions, there's no "current" to keep.
    const oldSessionRes = await ctx.app.inject({
      method: 'GET',
      url: '/vault',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(oldSessionRes.statusCode).toBe(401);

    const newLoginRes = await ctx.app.inject({
      method: 'POST',
      url: '/login',
      payload: { username, authHash: Buffer.from(recoveryNewAuthKey).toString('base64') },
    });
    expect(newLoginRes.statusCode).toBe(200);
  });

  it('POST /recovery/password-change returns a generic 401 for an unknown username, not a 404/500', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/recovery/password-change',
      payload: {
        username: 'nobody-such-user',
        newClientSalt: Buffer.from(CLIENT_SALT).toString('base64'),
        newKdfParams: KDF_PARAMS,
        newAuthHash: Buffer.from(new Uint8Array(32)).toString('base64'),
        newWrappedVaultKeyPassword: Buffer.from(new Uint8Array(61)).toString('base64'),
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /health', () => {
  it('returns ok with no auth required', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

// A real, minimal, self-signed X.509 test cert (DER, base64) — same
// fixture as src/lib/clientCert.test.ts. Not tied to any real identity.
const TEST_CERT_DER_BASE64 =
  'MIIBSjCB/aADAgECAhQduTBZ3jWe/y/OLN+7Dh1drLXzjzAFBgMrZXAwGzEZMBcGA1UEAwwQcHdtLXRlc3QtZml4dHVyZTAeFw0yNjEwMTMyMzAwMTJaFw0zNjEwMTAyMzAwMTJaMBsxGTAXBgNVBAMMEHB3bS10ZXN0LWZpeHR1cmUwKjAFBgMrZXADIQCmwOXbI5y8UsZj1F8a7ZKLMxmC2v10fGK8gnNNNFOuxKNTMFEwHQYDVR0OBBYEFKBH0sOQbhnK86vHXP3YO4Y8rwe+MB8GA1UdIwQYMBaAFKBH0sOQbhnK86vHXP3YO4Y8rwe+MA8GA1UdEwEB/wQFMAMBAf8wBQYDK2VwA0EAeg7/QaBIOq0jFmOnN13Vz0MljTNdB74oBU+sxHHsQtsnsiUN7UIwuBuu5OIzvulU+MB7c4UQFyWHkjIDcQafDA==';

describe('revoked client cert rejected on session-required routes', () => {
  const username = `carol-${Date.now()}`;
  const password = 'carol-password-789';
  let sessionToken: string;

  beforeAll(async () => {
    const { authKey, vaultKey, vaultWrapKey } = await deriveKeys(username, password);
    const recoveryKey = generateRecoveryKey();
    const wrappedByPassword = wrapVaultKey(vaultKey, vaultWrapKey, username);
    const wrappedByRecovery = wrapVaultKey(vaultKey, recoveryKey, username);

    await ctx.app.inject({
      method: 'POST',
      url: '/register',
      payload: {
        username,
        clientSalt: Buffer.from(CLIENT_SALT).toString('base64'),
        kdfParams: KDF_PARAMS,
        authHash: Buffer.from(authKey).toString('base64'),
        wrappedVaultKeyPassword: Buffer.from(wrappedByPassword).toString('base64'),
        wrappedVaultKeyRecovery: Buffer.from(wrappedByRecovery).toString('base64'),
      },
    });

    const loginRes = await ctx.app.inject({
      method: 'POST',
      url: '/login',
      payload: { username, authHash: Buffer.from(authKey).toString('base64') },
    });
    sessionToken = loginRes.json().sessionToken;
  });

  it('allows access when the presented cert is not revoked', async () => {
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { username } });
    const fingerprint = createHash('sha256')
      .update(Buffer.from(TEST_CERT_DER_BASE64, 'base64'))
      .digest('hex');

    await ctx.prisma.clientCert.create({
      data: {
        userId: user.id,
        certCn: username,
        fingerprint,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        revoked: false,
      },
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/vault',
      headers: {
        authorization: `Bearer ${sessionToken}`,
        'client-cert': `:${TEST_CERT_DER_BASE64}:`,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects access when the presented cert is marked revoked in the DB', async () => {
    const fingerprint = createHash('sha256')
      .update(Buffer.from(TEST_CERT_DER_BASE64, 'base64'))
      .digest('hex');

    await ctx.prisma.clientCert.update({
      where: { fingerprint },
      data: { revoked: true, revokedAt: new Date() },
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/vault',
      headers: {
        authorization: `Bearer ${sessionToken}`,
        'client-cert': `:${TEST_CERT_DER_BASE64}:`,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('skips the cert check entirely when no Client-Cert header is present', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/vault',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
