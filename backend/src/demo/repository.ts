import { randomUUID } from "node:crypto";
import type { Queryable } from "../db";

/**
 * Persistence for the demo wallet pool.
 *
 * Everything here is raw, parameterized SQL. Functions that take a `Queryable`
 * are meant to run inside a transaction (`Db.transaction`) so that the
 * reservation, the wallet link and the assignment commit atomically.
 */

export type PoolRole = "TREASURY" | "CUSTOMER";
export type PoolAllocationStatus = "AVAILABLE" | "RESERVED" | "ASSIGNED";
export type FundingStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "FUNDED"
  | "FAILED"
  | "OPERATOR_ACTION_REQUIRED"
  | "RECONCILIATION_REQUIRED";
export type AuthorizationStatus = "PENDING" | "AUTHORIZED" | "MISSING" | "REJECTED";

export interface PoolWalletRow {
  id: string;
  wallet_address: string;
  role: PoolRole;
  allocation_status: PoolAllocationStatus;
  assigned_user_id: string | null;
  currency: string;
  asset_scale: number;
  auth_server: string | null;
  resource_server: string | null;
  metadata: string;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoAssignmentRow {
  id: string;
  user_id: string;
  pool_wallet_id: string;
  wallet_id: string;
  wallet_address: string;
  onboarding_key: string;
  registration_source: string;
  funding_status: FundingStatus;
  authorization_status: AuthorizationStatus;
  funding_payment_id: string | null;
  funding_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PoolWalletInput {
  walletAddress: string;
  role: PoolRole;
  currency: string;
  assetScale: number;
  authServer: string | null;
  resourceServer: string | null;
  metadata: Record<string, unknown>;
  now: string;
}

export async function getPoolWalletByAddress(
  db: Queryable,
  walletAddress: string,
): Promise<PoolWalletRow | undefined> {
  return db.get<PoolWalletRow>("SELECT * FROM demo_wallet_pool WHERE wallet_address = ?", [walletAddress]);
}

export async function getPoolWalletById(db: Queryable, id: string): Promise<PoolWalletRow | undefined> {
  return db.get<PoolWalletRow>("SELECT * FROM demo_wallet_pool WHERE id = ?", [id]);
}

export async function getTreasuryWallet(db: Queryable): Promise<PoolWalletRow | undefined> {
  return db.get<PoolWalletRow>(
    "SELECT * FROM demo_wallet_pool WHERE role = 'TREASURY' ORDER BY seq ASC LIMIT 1",
  );
}

/** Inserts a new pool wallet. Callers must have checked for duplicates first. */
export async function insertPoolWallet(db: Queryable, input: PoolWalletInput): Promise<PoolWalletRow> {
  const id = randomUUID();
  const row = await db.get<PoolWalletRow>(
    `INSERT INTO demo_wallet_pool
       (id, wallet_address, role, allocation_status, assigned_user_id,
        currency, asset_scale, auth_server, resource_server, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'AVAILABLE', NULL, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      id,
      input.walletAddress,
      input.role,
      input.currency,
      input.assetScale,
      input.authServer,
      input.resourceServer,
      JSON.stringify(input.metadata),
      input.now,
      input.now,
    ],
  );
  return row as PoolWalletRow;
}

/**
 * Refreshes discovered metadata of an AVAILABLE wallet only. Assigned wallets
 * are never touched: repeated imports must not reset assignments or funding.
 */
export async function refreshPoolWalletMetadata(
  db: Queryable,
  input: PoolWalletInput & { id: string },
): Promise<void> {
  await db.run(
    `UPDATE demo_wallet_pool
        SET currency = ?, asset_scale = ?, auth_server = ?, resource_server = ?, metadata = ?, updated_at = ?
      WHERE id = ? AND allocation_status = 'AVAILABLE'`,
    [
      input.currency,
      input.assetScale,
      input.authServer,
      input.resourceServer,
      JSON.stringify(input.metadata),
      input.now,
      input.id,
    ],
  );
}

/**
 * Atomically reserves one AVAILABLE customer wallet for a user (status
 * `RESERVED`, owner set). Callers upgrade it to `ASSIGNED` in the same
 * transaction once the assignment row is written.
 *
 * `FOR UPDATE SKIP LOCKED` makes concurrent registrations skip the row another
 * transaction already locked, so the same wallet can never be handed out twice.
 * Returns `undefined` when the pool is exhausted.
 */
export async function reserveCustomerWallet(
  tx: Queryable,
  userId: string,
  now: string,
): Promise<PoolWalletRow | undefined> {
  return tx.get<PoolWalletRow>(
    `UPDATE demo_wallet_pool
        SET allocation_status = 'RESERVED', assigned_user_id = ?, assigned_at = ?, updated_at = ?
      WHERE id = (
        SELECT id FROM demo_wallet_pool
         WHERE role = 'CUSTOMER' AND allocation_status = 'AVAILABLE'
         ORDER BY seq ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [userId, now, now],
  );
}

/** Promotes a RESERVED wallet to ASSIGNED once its assignment is persisted. */
export async function markPoolWalletAssigned(tx: Queryable, id: string, now: string): Promise<void> {
  await tx.run(
    `UPDATE demo_wallet_pool SET allocation_status = 'ASSIGNED', updated_at = ? WHERE id = ?`,
    [now, id],
  );
}

export async function getAssignmentByUserId(
  db: Queryable,
  userId: string,
): Promise<DemoAssignmentRow | undefined> {
  return db.get<DemoAssignmentRow>("SELECT * FROM demo_assignments WHERE user_id = ?", [userId]);
}

export async function getAssignmentById(db: Queryable, id: string): Promise<DemoAssignmentRow | undefined> {
  return db.get<DemoAssignmentRow>("SELECT * FROM demo_assignments WHERE id = ?", [id]);
}

export interface InsertAssignmentInput {
  userId: string;
  poolWalletId: string;
  walletId: string;
  walletAddress: string;
  onboardingKey: string;
  now: string;
}

export async function insertAssignment(
  tx: Queryable,
  input: InsertAssignmentInput,
): Promise<DemoAssignmentRow> {
  const id = randomUUID();
  const row = await tx.get<DemoAssignmentRow>(
    `INSERT INTO demo_assignments
       (id, user_id, pool_wallet_id, wallet_id, wallet_address, onboarding_key,
        registration_source, funding_status, authorization_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'DEMO', 'PENDING', 'PENDING', ?, ?)
     RETURNING *`,
    [
      id,
      input.userId,
      input.poolWalletId,
      input.walletId,
      input.walletAddress,
      input.onboardingKey,
      input.now,
      input.now,
    ],
  );
  return row as DemoAssignmentRow;
}

export interface UpdateAssignmentStateInput {
  id: string;
  now: string;
  fundingStatus?: FundingStatus;
  authorizationStatus?: AuthorizationStatus;
  fundingPaymentId?: string | null;
  fundingError?: string | null;
}

/** Applies the fields that are explicitly provided, leaving the rest untouched. */
export async function updateAssignmentState(
  db: Queryable,
  input: UpdateAssignmentStateInput,
): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [input.now];
  if (input.fundingStatus !== undefined) {
    sets.push("funding_status = ?");
    params.push(input.fundingStatus);
  }
  if (input.authorizationStatus !== undefined) {
    sets.push("authorization_status = ?");
    params.push(input.authorizationStatus);
  }
  if (input.fundingPaymentId !== undefined) {
    sets.push("funding_payment_id = ?");
    params.push(input.fundingPaymentId);
  }
  if (input.fundingError !== undefined) {
    sets.push("funding_error = ?");
    params.push(input.fundingError);
  }
  params.push(input.id);
  await db.run(`UPDATE demo_assignments SET ${sets.join(", ")} WHERE id = ?`, params);
}
