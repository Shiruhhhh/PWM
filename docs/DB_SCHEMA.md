# PWM — Database Schema (v1)

Target: Postgres (or SQLite at this scale — schema below is Postgres syntax, trivially adaptable). Managed via Prisma migrations.

```sql
CREATE TABLE users (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username                     TEXT UNIQUE NOT NULL,
  client_salt                  BYTEA NOT NULL,          -- 16 bytes, for client-side Argon2id
  kdf_params                   JSONB NOT NULL,           -- { algorithm, memoryKiB, iterations, parallelism }
  server_salt                  BYTEA NOT NULL,           -- separate salt for server-side re-hash
  auth_hash                    BYTEA NOT NULL,           -- Argon2id(authKey, server_salt)
  wrapped_vault_key_password   BYTEA NOT NULL,           -- vaultKey wrapped under password-derived key
  wrapped_vault_key_recovery   BYTEA NOT NULL,           -- vaultKey wrapped under recovery key
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vault_blobs (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_blob       BYTEA NOT NULL,                   -- cryptoSchemeVersion||nonce||ciphertext||authTag
  revision             INTEGER NOT NULL DEFAULT 0,
  blob_format_version  INTEGER NOT NULL DEFAULT 1,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token        TEXT PRIMARY KEY,                         -- opaque random token, not JWT (allows server-side revocation)
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()         -- bumped on every authenticated request, rolling 90-day TTL (see API_SPEC.md)
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);   -- for periodic cleanup job

CREATE TABLE client_certs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cert_cn      TEXT NOT NULL,
  fingerprint  TEXT UNIQUE NOT NULL,
  issued_at    TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked      BOOLEAN NOT NULL DEFAULT false,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX idx_client_certs_user_id ON client_certs(user_id);
CREATE INDEX idx_client_certs_fingerprint ON client_certs(fingerprint);
```

## Notes

- `sessions.token` opaque (random 32+ bytes, base64) rather than JWT — allows instant server-side revocation (password change, logout, cert revoke) without needing short-lived-JWT + refresh-token complexity. Simpler at 2-user scale.
- `users.auth_hash` / `server_salt` separate from `client_salt` / `kdf_params` — client-side params are not secret (needed pre-auth via `/login/params`), server-side salt is purely internal, never exposed.
- No `shared_vaults` / `organizations` tables — explicitly out of scope (each user fully isolated, confirmed project decision).
- Cleanup job (cron or simple interval in Node process): delete expired `sessions` rows periodically — not critical at 2-user scale but cheap to add.
