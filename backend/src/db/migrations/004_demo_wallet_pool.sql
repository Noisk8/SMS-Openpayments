-- Demo wallet pool: pre-created Open Payments wallets (Interledger Test Wallet)
-- that are provisioned to customers during registration for demo purposes.
--
-- Invariants enforced here (not only in application code):
--   * one pool wallet address is unique;
--   * a customer wallet is assigned to at most one user;
--   * a user owns at most one pool wallet / demo assignment;
--   * the treasury wallet is never handed out to a customer;
--   * allocation status and the assigned user id never contradict each other.
-- Real money never lives here: top-ups and later payments always run through the
-- real test infrastructure, this schema only tracks who owns which wallet.

CREATE TABLE demo_wallet_pool (
  seq               BIGINT GENERATED ALWAYS AS IDENTITY,
  id                TEXT PRIMARY KEY,
  wallet_address    TEXT NOT NULL UNIQUE,
  role              TEXT NOT NULL CHECK (role IN ('TREASURY','CUSTOMER')),
  allocation_status TEXT NOT NULL CHECK (allocation_status IN ('AVAILABLE','RESERVED','ASSIGNED')),
  assigned_user_id  TEXT REFERENCES users(id),
  currency          TEXT NOT NULL,
  asset_scale       INTEGER NOT NULL,
  auth_server       TEXT,
  resource_server   TEXT,
  -- Discovered metadata (currency, scale, service URLs) kept verbatim for audit.
  metadata          TEXT NOT NULL DEFAULT '{}',
  assigned_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  -- AVAILABLE <=> no owner; RESERVED/ASSIGNED <=> owner set.
  CONSTRAINT demo_wallet_pool_assignment_consistent
    CHECK ((allocation_status = 'AVAILABLE') = (assigned_user_id IS NULL)),
  -- The treasury is shared infrastructure and is never assigned to a customer.
  CONSTRAINT demo_wallet_pool_treasury_not_assigned
    CHECK (role = 'CUSTOMER' OR allocation_status = 'AVAILABLE')
);

-- One assigned/reserved customer wallet per user (treasury rows are NULL).
CREATE UNIQUE INDEX idx_demo_wallet_pool_assigned_user
  ON demo_wallet_pool(assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;

CREATE TABLE demo_assignments (
  seq                  BIGINT GENERATED ALWAYS AS IDENTITY,
  id                   TEXT PRIMARY KEY,
  -- One demo wallet per customer.
  user_id              TEXT NOT NULL UNIQUE REFERENCES users(id),
  -- One assignment per pool wallet: it can never be handed to a second customer.
  pool_wallet_id       TEXT NOT NULL UNIQUE REFERENCES demo_wallet_pool(id),
  wallet_id            TEXT NOT NULL UNIQUE REFERENCES wallets(id),
  wallet_address       TEXT NOT NULL UNIQUE,
  -- Idempotency key for the whole onboarding funding operation.
  onboarding_key       TEXT NOT NULL UNIQUE,
  registration_source  TEXT NOT NULL DEFAULT 'DEMO',
  funding_status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (funding_status IN
                         ('PENDING','IN_PROGRESS','FUNDED','FAILED','OPERATOR_ACTION_REQUIRED','RECONCILIATION_REQUIRED')),
  authorization_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (authorization_status IN
                         ('PENDING','AUTHORIZED','MISSING','REJECTED')),
  funding_payment_id   TEXT REFERENCES payments(id),
  funding_error        TEXT,
  created_at           TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at           TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_demo_assignments_pool_wallet ON demo_assignments(pool_wallet_id);

-- Payment purpose separates backend-authorized demo onboarding funding from SMS
-- transfers without changing the meaning of existing rows. The onboarding
-- idempotency key reuses the existing UNIQUE `idempotency_key` column.
ALTER TABLE payments ADD COLUMN purpose TEXT NOT NULL DEFAULT 'SMS';
CREATE INDEX idx_payments_purpose ON payments(purpose);
