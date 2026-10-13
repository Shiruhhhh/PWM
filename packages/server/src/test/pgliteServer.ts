import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'prisma', 'schema.prisma');

/**
 * Ephemeral Postgres-compatible test DB per docs/TESTING.md ("SQLite
 * in-memory or ephemeral Postgres container") — PGlite (WASM Postgres)
 * exposed over a real TCP socket, so Prisma connects via an ordinary
 * DATABASE_URL and gets real Postgres semantics (JSONB, UUID, BYTEA)
 * without Docker. CI/production integration tests still run against a
 * real Postgres container.
 */
export interface TestDb {
  databaseUrl: string;
  stop(): Promise<void>;
}

let nextPort = 55400;

export async function startTestDb(): Promise<TestDb> {
  const port = nextPort++;
  const host = '127.0.0.1';
  const db = new PGlite();
  const server = new PGLiteSocketServer({ db, port, host });
  await server.start();
  // server.start() resolves before the socket is fully ready to handle a
  // real client handshake (observed: Prisma's engine gets ECONNREFUSED
  // immediately after start() otherwise) — small settle delay.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const databaseUrl = `postgresql://postgres:postgres@${host}:${port}/postgres?schema=public`;

  await execFileAsync(
    'pnpm',
    [
      'exec',
      'prisma',
      'db',
      'push',
      `--schema=${SCHEMA_PATH}`,
      '--skip-generate',
      '--accept-data-loss',
    ],
    {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );

  return {
    databaseUrl,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
