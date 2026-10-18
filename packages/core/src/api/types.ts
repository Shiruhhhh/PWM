import { z } from 'zod';

/** Shared API request/response types per API_SPEC.md, used by server + mobile. */

export const kdfParamsSchema = z.object({
  algorithm: z.literal('argon2id'),
  memoryKiB: z.number().int().positive(),
  iterations: z.number().int().positive(),
  parallelism: z.number().int().positive(),
});
export type KdfParams = z.infer<typeof kdfParamsSchema>;

// GET /login/params
export const loginParamsResponseSchema = z.object({
  clientSalt: z.string(), // base64
  kdfParams: kdfParamsSchema,
});
export type LoginParamsResponse = z.infer<typeof loginParamsResponseSchema>;

// POST /register (LAN/VPN-only listener)
export const registerRequestSchema = z.object({
  username: z.string(),
  clientSalt: z.string(), // base64
  kdfParams: kdfParamsSchema,
  authHash: z.string(), // base64
  wrappedVaultKeyPassword: z.string(), // base64
  wrappedVaultKeyRecovery: z.string(), // base64
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

// Auto-logs in on success per docs/DECISIONS.md #22 -- same shape as
// POST /login's response, since /login never needs to run on the
// LAN-only listener.
export const registerResponseSchema = z.object({
  sessionToken: z.string(),
  expiresAt: z.string().datetime(),
  wrappedVaultKeyPassword: z.string(), // base64
  userId: z.string().uuid(),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

// POST /login
export const loginRequestSchema = z.object({
  username: z.string(),
  authHash: z.string(), // base64
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  sessionToken: z.string(),
  expiresAt: z.string().datetime(),
  wrappedVaultKeyPassword: z.string(), // base64
  userId: z.string().uuid(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

// GET /vault
export const getVaultResponseSchema = z.object({
  encryptedBlob: z.string(), // base64
  revision: z.number().int(),
  blobFormatVersion: z.number().int(),
});
export type GetVaultResponse = z.infer<typeof getVaultResponseSchema>;

// PUT /vault
export const putVaultRequestSchema = z.object({
  encryptedBlob: z.string(), // base64
  expectedRevision: z.number().int(),
  blobFormatVersion: z.number().int(),
});
export type PutVaultRequest = z.infer<typeof putVaultRequestSchema>;

export const revisionConflictResponseSchema = z.object({
  currentRevision: z.number().int(),
});
export type RevisionConflictResponse = z.infer<typeof revisionConflictResponseSchema>;

// POST /password-change
export const passwordChangeRequestSchema = z.object({
  newClientSalt: z.string(), // base64
  newKdfParams: kdfParamsSchema,
  newAuthHash: z.string(), // base64
  newWrappedVaultKeyPassword: z.string(), // base64
});
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;

// GET /recovery/wrapped-key
export const recoveryWrappedKeyResponseSchema = z.object({
  wrappedVaultKeyRecovery: z.string(), // base64
  blobFormatVersion: z.number().int(),
});
export type RecoveryWrappedKeyResponse = z.infer<typeof recoveryWrappedKeyResponseSchema>;

// POST /recovery/password-change
// No session required -- recovery key itself is the credential (client
// already proved possession locally by successfully unwrapping
// wrappedVaultKeyRecovery before calling this). See docs/DECISIONS.md #20.
export const recoveryPasswordChangeRequestSchema = z.object({
  username: z.string(),
  newClientSalt: z.string(), // base64
  newKdfParams: kdfParamsSchema,
  newAuthHash: z.string(), // base64
  newWrappedVaultKeyPassword: z.string(), // base64
});
export type RecoveryPasswordChangeRequest = z.infer<typeof recoveryPasswordChangeRequestSchema>;

// POST /cert/renew
export const certRenewRequestSchema = z.object({
  csr: z.string(),
});
export type CertRenewRequest = z.infer<typeof certRenewRequestSchema>;

export const certRenewResponseSchema = z.object({
  newCert: z.string(),
  certId: z.string().uuid(),
});
export type CertRenewResponse = z.infer<typeof certRenewResponseSchema>;

// POST /cert/revoke
export const certRevokeRequestSchema = z.object({
  certId: z.string().uuid(),
});
export type CertRevokeRequest = z.infer<typeof certRevokeRequestSchema>;

// POST /cert/initial (LAN/VPN-only listener, session required, no
// existing-cert check -- issues a brand-new device's first cert).
// deviceCn is required here (unlike /cert/renew, which reuses the
// existing cert's stored certCn) -- there's no prior cert row to read
// a CN from yet; the client picks one (a random device identifier) and
// it must match the CSR's own subject CN (services/ca validates that).
export const certInitialRequestSchema = z.object({
  csr: z.string(),
  deviceCn: z.string().min(1),
});
export type CertInitialRequest = z.infer<typeof certInitialRequestSchema>;

export const certInitialResponseSchema = z.object({
  cert: z.string(),
  certId: z.string().uuid(),
});
export type CertInitialResponse = z.infer<typeof certInitialResponseSchema>;

// PATCH /admin/registration
export const adminRegistrationRequestSchema = z.object({
  open: z.boolean(),
});
export type AdminRegistrationRequest = z.infer<typeof adminRegistrationRequestSchema>;

// GET /admin/users
export const adminUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  createdAt: z.string().datetime(),
  certCount: z.number().int(),
  isAdmin: z.boolean(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
});
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

// PATCH /admin/users/:id/admin
export const adminSetUserAdminRequestSchema = z.object({
  isAdmin: z.boolean(),
});
export type AdminSetUserAdminRequest = z.infer<typeof adminSetUserAdminRequestSchema>;

// GET /app/version
export const appVersionResponseSchema = z.object({
  versionCode: z.number().int(),
  versionName: z.string(),
});
export type AppVersionResponse = z.infer<typeof appVersionResponseSchema>;
