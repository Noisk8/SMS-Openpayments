import type { AppConfig } from "../config";
import type { Db } from "../db";
import { AppError } from "../errors";
import type { GrantBudgetUsage, PaymentProvider, WalletMetadata } from "../payments/types";
import type { SecretBox } from "../security/encryption";
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

function requireSecretBox(deps: GrantDeps): SecretBox {
  if (!deps.secretBox) {
    throw new AppError("INTERNAL", "Se requiere ENCRYPTION_KEY para descifrar credenciales.");
  }
  return deps.secretBox;
}

/** Loads a granted grant plus its decrypted access token and wallet metadata. */
function grantedContext(
  deps: GrantDeps,
  grantId: string,
): { grant: GrantRow; wallet: WalletMetadata; accessToken: string } {
  const grant = getGrantRow(deps.db, grantId);
  if (!grant) {
    throw new AppError("NOT_FOUND", "Grant no encontrado.");
  }
  if (grant.status !== "GRANTED") {
    throw new AppError("CONFLICT", `El grant está en estado ${grant.status}.`);
  }
  if (!grant.access_token_enc) {
    throw new AppError("INTERNAL", "El grant no tiene token de acceso almacenado.");
  }
  const walletRow = getWalletRow(deps.db, grant.wallet_id);
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
  const { wallet, accessToken } = grantedContext(deps, grantId);
  const usage = await deps.provider.getGrantUsage({ wallet, accessToken });
  return { supported: usage !== null, usage };
}

/** Ends the delegated authorization and clears the stored token (spec §7). */
export async function cancelGrant(deps: GrantDeps, grantId: string): Promise<GrantRow> {
  const { grant, wallet, accessToken } = grantedContext(deps, grantId);
  await deps.provider.cancelGrant({ wallet, accessToken });
  return transition(deps, grant.id, "CANCELLED", "grant.cancelled");
}

/** Rotates the access token, storing the replacement encrypted (spec §7). */
export async function rotateGrantToken(
  deps: GrantDeps,
  grantId: string,
): Promise<{ rotated: boolean; expiresAt: string | null }> {
  const secretBox = requireSecretBox(deps);
  const { grant, wallet, accessToken } = grantedContext(deps, grantId);
  const rotated = await deps.provider.rotateAccessToken({ wallet, accessToken });
  const now = new Date().toISOString();
  if (!rotated) {
    return { rotated: false, expiresAt: grant.expires_at };
  }
  deps.db
    .prepare(`UPDATE grants SET access_token_enc = ?, expires_at = ?, updated_at = ? WHERE id = ?`)
    .run(secretBox.encrypt(rotated.accessToken), rotated.expiresAt, now, grant.id);
  recordAudit(deps.db, "grant.token_rotated", "grant", grant.id, {});
  return { rotated: true, expiresAt: rotated.expiresAt };
}

/** Invalidates the access token and marks the grant revoked (spec §7). */
export async function revokeGrantToken(deps: GrantDeps, grantId: string): Promise<GrantRow> {
  const { grant, wallet, accessToken } = grantedContext(deps, grantId);
  await deps.provider.revokeAccessToken({ wallet, accessToken });
  return transition(deps, grant.id, "REVOKED", "grant.token_revoked");
}

function transition(
  deps: GrantDeps,
  grantId: string,
  status: GrantRow["status"],
  auditType: string,
): GrantRow {
  const now = new Date().toISOString();
  deps.db
    .prepare(
      `UPDATE grants SET status = ?, access_token_enc = NULL, continue_token_enc = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .run(status, now, grantId);
  recordAudit(deps.db, auditType, "grant", grantId, {});
  return getGrantRow(deps.db, grantId) as GrantRow;
}
