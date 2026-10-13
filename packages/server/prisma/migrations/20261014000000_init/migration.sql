-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "client_salt" BYTEA NOT NULL,
    "kdf_params" JSONB NOT NULL,
    "server_salt" BYTEA NOT NULL,
    "auth_hash" BYTEA NOT NULL,
    "wrapped_vault_key_password" BYTEA NOT NULL,
    "wrapped_vault_key_recovery" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_blobs" (
    "user_id" UUID NOT NULL,
    "encrypted_blob" BYTEA NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "blob_format_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_blobs_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "client_certs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cert_cn" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "client_certs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_certs_fingerprint_key" ON "client_certs"("fingerprint");

-- CreateIndex
CREATE INDEX "client_certs_user_id_idx" ON "client_certs"("user_id");

-- CreateIndex
CREATE INDEX "client_certs_fingerprint_idx" ON "client_certs"("fingerprint");

-- AddForeignKey
ALTER TABLE "vault_blobs" ADD CONSTRAINT "vault_blobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_certs" ADD CONSTRAINT "client_certs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

