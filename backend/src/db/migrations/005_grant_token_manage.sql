-- Grant access-token rotation.
--
-- GNAP access tokens expire (the Authorization Server owns the TTL, ~10 minutes
-- on the Interledger Test Wallet) while the grant and its limits persist. The
-- management URI (`access_token.manage`) lets the client rotate the token without
-- re-consent, so it must survive on the grant row. The URI is NOT a bearer
-- credential (the token value stays encrypted) but it MUST NOT be logged.
--
-- `expires_at` already stores the access-token expiry; rotation updates it.
-- `requires_reconsent` is the explicit state used when the token can no longer be
-- rotated (already expired or rejected): the grant then needs a fresh consent.
-- `rotation_lock_until` provides single-flight so two rotations never run for the
-- same grant at the same time.

ALTER TABLE grants ADD COLUMN access_token_manage_uri TEXT;
ALTER TABLE grants ADD COLUMN requires_reconsent INTEGER NOT NULL DEFAULT 0
  CHECK (requires_reconsent IN (0, 1));
ALTER TABLE grants ADD COLUMN last_rotation_error TEXT;
ALTER TABLE grants ADD COLUMN rotation_lock_until TEXT;
