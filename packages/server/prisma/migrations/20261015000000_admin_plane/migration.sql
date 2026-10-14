-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_admin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
-- Single-row config table: the "id" column's CHECK constraint (added
-- below, outside Prisma's own generated DDL) enforces there's ever only
-- one row, per docs/DB_SCHEMA.md.
CREATE TABLE "server_config" (
    "id" BOOLEAN NOT NULL DEFAULT true,
    "registration_open" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "server_config_pkey" PRIMARY KEY ("id")
);

-- Enforce single-row table (Prisma's schema syntax has no native CHECK
-- constraint support, added by hand here).
ALTER TABLE "server_config" ADD CONSTRAINT "server_config_id_check" CHECK ("id" = true);

-- Seed the one row this table will ever have.
INSERT INTO "server_config" ("id", "registration_open") VALUES (true, true);
