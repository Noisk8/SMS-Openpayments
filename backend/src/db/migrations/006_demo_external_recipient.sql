-- Demo wallet pool: external payment destination.
--
-- A second Test Wallet login can be imported together with the pool as an
-- EXTERNAL_RECIPIENT: an external payment destination the assigned customer can
-- pay through the normal SMS flow. It never receives a demo assignment and is
-- therefore never reserved or handed out; the only role that can leave
-- AVAILABLE stays CUSTOMER (enforced by demo_wallet_pool_treasury_not_assigned).
--
-- Only the role domain changes here; no data is rewritten and existing
-- TREASURY/CUSTOMER rows keep their meaning.

ALTER TABLE demo_wallet_pool DROP CONSTRAINT demo_wallet_pool_role_check;
ALTER TABLE demo_wallet_pool ADD CONSTRAINT demo_wallet_pool_role_check
  CHECK (role IN ('TREASURY','CUSTOMER','EXTERNAL_RECIPIENT'));
