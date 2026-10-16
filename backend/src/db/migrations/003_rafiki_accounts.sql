-- Cuentas COP del entorno de pruebas. Los fondos de usuarios se llevan aquí,
-- separados de la liquidez de Rafiki. Cada movimiento tiene contrapartida.
CREATE TABLE managed_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  wallet_id TEXT NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL UNIQUE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK(balance >= 0 AND balance <= 9007199254740991)
);
CREATE TABLE managed_transfers (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  sender_id TEXT NOT NULL REFERENCES managed_accounts(user_id),
  recipient_id TEXT NOT NULL REFERENCES managed_accounts(user_id),
  amount BIGINT NOT NULL CHECK(amount > 0),
  state TEXT NOT NULL CHECK(state IN ('PREPARING','AWAITING_CONFIRMATION','PROCESSING','COMPLETED','CANCELLED','EXPIRED','NEEDS_REVIEW')),
  quote_id TEXT,
  incoming_id TEXT,
  outgoing_id TEXT UNIQUE,
  expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE TABLE managed_journals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE TABLE managed_entries (
  journal_id TEXT NOT NULL REFERENCES managed_journals(id),
  account TEXT NOT NULL,
  amount BIGINT NOT NULL,
  PRIMARY KEY(journal_id, account)
);
-- Persistir la respuesta evita repetir OTP y otros efectos al reintentar un SMS.
ALTER TABLE sms_messages ADD COLUMN reply_text TEXT;
