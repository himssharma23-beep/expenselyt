CREATE TABLE IF NOT EXISTS transaction_capture_access (
 user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 permissions JSONB NOT NULL DEFAULT '{}', preferences JSONB NOT NULL DEFAULT '{}',
 updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS transaction_capture_audit (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 admin_id BIGINT REFERENCES users(id) ON DELETE SET NULL, changes JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS transaction_capture_items (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 method TEXT NOT NULL, fingerprint TEXT NOT NULL, payload JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', expense_id BIGINT REFERENCES expenses(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,fingerprint)
);
CREATE INDEX IF NOT EXISTS transaction_capture_items_user ON transaction_capture_items(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS transaction_capture_tokens (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 method TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,method)
);
CREATE TABLE IF NOT EXISTS transaction_capture_mailboxes (
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, method TEXT NOT NULL,
 email TEXT NOT NULL, token_encrypted TEXT NOT NULL, cursor_value TEXT,
 last_sync_at TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,method)
);
CREATE TABLE IF NOT EXISTS transaction_capture_oauth (
 state_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 method TEXT NOT NULL, verifier TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '10 minutes'
);
