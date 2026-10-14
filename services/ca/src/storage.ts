import { readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { crlPath, issuanceLogPath } from './config.js';

const crlEntrySchema = z.object({
  fingerprint: z.string(),
  revokedAt: z.string(),
});

export type CrlEntry = z.infer<typeof crlEntrySchema>;

const crlFileSchema = z.array(crlEntrySchema);

export async function readCrl(): Promise<CrlEntry[]> {
  let raw: string;
  try {
    raw = await readFile(crlPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  if (raw.trim() === '') {
    return [];
  }
  return crlFileSchema.parse(JSON.parse(raw));
}

/**
 * Writes via a temp file + rename so a crash mid-write never leaves
 * crl.json truncated/corrupt (this file gates revocation enforcement).
 */
export async function writeCrl(entries: CrlEntry[]): Promise<void> {
  const target = crlPath();
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(entries, null, 2));
  await rename(tmp, target);
}

export async function appendRevocation(entry: CrlEntry): Promise<CrlEntry[]> {
  const entries = await readCrl();
  entries.push(entry);
  await writeCrl(entries);
  return entries;
}

export interface IssuanceLogEntry {
  cn: string;
  fingerprint: string;
  issuedAt: string;
  expiresAt: string;
}

/** Append-only audit trail — never truncated or edited, per CA_SERVICE_SPEC.md. */
export async function appendIssuanceLog(entry: IssuanceLogEntry): Promise<void> {
  await appendFile(issuanceLogPath(), `${JSON.stringify(entry)}\n`, 'utf8');
}

export function crlVersion(entries: CrlEntry[]): string {
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);
}
