-- Initial schema. PostgreSQL, no ORM.
-- Rules: parameterized SQL, foreign keys, unique ids per provider, atomic transitions.
-- Timestamps are stored as ISO-8601 UTC TEXT (matching JS `toISOString()`), so
-- lexicographic comparisons keep working and callers can compare with Date.parse.
-- Each table carries a `seq` identity column used only as a stable insertion-order
-- tiebreaker (SQLite's implicit `rowid` has no PostgreSQL equivalent).

CREATE TABLE users (
  seq               BIGINT GENERATED ALWAYS AS IDENTITY,
  id                TEXT PRIMARY KEY,
  phone             TEXT NOT NULL UNIQUE,
  phone_verified_at TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','suspended')),
  created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE wallets (
  seq             BIGINT GENERATED ALWAYS AS IDENTITY,
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address  TEXT NOT NULL UNIQUE,
  currency        TEXT NOT NULL,
  asset_scale     INTEGER NOT NULL,
  auth_server     TEXT,
  resource_server TEXT,
  created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_wallets_user ON wallets(user_id);

CREATE TABLE recipients (
  seq            BIGINT GENERATED ALWAYS AS IDENTITY,
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias          TEXT NOT NULL,
  phone          TEXT,
  wallet_address TEXT NOT NULL,
  currency       TEXT,
  asset_scale    INTEGER,
  created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  UNIQUE (user_id, alias)
);
CREATE INDEX idx_recipients_user ON recipients(user_id);
CREATE INDEX idx_recipients_phone ON recipients(phone);

CREATE TABLE grants (
  seq                BIGINT GENERATED ALWAYS AS IDENTITY,
  id                 TEXT PRIMARY KEY,
  wallet_id          TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  status             TEXT NOT NULL
                     CHECK (status IN ('PENDING_INTERACTION','GRANTED','CANCELLED','REVOKED','EXPIRED')),
  scopes             TEXT NOT NULL DEFAULT '[]',
  limit_value        TEXT,
  limit_currency     TEXT,
  limit_scale        INTEGER,
  access_token_enc   TEXT,
  continue_uri       TEXT,
  continue_token_enc TEXT,
  interact_url       TEXT,
  expires_at         TEXT,
  created_at         TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at         TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_grants_wallet ON grants(wallet_id);

CREATE TABLE payments (
  seq                      BIGINT GENERATED ALWAYS AS IDENTITY,
  id                       TEXT PRIMARY KEY,
  reference                TEXT NOT NULL UNIQUE,
  sender_user_id           TEXT NOT NULL REFERENCES users(id),
  sender_wallet_id         TEXT NOT NULL REFERENCES wallets(id),
  recipient_id             TEXT REFERENCES recipients(id),
  recipient_wallet_address TEXT NOT NULL,
  state                    TEXT NOT NULL CHECK (state IN
                           ('RECEIVED','AWAITING_CONFIRMATION','PROCESSING','COMPLETED',
                            'CANCELLED','EXPIRED','FAILED','NEEDS_REVIEW')),
  debit_value              TEXT,
  debit_currency           TEXT,
  debit_scale              INTEGER,
  receive_value            TEXT,
  receive_currency         TEXT,
  receive_scale            INTEGER,
  quote_id                 TEXT,
  quote_expires_at         TEXT,
  incoming_payment_id      TEXT,
  outgoing_payment_id      TEXT,
  confirmation_hash        TEXT,
  confirmation_expires_at  TEXT,
  confirmation_attempts    INTEGER NOT NULL DEFAULT 0,
  idempotency_key          TEXT UNIQUE,
  last_error               TEXT,
  created_at               TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at               TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_payments_sender ON payments(sender_user_id);
CREATE INDEX idx_payments_state ON payments(state);

CREATE TABLE sms_messages (
  seq                 BIGINT GENERATED ALWAYS AS IDENTITY,
  id                  TEXT PRIMARY KEY,
  provider            TEXT NOT NULL,
  provider_message_id TEXT,
  direction           TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_phone          TEXT NOT NULL,
  to_phone            TEXT NOT NULL,
  text                TEXT NOT NULL,
  status              TEXT NOT NULL,
  payment_id          TEXT REFERENCES payments(id),
  error               TEXT,
  created_at          TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  processed_at        TEXT,
  UNIQUE (provider, provider_message_id)
);
CREATE INDEX idx_sms_created ON sms_messages(created_at);

CREATE TABLE jobs (
  seq          BIGINT GENERATED ALWAYS AS IDENTITY,
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  payload      TEXT NOT NULL DEFAULT '{}',
  dedupe_key   TEXT UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','done','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_run_at  TEXT NOT NULL,
  lease_until  TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_jobs_ready ON jobs(status, next_run_at);

CREATE TABLE audit_events (
  seq          BIGINT GENERATED ALWAYS AS IDENTITY,
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  subject_type TEXT,
  subject_id   TEXT,
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_audit_subject ON audit_events(subject_type, subject_id);
