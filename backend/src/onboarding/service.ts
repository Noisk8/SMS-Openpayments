import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { isUniqueViolation } from "../db/errors";
import type { Amount, UserStatus } from "../domain";
import { AppError } from "../errors";
import type { PaymentProvider, WalletMetadata } from "../payments/types";
import type { SecretBox } from "../security/encryption";
import { isPast, isoPlusSeconds, nowIso } from "../util/time";

/** Dependencies shared by the onboarding, recipients and grants services. */
export interface OnboardingDeps {
  config: AppConfig;
  db: Db;
  provider: PaymentProvider;
  secretBox: SecretBox | null;
}

export const PHONE_CODE_TTL_SECONDS = 300;
export const PHONE_CODE_MAX_ATTEMPTS = 5;
/** Finite, explicit budget for the initial grant (spec §7). No auto-renewal. */
const DEFAULT_GRANT_LIMIT_VALUE = "100000";

const E164 = /^\+[1-9]\d{7,14}$/;

// --- Persisted row shapes ---------------------------------------------------

export interface UserRow {
  id: string;
  phone: string;
  phone_verified_at: string | null;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface WalletRow {
  id: string;
  user_id: string;
  wallet_address: string;
  currency: string;
  asset_scale: number;
  auth_server: string | null;
  resource_server: string | null;
  created_at: string;
  updated_at: string;
}

export interface GrantRow {
  id: string;
  wallet_id: string;
  status: "PENDING_INTERACTION" | "GRANTED" | "CANCELLED" | "REVOKED" | "EXPIRED";
  scopes: string;
  limit_value: string | null;
  limit_currency: string | null;
  limit_scale: number | null;
  access_token_enc: string | null;
  continue_uri: string | null;
  continue_token_enc: string | null;
  interact_url: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getUserRow(db: Db, id: string): Promise<UserRow | undefined> {
  return db.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
}

export async function getWalletRow(db: Db, id: string): Promise<WalletRow | undefined> {
  return db.get<WalletRow>("SELECT * FROM wallets WHERE id = ?", [id]);
}

export async function getGrantRow(db: Db, id: string): Promise<GrantRow | undefined> {
  return db.get<GrantRow>("SELECT * FROM grants WHERE id = ?", [id]);
}

export function rowToWalletMetadata(row: WalletRow): WalletMetadata {
  return {
    walletAddress: row.wallet_address,
    currency: row.currency,
    assetScale: row.asset_scale,
    authServer: row.auth_server ?? "",
    resourceServer: row.resource_server ?? "",
  };
}

/** Records a state transition for audit purposes. Never store secrets here (spec §11). */
export async function recordAudit(
  db: Db,
  type: string,
  subjectType: string,
  subjectId: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await db.run(
    `INSERT INTO audit_events (id, type, subject_type, subject_id, data) VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), type, subjectType, subjectId, JSON.stringify(data)],
  );
}

// --- Phone normalization ----------------------------------------------------

/**
 * Normalizes a phone number to E.164.
 * Numbers without a country prefix are treated as Colombian mobile numbers (+57).
 */
export function normalizePhone(input: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new AppError("VALIDATION_FAILED", "El teléfono es obligatorio.");
  }
  const compact = input.trim().replace(/[\s\-().]/g, "");
  let candidate: string;
  if (compact.startsWith("+")) {
    candidate = compact;
  } else if (/^3\d{9}$/.test(compact)) {
    candidate = `+57${compact}`;
  } else {
    candidate = `+${compact}`;
  }
  if (!E164.test(candidate)) {
    throw new AppError("VALIDATION_FAILED", "Teléfono inválido.", { phone: input });
  }
  return candidate;
}

// --- One-time verification codes -------------------------------------------

function hashCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(code, salt, 32);
  return `${salt.toString("base64")}.${hash.toString("base64")}`;
}

function verifyCodeHash(code: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(".");
  if (!saltB64 || !hashB64) {
    return false;
  }
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(code, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

interface PhoneVerificationRow {
  id: string;
  user_id: string;
  phone: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
}

// --- User registration ------------------------------------------------------

export async function createUser(deps: Pick<OnboardingDeps, "db">, input: { phone: string }): Promise<UserRow> {
  const phone = normalizePhone(input.phone);
  const id = randomUUID();
  const now = nowIso();
  try {
    await deps.db.run(
      `INSERT INTO users (id, phone, status, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?)`,
      [id, phone, now, now],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "El teléfono ya está registrado.", { phone });
    }
    throw error;
  }
  await recordAudit(deps.db, "user.created", "user", id, { phone });
  return (await getUserRow(deps.db, id)) as UserRow;
}

// --- Phone possession verification -----------------------------------------

/**
 * Generates a one-time code, stores only its hash and returns the plaintext so
 * the caller can deliver it out of band (SMS/dev peek). The code is never logged.
 */
export async function requestPhoneVerification(
  deps: Pick<OnboardingDeps, "db">,
  userId: string,
): Promise<{ expiresAt: string; code: string }> {
  const user = await getUserRow(deps.db, userId);
  if (!user) {
    throw new AppError("NOT_FOUND", "Usuario no encontrado.");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = nowIso();
  const expiresAt = isoPlusSeconds(PHONE_CODE_TTL_SECONDS);
  await deps.db.run(
    `UPDATE phone_verifications SET consumed_at = ?
      WHERE user_id = ? AND consumed_at IS NULL`,
    [now, userId],
  );
  await deps.db.run(
    `INSERT INTO phone_verifications
       (id, user_id, phone, code_hash, attempts, max_attempts, expires_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    [randomUUID(), userId, user.phone, hashCode(code), PHONE_CODE_MAX_ATTEMPTS, expiresAt, now],
  );
  return { expiresAt, code };
}

/** Verifies the latest code and activates the user on success. */
export async function verifyPhone(deps: Pick<OnboardingDeps, "db">, userId: string, code: string): Promise<UserRow> {
  const user = await getUserRow(deps.db, userId);
  if (!user) {
    throw new AppError("NOT_FOUND", "Usuario no encontrado.");
  }
  const row = await deps.db.get<PhoneVerificationRow>(
    `SELECT * FROM phone_verifications
      WHERE user_id = ? AND consumed_at IS NULL
      ORDER BY created_at DESC, seq DESC LIMIT 1`,
    [userId],
  );
  if (!row) {
    throw new AppError("VALIDATION_FAILED", "No hay una verificación pendiente.");
  }
  if (isPast(row.expires_at)) {
    throw new AppError("VALIDATION_FAILED", "El código expiró. Solicita uno nuevo.");
  }
  if (row.attempts >= row.max_attempts) {
    throw new AppError("FORBIDDEN", "Demasiados intentos. Solicita un código nuevo.");
  }
  if (!verifyCodeHash(code, row.code_hash)) {
    await deps.db.run(`UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
    throw new AppError("VALIDATION_FAILED", "Código incorrecto.");
  }
  const now = nowIso();
  await deps.db.run(`UPDATE phone_verifications SET consumed_at = ? WHERE id = ?`, [now, row.id]);
  await deps.db.run(
    `UPDATE users SET phone_verified_at = ?, status = 'active', updated_at = ? WHERE id = ?`,
    [now, now, userId],
  );
  await recordAudit(deps.db, "user.phone_verified", "user", userId, {});
  return (await getUserRow(deps.db, userId)) as UserRow;
}

// --- Wallet connection and interactive grant --------------------------------

interface WalletLinkResult {
  wallet: { id: string; walletAddress: string; currency: string; assetScale: number };
  grant: { id: string; status: GrantRow["status"]; interactUrl: string | null };
}

function requireSecretBox(deps: OnboardingDeps): SecretBox {
  if (!deps.secretBox) {
    throw new AppError("INTERNAL", "Se requiere ENCRYPTION_KEY para cifrar credenciales.");
  }
  return deps.secretBox;
}

/**
 * Links a Wallet Address (discovering metadata through the provider) and starts
 * the interactive outgoing-payment grant with a finite budget.
 */
export async function connectWallet(
  deps: OnboardingDeps,
  userId: string,
  input: { walletAddress: string; limit?: Amount },
): Promise<WalletLinkResult> {
  const user = await getUserRow(deps.db, userId);
  if (!user) {
    throw new AppError("NOT_FOUND", "Usuario no encontrado.");
  }
  if (!user.phone_verified_at) {
    throw new AppError("FORBIDDEN", "Verifica el teléfono antes de vincular una wallet.");
  }
  const metadata = await deps.provider.getWalletMetadata(input.walletAddress);
  const secretBox = requireSecretBox(deps);

  const existing = await deps.db.get<WalletRow>("SELECT * FROM wallets WHERE wallet_address = ?", [
    metadata.walletAddress,
  ]);
  if (existing && existing.user_id !== userId) {
    throw new AppError("CONFLICT", "La wallet ya está vinculada a otro usuario.");
  }

  const now = nowIso();
  const walletId = existing?.id ?? randomUUID();
  if (existing) {
    await deps.db.run(
      `UPDATE wallets SET currency = ?, asset_scale = ?, auth_server = ?, resource_server = ?, updated_at = ?
        WHERE id = ?`,
      [metadata.currency, metadata.assetScale, metadata.authServer, metadata.resourceServer, now, walletId],
    );
  } else {
    await deps.db.run(
      `INSERT INTO wallets
         (id, user_id, wallet_address, currency, asset_scale, auth_server, resource_server, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        walletId,
        userId,
        metadata.walletAddress,
        metadata.currency,
        metadata.assetScale,
        metadata.authServer,
        metadata.resourceServer,
        now,
        now,
      ],
    );
  }

  const limit: Amount = input.limit ?? {
    value: DEFAULT_GRANT_LIMIT_VALUE,
    currency: deps.config.PAYMENT_CURRENCY,
    assetScale: deps.config.PAYMENT_ASSET_SCALE,
  };
  const grantId = randomUUID();
  const finishUri = `${deps.config.PUBLIC_BASE_URL.replace(/\/$/, "")}/auth/callback?grant_id=${grantId}`;
  // Network call happens outside any transaction (spec §11).
  const pending = await deps.provider.requestOutgoingGrant({
    wallet: metadata,
    limit,
    finishUri,
    nonce: randomUUID(),
  });

  if (pending.kind === "pending") {
    await deps.db.run(
      `INSERT INTO grants
         (id, wallet_id, status, scopes, limit_value, limit_currency, limit_scale,
          continue_uri, continue_token_enc, interact_url, created_at, updated_at)
       VALUES (?, ?, 'PENDING_INTERACTION', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        grantId,
        walletId,
        JSON.stringify(["outgoing-payment"]),
        limit.value,
        limit.currency,
        limit.assetScale,
        pending.continueUri,
        secretBox.encrypt(pending.continueAccessToken),
        pending.interactUrl,
        now,
        now,
      ],
    );
    await recordAudit(deps.db, "grant.requested", "grant", grantId, { walletId });
    return {
      wallet: {
        id: walletId,
        walletAddress: metadata.walletAddress,
        currency: metadata.currency,
        assetScale: metadata.assetScale,
      },
      grant: { id: grantId, status: "PENDING_INTERACTION", interactUrl: pending.interactUrl },
    };
  }

  await deps.db.run(
    `INSERT INTO grants
       (id, wallet_id, status, scopes, limit_value, limit_currency, limit_scale,
        access_token_enc, expires_at, created_at, updated_at)
     VALUES (?, ?, 'GRANTED', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      grantId,
      walletId,
      JSON.stringify(["outgoing-payment"]),
      limit.value,
      limit.currency,
      limit.assetScale,
      secretBox.encrypt(pending.accessToken),
      pending.expiresAt,
      now,
      now,
    ],
  );
  await recordAudit(deps.db, "grant.granted", "grant", grantId, { walletId });
  return {
    wallet: {
      id: walletId,
      walletAddress: metadata.walletAddress,
      currency: metadata.currency,
      assetScale: metadata.assetScale,
    },
    grant: { id: grantId, status: "GRANTED", interactUrl: null },
  };
}

/**
 * Completes the interactive grant callback. Validates the *stored* interaction
 * (grant id + pending status + saved continue token) instead of trusting
 * administrative credentials (spec §13).
 */
export async function completeGrantCallback(
  deps: OnboardingDeps,
  input: { grantId: string; interactRef: string },
): Promise<{ id: string; status: GrantRow["status"] }> {
  const secretBox = requireSecretBox(deps);
  const grant = await getGrantRow(deps.db, input.grantId);
  if (!grant) {
    throw new AppError("NOT_FOUND", "Interacción de grant no encontrada.");
  }
  if (grant.status !== "PENDING_INTERACTION") {
    throw new AppError("CONFLICT", `El grant está en estado ${grant.status}.`);
  }
  if (!grant.continue_uri || !grant.continue_token_enc) {
    throw new AppError("INTERNAL", "El grant no tiene datos de continuación almacenados.");
  }
  const walletRow = await getWalletRow(deps.db, grant.wallet_id);
  if (!walletRow) {
    throw new AppError("INTERNAL", "La wallet del grant no existe.");
  }
  const continueAccessToken = secretBox.decrypt(grant.continue_token_enc);
  const granted = await deps.provider.continueGrant({
    wallet: rowToWalletMetadata(walletRow),
    continueUri: grant.continue_uri,
    continueAccessToken,
    interactRef: input.interactRef,
  });
  if (!granted) {
    throw new AppError("VALIDATION_FAILED", "La interacción del grant es inválida o fue rechazada.");
  }
  const now = nowIso();
  await deps.db.run(
    `UPDATE grants
        SET status = 'GRANTED', access_token_enc = ?, continue_token_enc = NULL, expires_at = ?, updated_at = ?
      WHERE id = ?`,
    [secretBox.encrypt(granted.accessToken), granted.expiresAt, now, grant.id],
  );
  await recordAudit(deps.db, "grant.granted", "grant", grant.id, { via: "callback" });
  return { id: grant.id, status: "GRANTED" };
}
