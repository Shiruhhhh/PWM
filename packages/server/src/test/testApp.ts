import type { PrismaClient } from '@prisma/client';
import type { App } from '../types.js';
import { startTestDb, type TestDb } from './pgliteServer.js';

export interface TestContext {
  app: App;
  prisma: PrismaClient;
  testDb: TestDb;
}

/**
 * Spins up an ephemeral PGlite-backed Postgres + a Fastify app wired to
 * it, for integration tests per docs/TESTING.md.
 *
 * `../lib/prisma.js` exports a module-level PrismaClient singleton that
 * reads DATABASE_URL at construction time, and every route imports that
 * singleton directly (not via app decoration). So DATABASE_URL MUST be
 * set before this module (or app.js) is first imported in the test
 * process — vitest's default pool isolates each test file in its own
 * worker/module graph, so setting it here, before the dynamic imports
 * below, is sufficient for one test file to get one isolated DB.
 */
export async function createTestContext(): Promise<TestContext> {
  process.env.ENUMERATION_HMAC_SECRET ??= 'test-secret-not-for-production';

  const testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.databaseUrl;

  const { buildApp } = await import('../app.js');
  const { prisma } = await import('../lib/prisma.js');

  const app: App = buildApp({ logger: false });
  await app.ready();

  return { app, prisma, testDb };
}

export async function teardownTestContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.prisma.$disconnect();
  await ctx.testDb.stop();
}
