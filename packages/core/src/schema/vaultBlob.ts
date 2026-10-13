import { z } from 'zod';

/** Vault blob JSON format per CRYPTO_SPEC.md §4, versioned (DECISIONS.md #3/#14). */
export const vaultEntrySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  username: z.string(),
  password: z.string(),
  url: z.string(),
  notes: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type VaultEntry = z.infer<typeof vaultEntrySchema>;

export const VAULT_BLOB_FORMAT_VERSION = 1;

export const vaultBlobSchema = z.object({
  version: z.literal(VAULT_BLOB_FORMAT_VERSION),
  entries: z.array(vaultEntrySchema),
});

export type VaultBlob = z.infer<typeof vaultBlobSchema>;

export function parseVaultBlob(json: unknown): VaultBlob {
  return vaultBlobSchema.parse(json);
}
