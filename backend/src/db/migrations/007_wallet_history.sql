-- Permisos de lectura de ingresos; separados de las autorizaciones para pagar.
CREATE TABLE wallet_history_grants (
  wallet_id TEXT PRIMARY KEY REFERENCES wallets(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('REQUESTING','PENDING','POLLING','GRANTED','ERROR')),
  interact_url TEXT,
  continue_uri TEXT,
  continue_token_enc TEXT,
  access_token_enc TEXT,
  expires_at TEXT NOT NULL,
  next_poll_at TEXT NOT NULL
);
