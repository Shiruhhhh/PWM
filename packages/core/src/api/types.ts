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

// POST /register
export const registerRequestSchema = z.object({
  username: z.string(),
  clientSalt: z.string(), // base64
  kdfParams: kdfParamsSchema,
  authHash: z.string(), // base64
  wrappedVaultKeyPassword: z.string(), // base64
  wrappedVaultKeyRecovery: z.string(), // base64
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const registerResponseSchema = z.object({
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

// POST /cert/renew
export const certRenewRequestSchema = z.object({
  csr: z.string(),
});
export type CertRenewRequest = z.infer<typeof certRenewRequestSchema>;

export const certRenewResponseSchema = z.object({
  newCert: z.string(),
});
export type CertRenewResponse = z.infer<typeof certRenewResponseSchema>;

// POST /cert/revoke
export const certRevokeRequestSchema = z.object({
  certId: z.string().uuid(),
});
export type CertRevokeRequest = z.infer<typeof certRevokeRequestSchema>;
