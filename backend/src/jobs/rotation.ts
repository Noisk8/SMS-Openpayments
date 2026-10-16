import type { Db } from "../db";
import { enqueueJob } from "./repository";

/** Job type that rotates a grant's access token before it expires. */
export const ROTATE_GRANT_TOKEN_JOB = "rotate_grant_token";

/**
 * Rotate this many milliseconds before the token is due to expire (T-120s), so
 * the replacement is already stored when the current token becomes unusable.
 */
export const ROTATION_LEAD_MS = 120_000;

export interface RotationJobPayload {
  grantId: string;
  /**
   * Expiry this job was scheduled for. The handler skips the run when the grant
   * has moved on to a different expiry, which keeps a stale schedule from
   * triggering a second rotation.
   */
  expectedExpiresAt: string | null;
}

/**
 * Enqueues the next access-token rotation for a grant, timed shortly before the
 * token expires. The dedupe key includes the expiry, so a fresh schedule is
 * allowed after every successful rotation while duplicate schedules for the same
 * expiry are ignored.
 *
 * Grants without a known expiry (the AS did not send `expires_in`) cannot be
 * scheduled and are left untouched.
 */
export async function scheduleGrantTokenRotation(
  db: Db,
  input: { grantId: string; expiresAt: string | null; now?: Date },
): Promise<void> {
  if (!input.expiresAt) {
    return;
  }
  const expiresMs = Date.parse(input.expiresAt);
  if (Number.isNaN(expiresMs)) {
    return;
  }
  const now = input.now ?? new Date();
  const runAtMs = Math.max(now.getTime(), expiresMs - ROTATION_LEAD_MS);
  const payload: RotationJobPayload = { grantId: input.grantId, expectedExpiresAt: input.expiresAt };
  await enqueueJob(db, {
    type: ROTATE_GRANT_TOKEN_JOB,
    payload,
    dedupeKey: `${ROTATE_GRANT_TOKEN_JOB}:${input.grantId}:${input.expiresAt}`,
    nextRunAt: new Date(runAtMs).toISOString(),
  });
}
