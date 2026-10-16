import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config";
import type { Db, Queryable } from "../db";
import { isUniqueViolation } from "../db/errors";
import type { Amount } from "../domain";
import { AppError } from "../errors";
import { enqueueJob } from "../jobs/repository";
import { scheduleGrantTokenRotation } from "../jobs/rotation";
import {
  getUserRow,
  normalizePhone,
  recordAudit,
  type UserRow,
  type WalletRow,
} from "../onboarding/service";
import { compareAmounts, sameAsset } from "../payments/amount";
import { reconcilePayment } from "../payments/reconciliation";
import {
  executePayment,
  preparePayment,
  type PaymentSnapshot,
} from "../payments/service";
import type { PaymentProvider, WalletMetadata } from "../payments/types";
import { createRecipient, getRecipientByAlias } from "../recipients/service";
import type { SecretBox } from "../security/encryption";
import { isPast, isoPlusMs, nowIso } from "../util/time";
import {
  getAssignmentById,
  getAssignmentByUserId,
  getExternalRecipientWallet,
  getPoolWalletByAddress,
  getPoolWalletById,
  getTreasuryWallet,
  insertAssignment,
  insertPoolWallet,
  markPoolWalletAssigned,
  refreshPoolWalletMetadata,
  reserveCustomerWallet,
  updateAssignmentState,
  type AuthorizationStatus,
  type DemoAssignmentRow,
  type FundingStatus,
  type PoolRole,
  type PoolWalletRow,
} from "./repository";

/**
 * Demo wallet pool orchestration.
 *
 * Simulates wallet provisioning with PRE-CREATED Open Payments wallets: during
 * registration a customer is atomically handed one AVAILABLE pool wallet and the
 * backend funds it once from a shared treasury wallet through the real test
 * infrastructure. This module never holds a DB transaction open during a network
 * call and never turns an uncertain outcome into a second transfer.
 */

export interface DemoDeps {
  config: AppConfig;
  db: Db;
  provider: PaymentProvider;
  secretBox: SecretBox | null;
}

/** Job type processed by the jobs domain to fund a demo assignment. */
export const DEMO_TOPUP_JOB = "demo_topup";

/** Deterministic system identity that owns the treasury wallet row. */
export const DEMO_TREASURY_USER_ID = "demo-treasury-user";
const DEMO_TREASURY_PHONE = "+570000000000";
const DEMO_TREASURY_WALLET_ID = "demo-treasury-wallet";

const RECONCILE_DELAY_MS = 5_000;

export function topUpAmount(config: AppConfig): Amount {
  return {
    value: config.DEMO_TOPUP_AMOUNT,
    currency: config.DEMO_TOPUP_CURRENCY,
    assetScale: config.DEMO_TOPUP_ASSET_SCALE,
  };
}

function maxTopUpAmount(config: AppConfig): Amount {
  return {
    value: config.DEMO_TOPUP_MAX_AMOUNT,
    currency: config.DEMO_TOPUP_CURRENCY,
    assetScale: config.DEMO_TOPUP_ASSET_SCALE,
  };
}

export function isFundingSettled(status: FundingStatus): boolean {
  return status === "FUNDED" || status === "FAILED" || status === "OPERATOR_ACTION_REQUIRED";
}

/** Public predicate used by the job recovery inspector. */
export const isDemoFundingSettled = isFundingSettled;

// --- Import -----------------------------------------------------------------

export interface ImportPoolInput {
  treasury: string;
  customers: string[];
  /** Optional external payment destination, never assigned to a customer. */
  externalRecipient?: string;
}

export interface ImportPoolResult {
  treasury: { walletAddress: string; currency: string; assetScale: number; created: boolean };
  customers: { imported: number; refreshed: number; total: number };
  externalRecipient: { walletAddress: string; currency: string; assetScale: number; created: boolean } | null;
}

function poolInputFrom(
  role: PoolRole,
  metadata: WalletMetadata,
  now: string,
): Parameters<typeof insertPoolWallet>[1] {
  return {
    walletAddress: metadata.walletAddress,
    role,
    currency: metadata.currency,
    assetScale: metadata.assetScale,
    authServer: metadata.authServer || null,
    resourceServer: metadata.resourceServer || null,
    metadata: {
      currency: metadata.currency,
      assetScale: metadata.assetScale,
      authServer: metadata.authServer,
      resourceServer: metadata.resourceServer,
      source: "import",
    },
    now,
  };
}

/**
 * Imports one treasury plus N customer wallets and, optionally, a single
 * external payment destination. Metadata is discovered through `walletAddress.get`;
 * duplicates and incompatible assets are rejected, the treasury never participates
 * in customer assignment, and the external recipient is never assignable either.
 * Re-importing is idempotent: existing rows keep their assignment and funding state.
 */
export async function importWalletPool(deps: DemoDeps, input: ImportPoolInput): Promise<ImportPoolResult> {
  const treasuryAddress = input.treasury.trim();
  const customerAddresses = input.customers.map((address) => address.trim());
  const externalAddress = input.externalRecipient?.trim() ?? "";

  if (!treasuryAddress) {
    throw new AppError("VALIDATION_FAILED", "La wallet del treasury es obligatoria.");
  }
  if (customerAddresses.length === 0) {
    throw new AppError("VALIDATION_FAILED", "Se requiere al menos una wallet de cliente.");
  }
  if (customerAddresses.includes(treasuryAddress)) {
    throw new AppError("VALIDATION_FAILED", "El treasury no puede incluirse como wallet de cliente.");
  }
  if (new Set(customerAddresses).size !== customerAddresses.length) {
    throw new AppError("VALIDATION_FAILED", "La lista de wallets de cliente contiene duplicados.");
  }
  if (externalAddress && externalAddress === treasuryAddress) {
    throw new AppError("VALIDATION_FAILED", "El destinatario externo no puede ser el treasury.");
  }
  if (externalAddress && customerAddresses.includes(externalAddress)) {
    throw new AppError(
      "VALIDATION_FAILED",
      "El destinatario externo no puede incluirse también como wallet de cliente.",
    );
  }

  // Network discovery happens outside any transaction (spec §11).
  const treasuryMetadata = await deps.provider.getWalletMetadata(treasuryAddress);
  const discovered: WalletMetadata[] = [];
  for (const address of customerAddresses) {
    const metadata = await deps.provider.getWalletMetadata(address);
    if (!sameAsset(metadata, treasuryMetadata)) {
      throw new AppError(
        "DEMO_WALLET_INCOMPATIBLE",
        `La wallet ${address} usa ${metadata.currency}@${metadata.assetScale}, incompatible con el treasury ${treasuryMetadata.currency}@${treasuryMetadata.assetScale}.`,
        { walletAddress: address },
      );
    }
    discovered.push(metadata);
  }
  let externalMetadata: WalletMetadata | null = null;
  if (externalAddress) {
    externalMetadata = await deps.provider.getWalletMetadata(externalAddress);
    if (!sameAsset(externalMetadata, treasuryMetadata)) {
      throw new AppError(
        "DEMO_WALLET_INCOMPATIBLE",
        `El destinatario externo ${externalAddress} usa ${externalMetadata.currency}@${externalMetadata.assetScale}, incompatible con el treasury ${treasuryMetadata.currency}@${treasuryMetadata.assetScale}.`,
        { walletAddress: externalAddress },
      );
    }
  }

  const now = nowIso();
  return deps.db.transaction(async (tx) => {
    const treasury = await upsertPoolWallet(tx, poolInputFrom("TREASURY", treasuryMetadata, now));
    await ensureTreasuryIdentity(tx, treasury.row.wallet_address, treasuryMetadata, now);

    // The external recipient is validated and stored like the others, but its role
    // can never be reserved for a customer. The pool holds at most one: a different
    // address is a conflict, the same address is an idempotent refresh.
    let external: { row: PoolWalletRow; created: boolean } | null = null;
    if (externalMetadata) {
      const existingExternal = await getExternalRecipientWallet(tx);
      if (existingExternal && existingExternal.wallet_address !== externalMetadata.walletAddress) {
        throw new AppError(
          "CONFLICT",
          `Ya hay un destinatario externo importado (${existingExternal.wallet_address}).`,
        );
      }
      external = await upsertPoolWallet(tx, poolInputFrom("EXTERNAL_RECIPIENT", externalMetadata, now));
    }

    let imported = 0;
    let refreshed = 0;
    for (const metadata of discovered) {
      const upserted = await upsertPoolWallet(tx, poolInputFrom("CUSTOMER", metadata, now));
      if (upserted.created) {
        imported += 1;
      } else {
        refreshed += 1;
      }
    }
    await recordAudit(tx, "demo.pool.imported", "demo_wallet_pool", treasury.row.id, {
      customers: discovered.length,
      imported,
      externalRecipient: externalMetadata?.walletAddress ?? null,
    });

    return {
      treasury: {
        walletAddress: treasuryMetadata.walletAddress,
        currency: treasuryMetadata.currency,
        assetScale: treasuryMetadata.assetScale,
        created: treasury.created,
      },
      customers: { imported, refreshed, total: discovered.length },
      externalRecipient:
        external && externalMetadata
          ? {
              walletAddress: externalMetadata.walletAddress,
              currency: externalMetadata.currency,
              assetScale: externalMetadata.assetScale,
              created: external.created,
            }
          : null,
    };
  });
}

async function upsertPoolWallet(
  tx: Queryable,
  input: Parameters<typeof insertPoolWallet>[1],
): Promise<{ row: PoolWalletRow; created: boolean }> {
  const existing = await getPoolWalletByAddress(tx, input.walletAddress);
  if (existing) {
    if (existing.role !== input.role) {
      throw new AppError(
        "CONFLICT",
        `La wallet ${input.walletAddress} ya está importada con rol ${existing.role}.`,
      );
    }
    // Only AVAILABLE metadata is refreshed; assignments/funding are untouched.
    await refreshPoolWalletMetadata(tx, { ...input, id: existing.id });
    const refreshed = await getPoolWalletById(tx, existing.id);
    return { row: refreshed ?? existing, created: false };
  }
  try {
    const row = await insertPoolWallet(tx, input);
    return { row, created: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", `La wallet ${input.walletAddress} ya está importada.`);
    }
    throw error;
  }
}

/** Ensures the treasury has a linked user + wallet row so it can sign payments. */
async function ensureTreasuryIdentity(
  tx: Queryable,
  walletAddress: string,
  metadata: WalletMetadata,
  now: string,
): Promise<WalletRow> {
  await tx.run(
    `INSERT INTO users (id, phone, phone_verified_at, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_TREASURY_USER_ID, DEMO_TREASURY_PHONE, now, now, now],
  );

  const existing = await tx.get<WalletRow>("SELECT * FROM wallets WHERE wallet_address = ?", [walletAddress]);
  if (existing && existing.user_id !== DEMO_TREASURY_USER_ID) {
    throw new AppError("CONFLICT", `La wallet ${walletAddress} ya está vinculada a otro usuario.`);
  }
  await tx.run(
    `INSERT INTO wallets
       (id, user_id, wallet_address, currency, asset_scale, auth_server, resource_server, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (wallet_address) DO UPDATE SET
       currency = EXCLUDED.currency,
       asset_scale = EXCLUDED.asset_scale,
       auth_server = EXCLUDED.auth_server,
       resource_server = EXCLUDED.resource_server,
       updated_at = EXCLUDED.updated_at`,
    [
      DEMO_TREASURY_WALLET_ID,
      DEMO_TREASURY_USER_ID,
      walletAddress,
      metadata.currency,
      metadata.assetScale,
      metadata.authServer || null,
      metadata.resourceServer || null,
      now,
      now,
    ],
  );
  return (await tx.get<WalletRow>("SELECT * FROM wallets WHERE wallet_address = ?", [walletAddress])) as WalletRow;
}

// --- Registration -----------------------------------------------------------

export interface DemoRegistrationInput {
  phone: string;
}

export interface DemoRegistrationResult {
  user: UserRow;
  assignment: DemoAssignmentRow;
  createdUser: boolean;
  createdAssignment: boolean;
  /** Alias under which the pool's external recipient was pre-registered, if any. */
  externalAlias: string | null;
}

/** Stable onboarding idempotency key for a customer's single demo funding. */
export function onboardingFundingKey(userId: string): string {
  return `demo-onboarding:${userId}`;
}

/**
 * Creates or reuses a customer and atomically reserves one AVAILABLE customer
 * wallet, links it and enqueues the single treasury top-up. Repeating the call
 * returns the existing assignment: no new wallet and no new top-up.
 */
export async function registerWithDemoWallet(
  deps: DemoDeps,
  input: DemoRegistrationInput,
): Promise<DemoRegistrationResult> {
  if (deps.config.DEMO_WALLET_ASSIGNMENT_ENABLED !== "true") {
    throw new AppError(
      "DEMO_ASSIGNMENT_DISABLED",
      "La asignación de wallets demo está deshabilitada (DEMO_WALLET_ASSIGNMENT_ENABLED=false).",
    );
  }
  const phone = normalizePhone(input.phone);

  const result = await deps.db.transaction(async (tx) => {
    let user = await tx.get<UserRow>("SELECT * FROM users WHERE phone = ?", [phone]);
    let createdUser = false;
    if (!user) {
      const id = randomUUID();
      const now = nowIso();
      await tx.run(
        `INSERT INTO users (id, phone, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`,
        [id, phone, now, now],
      );
      await recordAudit(tx, "user.created", "user", id, { phone, source: "demo" });
      user = (await tx.get<UserRow>("SELECT * FROM users WHERE id = ?", [id])) as UserRow;
      createdUser = true;
    }

    const existing = await getAssignmentByUserId(tx, user.id);
    if (existing) {
      // Idempotent: the same registration returns the same wallet and funding.
      return { user, assignment: existing, createdUser, createdAssignment: false };
    }

    const now = nowIso();
    const pool = await reserveCustomerWallet(tx, user.id, now);
    if (!pool) {
      throw new AppError(
        "DEMO_WALLET_POOL_EXHAUSTED",
        "No hay wallets demo disponibles; el pool está agotado.",
      );
    }
    // Defensive: only a wallet reserved for this user may be assigned.
    if (pool.allocation_status !== "RESERVED" || pool.assigned_user_id !== user.id) {
      throw new AppError(
        "DEMO_WALLET_ALREADY_ASSIGNED",
        `La wallet ${pool.wallet_address} ya está asignada a otro usuario.`,
      );
    }

    const walletId = randomUUID();
    await tx.run(
      `INSERT INTO wallets
         (id, user_id, wallet_address, currency, asset_scale, auth_server, resource_server, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        walletId,
        user.id,
        pool.wallet_address,
        pool.currency,
        pool.asset_scale,
        pool.auth_server,
        pool.resource_server,
        now,
        now,
      ],
    );

    const assignment = await insertAssignment(tx, {
      userId: user.id,
      poolWalletId: pool.id,
      walletId,
      walletAddress: pool.wallet_address,
      onboardingKey: onboardingFundingKey(user.id),
      now,
    });
    // Reservation + association + assignment commit together.
    await markPoolWalletAssigned(tx, pool.id, now);

    // Enqueued inside the transaction: the job only becomes visible after commit.
    await enqueueJob(tx, {
      type: DEMO_TOPUP_JOB,
      payload: { assignmentId: assignment.id },
      dedupeKey: `demo-topup:job:${assignment.id}`,
    });
    await recordAudit(tx, "demo.wallet_assigned", "demo_assignment", assignment.id, {
      userId: user.id,
      walletAddress: pool.wallet_address,
    });

    return { user, assignment, createdUser, createdAssignment: true };
  });

  // Pre-register the pool's external recipient after the assignment commits, so a
  // discovery error never rolls back the reserved wallet. Repeating the
  // registration returns the existing assignment and reuses the recipient.
  const externalAlias = await ensureDemoExternalRecipient(deps, result.user.id);
  return { ...result, externalAlias };
}

/**
 * Registers the pool's optional external payment destination as a recipient of
 * the given customer, under the configurable `DEMO_EXTERNAL_ALIAS`.
 *
 * Reuses the recipients service and is idempotent: an existing recipient with the
 * same alias is returned untouched, and concurrent registrations never duplicate
 * it. Returns the alias when the pool has an external recipient, otherwise null.
 */
export async function ensureDemoExternalRecipient(deps: DemoDeps, userId: string): Promise<string | null> {
  const external = await getExternalRecipientWallet(deps.db);
  if (!external) {
    return null;
  }
  const alias = deps.config.DEMO_EXTERNAL_ALIAS;
  if (await getRecipientByAlias(deps.db, userId, alias)) {
    return alias;
  }
  try {
    await createRecipient(deps, { userId, alias, walletAddress: external.wallet_address });
  } catch (error) {
    // A concurrent registration may have created it first; only then is the
    // conflict benign, so re-check before rethrowing.
    if (error instanceof AppError && error.code === "CONFLICT") {
      if (await getRecipientByAlias(deps.db, userId, alias)) {
        return alias;
      }
    }
    throw error;
  }
  return alias;
}

// --- Top-up execution -------------------------------------------------------

export interface DemoTopUpInput {
  assignmentId: string;
}

export interface DemoTopUpOutcome {
  assignmentId: string;
  fundingStatus: FundingStatus;
  authorizationStatus: AuthorizationStatus;
  paymentId: string | null;
  paymentState: string | null;
}

interface StoredGrantRow {
  id: string;
  status: string;
  access_token_enc: string | null;
  expires_at: string | null;
  limit_value: string | null;
  limit_currency: string | null;
  limit_scale: number | null;
}

interface TreasuryAccess {
  token: string | null;
  status: AuthorizationStatus;
  reason?: string;
}

function walletMetadataFrom(row: PoolWalletRow): WalletMetadata {
  return {
    walletAddress: row.wallet_address,
    currency: row.currency,
    assetScale: row.asset_scale,
    authServer: row.auth_server ?? "",
    resourceServer: row.resource_server ?? "",
  };
}

/**
 * Executes (or reconciles) the single automatic top-up for an assignment.
 *
 * Safe to call repeatedly: a funding that already moved on is only reconciled
 * against the known payment resource, never re-sent.
 */
export async function runDemoTopUp(deps: DemoDeps, input: DemoTopUpInput): Promise<DemoTopUpOutcome | null> {
  const { db } = deps;
  const assignment = await getAssignmentById(db, input.assignmentId);
  if (!assignment) {
    return null;
  }
  if (isFundingSettled(assignment.funding_status)) {
    return snapshot(assignment);
  }
  if (assignment.funding_payment_id) {
    // A transfer may already exist: reconcile it instead of creating another.
    return reconcileAssignment(deps, assignment);
  }

  const treasury = await getTreasuryWallet(db);
  if (!treasury) {
    throw new AppError("INTERNAL", "No hay una wallet treasury importada en el pool demo.");
  }
  const treasuryWallet = await getTreasuryWalletRow(db, treasury.wallet_address);
  if (!treasuryWallet) {
    return markOperatorAction(deps, assignment.id, "MISSING", "El treasury no tiene wallet vinculada.");
  }

  const access = await ensureTreasuryAccessToken(deps, treasury, treasuryWallet.id);
  if (!access.token) {
    return markOperatorAction(deps, assignment.id, access.status, access.reason ?? "Grant del treasury no disponible.");
  }
  await updateAssignmentState(db, {
    id: assignment.id,
    now: nowIso(),
    authorizationStatus: "AUTHORIZED",
  });

  // The configured top-up is the amount the customer must RECEIVE; the quote is
  // pinned to that side and the resulting treasury debit is validated below.
  const amount = topUpAmount(deps.config);
  const payment = await preparePayment(
    { db, provider: deps.provider },
    {
      senderUserId: DEMO_TREASURY_USER_ID,
      senderWalletId: treasuryWallet.id,
      senderWalletAddress: treasury.wallet_address,
      recipientWalletAddress: assignment.wallet_address,
      receiveAmount: amount,
      reference: `demo-topup-${assignment.id}`,
      idempotencyKey: assignment.onboarding_key,
      purpose: "DEMO_TOPUP",
    },
  );

  if (payment.receiveAmount && compareAmounts(payment.receiveAmount, amount) < 0) {
    return markOperatorAction(
      deps,
      assignment.id,
      "REJECTED",
      `El quote recibió ${payment.receiveAmount.value}, por debajo del top-up configurado ${amount.value}.`,
    );
  }
  const max = maxTopUpAmount(deps.config);
  if (payment.debitAmount && compareAmounts(payment.debitAmount, max) > 0) {
    return markOperatorAction(
      deps,
      assignment.id,
      "AUTHORIZED",
      `El débito del treasury (${payment.debitAmount.value}) excede el máximo permitido (${max.value}).`,
    );
  }

  await updateAssignmentState(db, {
    id: assignment.id,
    now: nowIso(),
    fundingPaymentId: payment.id,
    fundingStatus: "IN_PROGRESS",
    fundingError: null,
  });

  let executed: PaymentSnapshot;
  try {
    executed = await executePayment(
      { db, provider: deps.provider },
      { paymentId: payment.id, accessToken: access.token },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return handleExecutionError(deps, assignment.id, error);
    }
    throw error;
  }
  return applyPaymentState(deps, assignment.id, executed);
}

async function getTreasuryWalletRow(db: Queryable, walletAddress: string): Promise<WalletRow | undefined> {
  return db.get<WalletRow>("SELECT * FROM wallets WHERE wallet_address = ?", [walletAddress]);
}

/**
 * Resolves the treasury access token, requesting an outgoing-payment grant when
 * none is stored. A pending/interactive grant is left for the operator instead of
 * being blocked on (grant insufficient/invalid → operator-action-required).
 */
async function ensureTreasuryAccessToken(
  deps: DemoDeps,
  treasury: PoolWalletRow,
  treasuryWalletId: string,
): Promise<TreasuryAccess> {
  if (!deps.secretBox) {
    return { token: null, status: "MISSING", reason: "ENCRYPTION_KEY no configurada: no se pueden almacenar tokens." };
  }
  const stored = await findUsableGrant(deps.db, treasuryWalletId);
  if (stored?.access_token_enc) {
    try {
      return { token: deps.secretBox.decrypt(stored.access_token_enc), status: "AUTHORIZED" };
    } catch {
      // Corrupted/rotated key: fall through and request a fresh grant.
    }
  }

  const wallet = walletMetadataFrom(treasury);
  const grantId = randomUUID();
  const finishUri = `${deps.config.PUBLIC_BASE_URL.replace(/\/$/, "")}/auth/callback?grant_id=${grantId}`;
  const limit = maxTopUpAmount(deps.config);
  const pending = await deps.provider.requestOutgoingGrant({
    wallet,
    limit,
    finishUri,
    nonce: randomUUID(),
    ...(deps.config.OP_GRANT_INTERVAL ? { interval: deps.config.OP_GRANT_INTERVAL } : {}),
  });
  const now = nowIso();
  if (pending.kind === "granted") {
    await deps.db.run(
      `INSERT INTO grants
         (id, wallet_id, status, scopes, limit_value, limit_currency, limit_scale,
          access_token_enc, access_token_manage_uri, expires_at, created_at, updated_at)
       VALUES (?, ?, 'GRANTED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        grantId,
        treasuryWalletId,
        JSON.stringify(["outgoing-payment"]),
        limit.value,
        limit.currency,
        limit.assetScale,
        deps.secretBox.encrypt(pending.accessToken),
        pending.manageUri ?? null,
        pending.expiresAt,
        now,
        now,
      ],
    );
    await scheduleGrantTokenRotation(deps.db, { grantId, expiresAt: pending.expiresAt });
    await recordAudit(deps.db, "demo.treasury.granted", "wallet", treasuryWalletId, { grantId });
    return { token: pending.accessToken, status: "AUTHORIZED" };
  }

  await deps.db.run(
    `INSERT INTO grants
       (id, wallet_id, status, scopes, limit_value, limit_currency, limit_scale,
        continue_uri, continue_token_enc, interact_url, created_at, updated_at)
     VALUES (?, ?, 'PENDING_INTERACTION', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      grantId,
      treasuryWalletId,
      JSON.stringify(["outgoing-payment"]),
      limit.value,
      limit.currency,
      limit.assetScale,
      pending.continueUri,
      deps.secretBox.encrypt(pending.continueAccessToken),
      pending.interactUrl,
      now,
      now,
    ],
  );
  await recordAudit(deps.db, "demo.treasury.grant_pending", "wallet", treasuryWalletId, { grantId });
  return {
    token: null,
    status: "PENDING",
    reason: "El grant del treasury requiere autorización manual del operador.",
  };
}

async function findUsableGrant(db: Queryable, walletId: string): Promise<StoredGrantRow | undefined> {
  const rows = await db.all<StoredGrantRow>(
    `SELECT id, status, access_token_enc, expires_at, limit_value, limit_currency, limit_scale
       FROM grants
      WHERE wallet_id = ? AND status = 'GRANTED' AND access_token_enc IS NOT NULL
      ORDER BY created_at DESC, seq DESC`,
    [walletId],
  );
  return rows.find((row) => !row.expires_at || !isPast(row.expires_at));
}

async function findTreasuryAccessToken(deps: DemoDeps): Promise<string | null> {
  if (!deps.secretBox) {
    return null;
  }
  const treasury = await getTreasuryWallet(deps.db);
  if (!treasury) {
    return null;
  }
  const wallet = await getTreasuryWalletRow(deps.db, treasury.wallet_address);
  if (!wallet) {
    return null;
  }
  const stored = await findUsableGrant(deps.db, wallet.id);
  if (!stored?.access_token_enc) {
    return null;
  }
  try {
    return deps.secretBox.decrypt(stored.access_token_enc);
  } catch {
    return null;
  }
}

/** Inspects the known payment resource; never creates a new outgoing-payment. */
async function reconcileAssignment(
  deps: DemoDeps,
  assignment: DemoAssignmentRow,
): Promise<DemoTopUpOutcome> {
  const paymentId = assignment.funding_payment_id as string;
  const accessToken = await findTreasuryAccessToken(deps);
  const result = await reconcilePayment(
    { db: deps.db, provider: deps.provider, ...(accessToken ? { accessToken } : {}) },
    { paymentId, ...(accessToken ? { accessToken } : {}) },
  );

  if (result.outcome === "completed") {
    return setFunding(deps, assignment.id, "FUNDED", null, "AUTHORIZED");
  }
  if (result.outcome === "failed") {
    return setFunding(deps, assignment.id, "FAILED", result.reason ?? "El pago de fondeo falló.", "AUTHORIZED");
  }
  if (result.outcome === "terminal") {
    // Already terminal before reconciliation (e.g. FAILED from a prior attempt).
    const status: FundingStatus = result.state === "COMPLETED" ? "FUNDED" : "FAILED";
    return setFunding(deps, assignment.id, status, result.reason ?? null, "AUTHORIZED");
  }
  // still_processing / unresolved: keep the wallet assigned and mark for review.
  const outcome = await setFunding(
    deps,
    assignment.id,
    "RECONCILIATION_REQUIRED",
    result.reason ?? "Resultado incierto: se requiere reconciliación.",
    "AUTHORIZED",
  );
  if (result.outcome === "still_processing") {
    // Retry the read through the queue's bounded backoff (same job, no new
    // transfer). After max_attempts it stays RECONCILIATION_REQUIRED for review.
    throw new AppError(
      "NEEDS_REVIEW",
      result.reason ?? "El recurso sigue sin confirmar; se reintentará la reconciliación.",
    );
  }
  return outcome;
}

async function enqueueReconciliation(deps: DemoDeps, assignmentId: string): Promise<void> {
  await enqueueJob(deps.db, {
    type: DEMO_TOPUP_JOB,
    payload: { assignmentId },
    dedupeKey: `demo-topup:reconcile:${assignmentId}`,
    nextRunAt: isoPlusMs(RECONCILE_DELAY_MS),
  });
}

function handleExecutionError(deps: DemoDeps, assignmentId: string, error: AppError): Promise<DemoTopUpOutcome> {
  switch (error.code) {
    case "INSUFFICIENT_FUNDS":
      // Treasury lacks funds: preserve the assignment, mark funding failed.
      return setFunding(deps, assignmentId, "FAILED", `${error.code}: ${error.message}`, "AUTHORIZED");
    case "INSUFFICIENT_GRANT_BUDGET":
      return markOperatorAction(deps, assignmentId, "REJECTED", `${error.code}: ${error.message}`);
    case "NEEDS_REVIEW":
    case "QUOTE_EXPIRED":
      return markReconciliation(deps, assignmentId, error);
    case "UNAUTHORIZED":
      return markOperatorAction(deps, assignmentId, "MISSING", `${error.code}: ${error.message}`);
    default:
      return markOperatorAction(deps, assignmentId, "AUTHORIZED", `${error.code}: ${error.message}`);
  }
}

async function applyPaymentState(
  deps: DemoDeps,
  assignmentId: string,
  payment: PaymentSnapshot,
): Promise<DemoTopUpOutcome> {
  if (payment.state === "COMPLETED") {
    return setFunding(deps, assignmentId, "FUNDED", null, "AUTHORIZED");
  }
  if (payment.state === "FAILED") {
    return setFunding(deps, assignmentId, "FAILED", payment.lastError ?? "El pago falló.", "AUTHORIZED");
  }
  if (payment.state === "NEEDS_REVIEW") {
    return markReconciliation(deps, assignmentId, new AppError("NEEDS_REVIEW", payment.lastError ?? "Resultado incierto."));
  }
  // PROCESSING or any non-terminal state: keep watching the known resource.
  const outcome = await setFunding(
    deps,
    assignmentId,
    "IN_PROGRESS",
    null,
    "AUTHORIZED",
    payment.id,
  );
  await enqueueReconciliation(deps, assignmentId);
  return outcome;
}

async function markReconciliation(
  deps: DemoDeps,
  assignmentId: string,
  error: AppError,
): Promise<DemoTopUpOutcome> {
  const outcome = await setFunding(
    deps,
    assignmentId,
    "RECONCILIATION_REQUIRED",
    `${error.code}: ${error.message}`,
    "AUTHORIZED",
  );
  await enqueueReconciliation(deps, assignmentId);
  return outcome;
}

async function markOperatorAction(
  deps: DemoDeps,
  assignmentId: string,
  authorization: AuthorizationStatus,
  reason: string,
): Promise<DemoTopUpOutcome> {
  return setFunding(deps, assignmentId, "OPERATOR_ACTION_REQUIRED", reason, authorization);
}

async function setFunding(
  deps: DemoDeps,
  assignmentId: string,
  fundingStatus: FundingStatus,
  error: string | null,
  authorizationStatus: AuthorizationStatus,
  fundingPaymentId?: string,
): Promise<DemoTopUpOutcome> {
  await updateAssignmentState(deps.db, {
    id: assignmentId,
    now: nowIso(),
    fundingStatus,
    authorizationStatus,
    fundingError: error,
    ...(fundingPaymentId ? { fundingPaymentId } : {}),
  });
  const updated = (await getAssignmentById(deps.db, assignmentId)) as DemoAssignmentRow;
  return snapshot(updated);
}

function snapshot(assignment: DemoAssignmentRow): DemoTopUpOutcome {
  return {
    assignmentId: assignment.id,
    fundingStatus: assignment.funding_status,
    authorizationStatus: assignment.authorization_status,
    paymentId: assignment.funding_payment_id,
    paymentState: null,
  };
}

// --- Status -----------------------------------------------------------------

export interface DemoStatusResult {
  userId: string;
  assigned: boolean;
  /** Alias the customer can pay to reach the pool's external recipient, if any. */
  externalAlias: string | null;
  assignment: {
    id: string;
    walletAddress: string;
    poolStatus: string | null;
    registrationStatus: string;
    fundingStatus: FundingStatus;
    authorizationStatus: AuthorizationStatus;
    paymentId: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

/** Assignment + funding progress. Never exposes tokens or secrets. */
export async function getDemoStatus(
  deps: Pick<DemoDeps, "db" | "config">,
  userId: string,
): Promise<DemoStatusResult> {
  const user = await getUserRow(deps.db, userId);
  if (!user) {
    throw new AppError("NOT_FOUND", "Usuario no encontrado.");
  }
  const assignment = await getAssignmentByUserId(deps.db, userId);
  if (!assignment) {
    return { userId, assigned: false, assignment: null, externalAlias: null };
  }
  const pool = await getPoolWalletById(deps.db, assignment.pool_wallet_id);
  return {
    userId,
    assigned: true,
    externalAlias: await resolveExternalAlias(deps, userId),
    assignment: {
      id: assignment.id,
      walletAddress: assignment.wallet_address,
      poolStatus: pool?.allocation_status ?? null,
      registrationStatus: user.status,
      fundingStatus: assignment.funding_status,
      authorizationStatus: assignment.authorization_status,
      paymentId: assignment.funding_payment_id,
      lastError: assignment.funding_error,
      createdAt: assignment.created_at,
      updatedAt: assignment.updated_at,
    },
  };
}

/** The external alias only exists for a customer that actually owns the recipient. */
async function resolveExternalAlias(
  deps: Pick<DemoDeps, "db" | "config">,
  userId: string,
): Promise<string | null> {
  if (!(await getExternalRecipientWallet(deps.db))) {
    return null;
  }
  const alias = deps.config.DEMO_EXTERNAL_ALIAS;
  return (await getRecipientByAlias(deps.db, userId, alias)) ? alias : null;
}
