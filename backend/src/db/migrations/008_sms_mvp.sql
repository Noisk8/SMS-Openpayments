-- SMS MVP: numbered recipients and a per-user confirmation-code registry.
--
-- Recipient numbers are permanent. A number is handed out once at creation from a
-- per-user monotonic counter and is never reused, even after the recipient is
-- deleted, so a number can never silently point at a different destination.
--
-- `sms_confirmation_codes` records a salted hash and a deterministic fingerprint
-- of every confirmation code ever issued to a user. The fingerprint guarantees a
-- code is never reused for another payment of the same user when an SMS arrives
-- late; the plaintext code never reaches the database.
--
-- Timestamps stay ISO-8601 UTC TEXT, matching `new Date().toISOString()`.

ALTER TABLE recipients ADD COLUMN number INTEGER;

-- Backfill: number existing recipients per user by creation order.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at ASC, seq ASC) AS n
    FROM recipients
)
UPDATE recipients r
   SET number = ranked.n
  FROM ranked
 WHERE r.id = ranked.id;

ALTER TABLE recipients ALTER COLUMN number SET NOT NULL;
CREATE UNIQUE INDEX idx_recipients_user_number ON recipients(user_id, number);

-- Per-user monotonic counter. Only ever incremented (never decremented), so
-- deleting a recipient does not free its number for reuse.
CREATE TABLE recipient_counters (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1)
);

-- Seed the counters just past the numbers already handed out.
INSERT INTO recipient_counters (user_id, next_number)
SELECT user_id, MAX(number) + 1 FROM recipients GROUP BY user_id;

-- Every confirmation code issued to a user, kept after the payment reaches a
-- terminal state so late SMS can never be matched against a newer payment.
CREATE TABLE sms_confirmation_codes (
  seq              BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id       TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  code_hash        TEXT NOT NULL,
  code_fingerprint TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  UNIQUE (user_id, code_fingerprint)
);
CREATE INDEX idx_sms_confirmation_codes_user ON sms_confirmation_codes(user_id);
