-- Desafíos web separados de la verificación de alta por SMS.
CREATE TABLE web_login_challenges (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_web_login_phone ON web_login_challenges(phone, created_at);
CREATE INDEX idx_web_login_ip ON web_login_challenges(ip_hash, created_at);
CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_web_sessions_user ON web_sessions(user_id);
