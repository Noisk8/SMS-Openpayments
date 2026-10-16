-- Acceso explícito de pruebas; no activa ni verifica cuentas por SMS.
CREATE TABLE web_test_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL
);
ALTER TABLE web_sessions ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT FALSE;
