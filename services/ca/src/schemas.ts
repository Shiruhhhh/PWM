import { z } from 'zod';

export const signRequestSchema = z.object({
  csr: z.string().min(1),
  requestingUserId: z.string().min(1),
  deviceCn: z.string().min(1),
});

export const signResponseSchema = z.object({
  cert: z.string(),
  fingerprint: z.string(),
  expiresAt: z.string(),
});

export const revokeRequestSchema = z.object({
  fingerprint: z.string().min(1),
});

export const revokeResponseSchema = z.object({
  crlVersion: z.string(),
});

export const crlResponseSchema = z.array(
  z.object({
    fingerprint: z.string(),
    revokedAt: z.string(),
  }),
);

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export const errorResponseSchema = z.object({
  error: z.string(),
});
