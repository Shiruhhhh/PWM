import { prisma } from './prisma.js';

/**
 * The server_config table is meant to hold exactly one row (enforced by
 * a CHECK constraint in the migration SQL -- see
 * prisma/migrations/20261015000000_admin_plane). But `prisma db push`
 * (used by the PGlite test harness, see test/pgliteServer.ts) only
 * applies the declarative schema, not hand-written migration SQL, so
 * the seeded row from the migration never exists in tests. Lazily
 * create it on first access instead of assuming it's always present.
 */
export async function getRegistrationOpen(): Promise<boolean> {
  const config = await prisma.serverConfig.upsert({
    where: { id: true },
    update: {},
    create: { id: true, registrationOpen: true },
  });
  return config.registrationOpen;
}

export async function setRegistrationOpen(open: boolean): Promise<void> {
  await prisma.serverConfig.upsert({
    where: { id: true },
    update: { registrationOpen: open },
    create: { id: true, registrationOpen: open },
  });
}
