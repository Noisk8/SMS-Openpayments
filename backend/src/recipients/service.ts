import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config";
import type { Db, Queryable } from "../db";
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
  /** Permanent, per-user destination number (never reordered nor reused). */
  number: number;
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
    // The number allocation and the insert share one transaction: a conflicting
    // alias rolls both back, so a rejected creation never burns a number.
    await deps.db.transaction(async (tx) => {
      const number = await allocateRecipientNumber(tx, input.userId);
      await tx.run(
        `INSERT INTO recipients
           (id, user_id, number, alias, phone, wallet_address, currency, asset_scale, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.userId,
          number,
          alias,
          phone,
          resolved.walletAddress,
          resolved.currency,
          resolved.assetScale,
          now,
          now,
        ],
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Ya existe un destinatario con ese alias.", { alias });
    }
    throw error;
  }
  await recordAudit(deps.db, "recipient.created", "recipient", id, { alias });
  return (await getRecipientById(deps.db, id)) as RecipientRow;
}

/**
 * Takes the next permanent number for a user from the monotonic counter.
 *
 * The counter only ever grows, so a deleted recipient's number is never handed
 * out again. The first insert seeds `next_number` at 2 and returns 1; later
 * calls increment and return the previous value.
 */
async function allocateRecipientNumber(tx: Queryable, userId: string): Promise<number> {
  const row = await tx.get<{ number: number }>(
    `INSERT INTO recipient_counters (user_id, next_number)
     VALUES (?, 2)
     ON CONFLICT (user_id) DO UPDATE SET next_number = recipient_counters.next_number + 1
     RETURNING next_number - 1 AS number`,
    [userId],
  );
  if (!row) {
    throw new AppError("INTERNAL", "No se pudo asignar un número al destinatario.");
  }
  return row.number;
}

/** Recipients in permanent number order (the canonical list order). */
export async function listRecipients(db: Db, userId: string): Promise<RecipientRow[]> {
  return db.all<RecipientRow>(
    `SELECT * FROM recipients WHERE user_id = ? ORDER BY number ASC`,
    [userId],
  );
}

export async function getRecipientById(db: Db, id: string): Promise<RecipientRow | undefined> {
  return db.get<RecipientRow>("SELECT * FROM recipients WHERE id = ?", [id]);
}

export async function getRecipientByNumber(
  db: Db,
  userId: string,
  number: number,
): Promise<RecipientRow | undefined> {
  return db.get<RecipientRow>(`SELECT * FROM recipients WHERE user_id = ? AND number = ?`, [
    userId,
    number,
  ]);
}

/**
 * Resolves an SMS destination to a recipient by its permanent number (`2`) or by
 * its alias (`TIENDARUTAN`). Alias matching folds case and whitespace so a name
 * like `Tienda Ruta N` can be typed without spaces from an SMS.
 */
export async function getRecipientByDestination(
  db: Db,
  userId: string,
  destination: string,
): Promise<RecipientRow | undefined> {
  const value = destination.trim();
  if (/^\d+$/.test(value)) {
    return getRecipientByNumber(db, userId, Number.parseInt(value, 10));
  }
  const target = normalizeAlias(value);
  const own = (await listRecipients(db, userId)).find(
    (recipient) => normalizeAlias(recipient.alias) === target,
  );
  if (own) {
    return own;
  }
  // Aliases are global: a registered destination can be paid by any sender.
  const all = await db.all<RecipientRow>(`SELECT * FROM recipients ORDER BY created_at ASC`);
  return all.find((recipient) => normalizeAlias(recipient.alias) === target);
}

/** Case- and whitespace-insensitive alias key for SMS matching. */
function normalizeAlias(alias: string): string {
  return alias.toLowerCase().replace(/\s+/g, "");
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
