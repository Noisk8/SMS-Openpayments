import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { isUniqueViolation } from "../db/errors";
import { AppError } from "../errors";
import type { PaymentProvider } from "../payments/types";
import type { SecretBox } from "../security/encryption";
import { getUserRow, normalizePhone, recordAudit } from "../onboarding/service";

export interface RecipientDeps {
  config: AppConfig;
  db: Db;
  provider: PaymentProvider;
  secretBox: SecretBox | null;
}

export interface RecipientRow {
  id: string;
  user_id: string;
  alias: string;
  phone: string | null;
  wallet_address: string;
  currency: string | null;
  asset_scale: number | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedWallet {
  walletAddress: string;
  currency: string | null;
  assetScale: number | null;
}

interface WalletLookupRow {
  wallet_address: string;
  currency: string;
  asset_scale: number;
}

/**
 * Resolves a recipient's wallet from one of the supported sources (spec §8):
 * (a) an explicit Wallet Address, (b) a phone already linked to a registered
 * wallet, or (c) an existing user-specific alias.
 * A phone alone never reveals a wallet unless a registered user owns one.
 */
export async function resolveRecipientWallet(
  deps: RecipientDeps,
  input: { userId: string; walletAddress?: string; phone?: string; alias?: string },
): Promise<ResolvedWallet> {
  if (input.walletAddress) {
    const metadata = await deps.provider.getWalletMetadata(input.walletAddress);
    return {
      walletAddress: metadata.walletAddress,
      currency: metadata.currency,
      assetScale: metadata.assetScale,
    };
  }

  if (input.phone) {
    const phone = normalizePhone(input.phone);
    const row = await deps.db.get<WalletLookupRow>(
      `SELECT w.wallet_address AS wallet_address, w.currency AS currency, w.asset_scale AS asset_scale
         FROM users u JOIN wallets w ON w.user_id = u.id
        WHERE u.phone = ?
        ORDER BY w.created_at DESC, w.seq DESC LIMIT 1`,
      [phone],
    );
    if (!row) {
      throw new AppError("NOT_FOUND", "El teléfono no está asociado a una wallet registrada.");
    }
    return { walletAddress: row.wallet_address, currency: row.currency, assetScale: row.asset_scale };
  }

  if (input.alias) {
    const existing = await getRecipientByAlias(deps.db, input.userId, input.alias);
    if (!existing) {
      throw new AppError("NOT_FOUND", "No existe un destinatario con ese alias.");
    }
    return {
      walletAddress: existing.wallet_address,
      currency: existing.currency,
      assetScale: existing.asset_scale,
    };
  }

  throw new AppError("VALIDATION_FAILED", "Indica walletAddress, phone o alias.");
}

/** Creates a recipient, storing the resolved wallet so alias changes cannot redirect it. */
export async function createRecipient(
  deps: RecipientDeps,
  input: { userId: string; alias: string; walletAddress?: string; phone?: string },
): Promise<RecipientRow> {
  const user = await getUserRow(deps.db, input.userId);
  if (!user) {
    throw new AppError("NOT_FOUND", "Usuario no encontrado.");
  }
  const alias = input.alias.trim();
  if (alias.length === 0) {
    throw new AppError("VALIDATION_FAILED", "El alias es obligatorio.");
  }
  const resolved = await resolveRecipientWallet(deps, {
    userId: input.userId,
    ...(input.walletAddress ? { walletAddress: input.walletAddress } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
  });
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    await deps.db.run(
      `INSERT INTO recipients
         (id, user_id, alias, phone, wallet_address, currency, asset_scale, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.userId, alias, phone, resolved.walletAddress, resolved.currency, resolved.assetScale, now, now],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Ya existe un destinatario con ese alias.", { alias });
    }
    throw error;
  }
  await recordAudit(deps.db, "recipient.created", "recipient", id, { alias });
  return (await getRecipientById(deps.db, id)) as RecipientRow;
}

export async function listRecipients(db: Db, userId: string): Promise<RecipientRow[]> {
  return db.all<RecipientRow>(
    `SELECT * FROM recipients WHERE user_id = ? ORDER BY alias ASC, created_at ASC`,
    [userId],
  );
}

export async function getRecipientById(db: Db, id: string): Promise<RecipientRow | undefined> {
  return db.get<RecipientRow>("SELECT * FROM recipients WHERE id = ?", [id]);
}

export async function getRecipientByAlias(
  db: Db,
  userId: string,
  alias: string,
): Promise<RecipientRow | undefined> {
  return db.get<RecipientRow>(
    `SELECT * FROM recipients WHERE user_id = ? AND lower(alias) = lower(?)`,
    [userId, alias.trim()],
  );
}
