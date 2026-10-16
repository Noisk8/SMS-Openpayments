-- Assisted onboarding: one-time phone verification codes (spec §6).
-- Only a salted hash is stored; the plaintext code never reaches the database or logs.

CREATE TABLE phone_verifications (
  seq          BIGINT GENERATED ALWAYS AS IDENTITY,
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_phone_verifications_user ON phone_verifications(user_id);
