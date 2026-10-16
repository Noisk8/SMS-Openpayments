import type { AppConfig } from "../config";
import type { Db } from "../db";
import { AppError } from "../errors";
import { scheduleGrantTokenRotation } from "../jobs/rotation";
import type { GrantBudgetUsage, PaymentProvider, WalletMetadata } from "../payments/types";
import type { SecretBox } from "../security/encryption";
import { isPast, isoPlusMs, nowIso } from "../util/time";
import {
  getGrantRow,
  getWalletRow,
  recordAudit,
  rowToWalletMetadata,
  type GrantRow,
} from "../onboarding/service";

export interface GrantDeps {
  config: AppConfig;
  db: Db;
  provider: PaymentProvider;
  secretBox: SecretBox | null;
}

/** How long a rotation lock is held before it is considered abandoned. */
export const ROTATION_LOCK_MS = 60_000;

/** Outcome of a rotation attempt; `requiresReconsent` is the explicit dead-end state. */
export interface RotateGrantTokenResult {
  rotated: boolean;
  /** True when the grant can no longer be rotated and needs a fresh consent. */
  requiresReconsent: boolean;
  expiresAt: string | null;
  manageUri: string | null;
  reason?: string;
}

function requireSecretBox(deps: GrantDeps): SecretBox {
  if (!deps.secretBox) {
    throw new AppError("INTERNAL", "Se requiere ENCRYPTION_KEY para descifrar credenciales.");
  }
  return deps.secretBox;
}

/** Loads a granted grant plus its decrypted access token and wallet metadata. */
async function grantedContext(
  deps: GrantDeps,
  grantId: string,
): Promise<{ grant: GrantRow; wallet: WalletMetadata; accessToken: string }> {
  const grant = await getGrantRow(deps.db, grantId);
  if (!grant) {
    throw new AppError("NOT_FOUND", "Grant no encontrado.");
  }
  if (grant.status !== "GRANTED") {
    throw new AppError("CONFLICT", `El grant está en estado ${grant.status}.`);
  }
  if (!grant.access_token_enc) {
    throw new AppError("INTERNAL", "El grant no tiene token de acceso almacenado.");
  }
  const walletRow = await getWalletRow(deps.db, grant.wallet_id);
  if (!walletRow) {
    throw new AppError("INTERNAL", "La wallet del grant no existe.");
  }
  const accessToken = requireSecretBox(deps).decrypt(grant.access_token_enc);
  return { grant, wallet: rowToWalletMetadata(walletRow), accessToken };
}

/**
 * Inspects the consumed authorization budget. Returns `supported: false` when the
 * connected provider does not implement spending queries (spec §7).
 */
export async function getGrantUsage(
  deps: GrantDeps,
  grantId: string,
): Promise<{ supported: boolean; usage: GrantBudgetUsage | null }> {
  const { wallet, accessToken } = await grantedContext(deps, grantId);
  const usage = await deps.provider.getGrantUsage({ wallet, accessToken });
  return { supported: usage !== null, usage };
}

/** Ends the delegated authorization and clears the stored token (spec §7). */
export async function cancelGrant(deps: GrantDeps, grantId: string): Promise<GrantRow> {
  const { grant, wallet, accessToken } = await grantedContext(deps, grantId);
  await deps.provider.cancelGrant({ wallet, accessToken });
  return transition(deps, grant.id, "CANCELLED", "grant.cancelled");
}

/** Rotates the access token, storing the replacement encrypted (spec §7). */
export async function rotateGrantToken(
  deps: GrantDeps,
  grantId: string,
): Promise<RotateGrantTokenResult> {
  const secretBox = requireSecretBox(deps);
  const { grant, wallet, accessToken } = await grantedContext(deps, grantId);

  // Already flagged: rotation cannot help, the user must consent again.
  if (grant.requires_reconsent) {
    return {
      rotated: false,
      requiresReconsent: true,
      expiresAt: grant.expires_at,
      manageUri: grant.access_token_manage_uri,
      reason: "already_requires_reconsent",
    };
  }

  // Rotation only works while the current token is still valid. Once it expired
  // the only way forward is a fresh consent; make that state explicit instead of
  // calling the AS with a token it will reject.
  if (grant.expires_at && isPast(grant.expires_at)) {
    await markRequiresReconsent(deps, grant.id, "El access token expiró antes de poder rotarlo.");
    return {
      rotated: false,
      requiresReconsent: true,
      expiresAt: grant.expires_at,
      manageUri: grant.access_token_manage_uri,
      reason: "token_expired",
    };
  }

  // Single-flight: only one rotation per grant may run at a time. The lock
  // expires so an interrupted worker does not block rotation forever.
  const now = nowIso();
  const acquired = await deps.db.run(
    `UPDATE grants SET rotation_lock_until = ?, updated_at = ?
      WHERE id = ? AND status = 'GRANTED' AND requires_reconsent = 0
        AND (rotation_lock_until IS NULL OR rotation_lock_until < ?)`,
    [isoPlusMs(ROTATION_LOCK_MS), now, grant.id, now],
  );
  if (acquired.changes === 0) {
    return {
      rotated: false,
      requiresReconsent: false,
      expiresAt: grant.expires_at,
      manageUri: grant.access_token_manage_uri,
      reason: "rotation_in_progress",
    };
  }

  try {
    const rotated = await deps.provider.rotateAccessToken({
      wallet,
      accessToken,
      ...(grant.access_token_manage_uri ? { manageUri: grant.access_token_manage_uri } : {}),
    });
    if (!rotated) {
      await markRequiresReconsent(deps, grant.id, "La rotación fue rechazada por el proveedor.");
      return {
        rotated: false,
        requiresReconsent: true,
        expiresAt: grant.expires_at,
        manageUri: grant.access_token_manage_uri,
        reason: "rotation_rejected",
      };
    }
    const done = nowIso();
    await deps.db.run(
      `UPDATE grants
          SET access_token_enc = ?, expires_at = ?, access_token_manage_uri = ?,
              requires_reconsent = 0, last_rotation_error = NULL, rotation_lock_until = NULL, updated_at = ?
        WHERE id = ?`,
      [secretBox.encrypt(rotated.accessToken), rotated.expiresAt, rotated.manageUri ?? null, done, grant.id],
    );
    await recordAudit(deps.db, "grant.token_rotated", "grant", grant.id, {});
    // Keep the chain alive: schedule the next rotation before the new token expires.
    await scheduleGrantTokenRotation(deps.db, { grantId: grant.id, expiresAt: rotated.expiresAt });
    return {
      rotated: true,
      requiresReconsent: false,
      expiresAt: rotated.expiresAt,
      manageUri: rotated.manageUri ?? null,
    };
  } catch (error) {
    if (isAuthorizationError(error)) {
      // The AS no longer accepts the token: consent is required again.
      await markRequiresReconsent(deps, grant.id, errorMessage(error));
      return {
        rotated: false,
        requiresReconsent: true,
        expiresAt: grant.expires_at,
        manageUri: grant.access_token_manage_uri,
        reason: "rotation_unauthorized",
      };
    }
    // Transient failure: release the lock and let the caller retry with backoff.
    await deps.db.run(`UPDATE grants SET rotation_lock_until = NULL WHERE id = ?`, [grant.id]);
    throw error;
  }
}

/** Marks the grant as needing a fresh consent and records why (never silent). */
async function markRequiresReconsent(deps: GrantDeps, grantId: string, reason: string): Promise<void> {
  await deps.db.run(
    `UPDATE grants
        SET requires_reconsent = 1, last_rotation_error = ?, rotation_lock_until = NULL, updated_at = ?
      WHERE id = ?`,
    [reason, nowIso(), grantId],
  );
  await recordAudit(deps.db, "grant.reconsent_required", "grant", grantId, {});
}

function isAuthorizationError(error: unknown): boolean {
  return error instanceof AppError && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Invalidates the access token and marks the grant revoked (spec §7). */
export async function revokeGrantToken(deps: GrantDeps, grantId: string): Promise<GrantRow> {
  const { grant, wallet, accessToken } = await grantedContext(deps, grantId);
  await deps.provider.revokeAccessToken({ wallet, accessToken });
  return transition(deps, grant.id, "REVOKED", "grant.token_revoked");
}

async function transition(
  deps: GrantDeps,
  grantId: string,
  status: GrantRow["status"],
  auditType: string,
): Promise<GrantRow> {
  const now = new Date().toISOString();
  await deps.db.run(
    `UPDATE grants SET status = ?, access_token_enc = NULL, continue_token_enc = NULL,
        access_token_manage_uri = NULL, rotation_lock_until = NULL, updated_at = ?
      WHERE id = ?`,
    [status, now, grantId],
  );
  await recordAudit(deps.db, auditType, "grant", grantId, {});
  return (await getGrantRow(deps.db, grantId)) as GrantRow;
}
