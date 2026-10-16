import { randomUUID } from "node:crypto";
import type { Amount, PaymentState } from "../domain";
import type { Db } from "../db";
import { isUniqueViolation } from "../db/sqlite-errors";
import { AppError } from "../errors";
import { isPast, nowIso } from "../util/time";
import { compareAmounts, sameAsset } from "./amount";
import type {
  GrantedAccess,
  OutgoingPayment,
  PaymentProvider,
  PendingGrant,
  WalletMetadata,
} from "./types";

/**
 * Orquestación del flujo de pago (spec §9).
 *
 * Cubre las fases que pertenecen al dominio de pagos:
 *   1-2. resolver metadatos de wallet emisora y receptora,
 *   3-4. crear incoming-payment y quote (con sus grants no interactivos),
 *   5.   persistir los snapshots de montos y la vigencia del quote,
 *   8-11. reclamar el pago de forma atómica, crear el outgoing-payment y
 *         persistir el estado que confirme el recurso.
 *
 * El envío de SMS de confirmación y la autenticación del comando viven en el
 * dominio SMS; aquí se exponen las operaciones de pago que ese dominio consume.
 */

export interface PaymentServiceDeps {
  db: Db;
  provider: PaymentProvider;
}

export interface PaymentSnapshot {
  id: string;
  reference: string;
  state: PaymentState;
  senderUserId: string;
  senderWalletId: string;
  recipientWalletAddress: string;
  debitAmount: Amount | null;
  receiveAmount: Amount | null;
  quoteId: string | null;
  quoteExpiresAt: string | null;
  incomingPaymentId: string | null;
  outgoingPaymentId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PreparePaymentInput {
  senderUserId: string;
  /** Id de la fila en `wallets` del remitente. */
  senderWalletId: string;
  /** Wallet address del remitente (para descubrir metadatos). */
  senderWalletAddress: string;
  /** Wallet address del receptor ya resuelta (alias/teléfono/wallet explícita). */
  recipientWalletAddress: string;
  /** Importe solicitado en la escala del wallet de origen. */
  debitAmount: Amount;
  recipientId?: string | null;
  reference?: string;
  idempotencyKey?: string;
}

export interface ExecutePaymentInput {
  paymentId: string;
  /** Access token del grant de outgoing-payment obtenido en la autorización. */
  accessToken: string;
  /** Referencia a adjuntar al recurso; por defecto la del pago. */
  reference?: string;
}

interface PaymentRow {
  id: string;
  reference: string;
  sender_user_id: string;
  sender_wallet_id: string;
  recipient_wallet_address: string;
  state: PaymentState;
  debit_value: string | null;
  debit_currency: string | null;
  debit_scale: number | null;
  receive_value: string | null;
  receive_currency: string | null;
  receive_scale: number | null;
  quote_id: string | null;
  quote_expires_at: string | null;
  incoming_payment_id: string | null;
  outgoing_payment_id: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

// --- Lectura -----------------------------------------------------------------

export function getPayment(db: Db, id: string): PaymentSnapshot | null {
  const row = db.prepare(`SELECT * FROM payments WHERE id = ?`).get(id) as PaymentRow | undefined;
  return row ? toSnapshot(row) : null;
}

export function findPaymentByIdempotencyKey(db: Db, key: string): PaymentSnapshot | null {
  const row = db.prepare(`SELECT * FROM payments WHERE idempotency_key = ?`).get(key) as PaymentRow | undefined;
  return row ? toSnapshot(row) : null;
}

// --- Fase de preparación (spec §9.2-§9.5) ------------------------------------

/**
 * Resuelve metadatos, crea incoming-payment y quote, y persiste el pago en
 * AWAITING_CONFIRMATION con los montos y la vigencia del quote.
 * No mantiene transacciones abiertas durante las llamadas de red.
 */
export async function preparePayment(
  deps: PaymentServiceDeps,
  input: PreparePaymentInput,
): Promise<PaymentSnapshot> {
  const { db, provider } = deps;

  if (input.idempotencyKey) {
    const existing = findPaymentByIdempotencyKey(db, input.idempotencyKey);
    if (existing) {
      return existing;
    }
  }

  const senderWallet = await provider.getWalletMetadata(input.senderWalletAddress);
  if (!sameAsset(input.debitAmount, senderWallet)) {
    throw new AppError(
      "VALIDATION_FAILED",
      `El importe no coincide con el activo del wallet (${senderWallet.currency}@${senderWallet.assetScale}).`,
      { currency: senderWallet.currency, assetScale: senderWallet.assetScale },
    );
  }
  const recipientWallet = await provider.getWalletMetadata(input.recipientWalletAddress);

  const incoming = await provider.createIncomingPayment({ wallet: recipientWallet });
  const quote = await provider.createQuote({
    wallet: senderWallet,
    receiver: incoming.id,
    debitAmount: input.debitAmount,
  });

  const id = randomUUID();
  const reference = input.reference ?? `ref-${randomUUID()}`;
  const now = nowIso();
  try {
    db.prepare(
      `INSERT INTO payments (
         id, reference, sender_user_id, sender_wallet_id, recipient_id, recipient_wallet_address,
         state, debit_value, debit_currency, debit_scale,
         receive_value, receive_currency, receive_scale,
         quote_id, quote_expires_at, incoming_payment_id, idempotency_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'AWAITING_CONFIRMATION', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      reference,
      input.senderUserId,
      input.senderWalletId,
      input.recipientId ?? null,
      input.recipientWalletAddress,
      quote.debitAmount.value,
      quote.debitAmount.currency,
      quote.debitAmount.assetScale,
      quote.receiveAmount.value,
      quote.receiveAmount.currency,
      quote.receiveAmount.assetScale,
      quote.id,
      quote.expiresAt,
      incoming.id,
      input.idempotencyKey ?? null,
      now,
      now,
    );
  } catch (error) {
    // Carrera de idempotencia: otro hilo insertó el mismo trabajo antes.
    if (isUniqueViolation(error) && input.idempotencyKey) {
      const existing = findPaymentByIdempotencyKey(db, input.idempotencyKey);
      if (existing) {
        return existing;
      }
    }
    throw error;
  }

  return getPayment(db, id) as PaymentSnapshot;
}

// --- Grants (spec §9, §13) ---------------------------------------------------

/** Solicita el grant interactivo del outgoing-payment con el límite del quote. */
export async function requestOutgoingAccess(
  deps: PaymentServiceDeps,
  input: { wallet: WalletMetadata; limit: Amount; finishUri: string; nonce: string },
): Promise<PendingGrant | GrantedAccess> {
  return deps.provider.requestOutgoingGrant(input);
}

/** Completa el grant interactivo tras la interacción del usuario. */
export async function continueOutgoingAccess(
  deps: PaymentServiceDeps,
  input: { wallet: WalletMetadata; continueUri: string; continueAccessToken: string; interactRef: string },
): Promise<GrantedAccess | null> {
  return deps.provider.continueGrant(input);
}

// --- Ejecución (spec §9.8-§9.11) --------------------------------------------

/**
 * Reclama el pago de forma atómica y crea el outgoing-payment.
 *
 * Reglas clave:
 * - Un quote vencido no se ejecuta: exige reconfirmación (QUOTE_EXPIRED).
 * - El presupuesto del grant y los fondos se distinguen por código de error.
 * - Un fallo incierto (timeout) NO se reintenta a ciegas: pasa a NEEDS_REVIEW.
 * - El estado COMPLETED solo lo confirma el recurso consultado.
 */
export async function executePayment(
  deps: PaymentServiceDeps,
  input: ExecutePaymentInput,
): Promise<PaymentSnapshot> {
  const { db, provider } = deps;

  let payment = getPayment(db, input.paymentId);
  if (!payment) {
    throw new AppError("NOT_FOUND", `Pago no encontrado: ${input.paymentId}`);
  }
  if (payment.state === "PROCESSING") {
    // Ya reclamado por otro ejecutor: no se duplica el outgoing-payment.
    return payment;
  }
  if (payment.state === "NEEDS_REVIEW") {
    throw new AppError("NEEDS_REVIEW", "El pago requiere revisión manual antes de reintentar.");
  }
  if (payment.state !== "AWAITING_CONFIRMATION") {
    throw new AppError("CONFLICT", `El pago está en estado ${payment.state} y no admite ejecución.`);
  }

  if (payment.quoteExpiresAt && isPast(payment.quoteExpiresAt)) {
    // El quote venció: se mantiene en AWAITING_CONFIRMATION para reconfirmar.
    throw new AppError("QUOTE_EXPIRED", "El quote venció; se requiere una nueva confirmación.", {
      quoteId: payment.quoteId,
      quoteExpiresAt: payment.quoteExpiresAt,
    });
  }

  const claimed = claimForExecution(db, payment.id);
  if (!claimed) {
    payment = getPayment(db, input.paymentId) as PaymentSnapshot;
    if (payment.state === "PROCESSING") {
      return payment;
    }
    throw new AppError("CONFLICT", "El pago ya no está disponible para ejecución.");
  }
  payment = claimed;

  const walletRow = db
    .prepare(`SELECT wallet_address FROM wallets WHERE id = ?`)
    .get(payment.senderWalletId) as { wallet_address: string } | undefined;
  if (!walletRow) {
    const error = new AppError("NOT_FOUND", "No se encontró la wallet emisora del pago.");
    markFailed(db, payment.id, error);
    throw error;
  }
  const senderWallet = await provider.getWalletMetadata(walletRow.wallet_address);

  // Presupuesto de autorización: comprobación best-effort antes de crear el pago.
  // El proveedor puede no soportar la consulta (devuelve null) o fallar de forma
  // transitoria; en ese caso la verificación autoritativa la hace el recurso al
  // crear el outgoing-payment.
  if (payment.debitAmount) {
    let usage: { remaining?: Amount } | null = null;
    try {
      usage = await provider.getGrantUsage({ wallet: senderWallet, accessToken: input.accessToken });
    } catch {
      usage = null;
    }
    if (usage?.remaining && compareAmounts(payment.debitAmount, usage.remaining) > 0) {
      const error = new AppError("INSUFFICIENT_GRANT_BUDGET", "El importe supera el presupuesto autorizado.", {
        requested: payment.debitAmount.value,
        remaining: usage.remaining.value,
      });
      markFailed(db, payment.id, error);
      throw error;
    }
  }

  let outgoing: OutgoingPayment;
  try {
    outgoing = await provider.createOutgoingPayment({
      walletAddress: walletRow.wallet_address,
      quoteId: payment.quoteId as string,
      accessToken: input.accessToken,
      reference: input.reference ?? payment.reference,
    });
  } catch (error) {
    if (error instanceof AppError && (error.code === "INSUFFICIENT_GRANT_BUDGET" || error.code === "INSUFFICIENT_FUNDS")) {
      markFailed(db, payment.id, error);
      throw error;
    }
    // Resultado incierto: el recurso pudo crearse. No se reintenta a ciegas.
    markNeedsReview(db, payment.id, error);
    return getPayment(db, payment.id) as PaymentSnapshot;
  }

  // Se persiste el id del recurso y el débito confirmado por el recurso (si lo trae).
  db.prepare(
    `UPDATE payments SET outgoing_payment_id = ?, debit_value = ?, debit_currency = ?, debit_scale = ?,
        updated_at = ?
      WHERE id = ?`,
  ).run(
    outgoing.id,
    outgoing.debitAmount?.value ?? payment.debitAmount?.value ?? null,
    outgoing.debitAmount?.currency ?? payment.debitAmount?.currency ?? null,
    outgoing.debitAmount?.assetScale ?? payment.debitAmount?.assetScale ?? null,
    nowIso(),
    payment.id,
  );

  // Se confirma consultando el recurso: crear el outgoing-payment NO es prueba
  // de que se haya completado.
  try {
    return await refreshPaymentStatus(
      { db, provider },
      { paymentId: payment.id, accessToken: input.accessToken },
    );
  } catch (error) {
    markNeedsReview(db, payment.id, error);
    return getPayment(db, payment.id) as PaymentSnapshot;
  }
}

/**
 * Consulta el recurso de outgoing-payment y persiste el estado confirmado.
 * Lanza si el proveedor falla: la decisión (revisión manual vs reintento) es del
 * llamador, no de esta función.
 */
export async function refreshPaymentStatus(
  deps: PaymentServiceDeps,
  input: { paymentId: string; accessToken: string },
): Promise<PaymentSnapshot> {
  const payment = getPayment(deps.db, input.paymentId);
  if (!payment) {
    throw new AppError("NOT_FOUND", `Pago no encontrado: ${input.paymentId}`);
  }
  if (!payment.outgoingPaymentId) {
    throw new AppError("NEEDS_REVIEW", "El pago no tiene un recurso de outgoing-payment que consultar.");
  }
  const outgoing = await deps.provider.getOutgoingPayment({
    url: payment.outgoingPaymentId,
    accessToken: input.accessToken,
  });
  applyProviderStatus(deps.db, payment.id, outgoing);
  return getPayment(deps.db, payment.id) as PaymentSnapshot;
}

// --- Persistencia interna ----------------------------------------------------

function claimForExecution(db: Db, id: string): PaymentSnapshot | null {
  const row = db
    .prepare(
      `UPDATE payments SET state = 'PROCESSING', updated_at = ?
        WHERE id = ? AND state = 'AWAITING_CONFIRMATION'
        RETURNING *`,
    )
    .get(nowIso(), id) as PaymentRow | undefined;
  return row ? toSnapshot(row) : null;
}

/** Traduce el estado del recurso a una transición persistida. */
function applyProviderStatus(db: Db, paymentId: string, outgoing: OutgoingPayment): void {
  const state: PaymentState = outgoing.status === "COMPLETED" ? "COMPLETED" : outgoing.status === "FAILED" ? "FAILED" : "PROCESSING";
  db.prepare(
    `UPDATE payments SET state = ?, last_error = ?, updated_at = ? WHERE id = ?`,
  ).run(state, outgoing.status === "COMPLETED" ? null : outgoing.error ?? null, nowIso(), paymentId);
}

function markFailed(db: Db, paymentId: string, error: AppError): void {
  db.prepare(`UPDATE payments SET state = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?`).run(
    `${error.code}: ${error.message}`,
    nowIso(),
    paymentId,
  );
}

function markNeedsReview(db: Db, paymentId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  db.prepare(`UPDATE payments SET state = 'NEEDS_REVIEW', last_error = ?, updated_at = ? WHERE id = ?`).run(
    message,
    nowIso(),
    paymentId,
  );
}

// --- Mapeo de filas ----------------------------------------------------------

function amount(
  value: string | null,
  currency: string | null,
  assetScale: number | null,
): Amount | null {
  if (value === null || currency === null || assetScale === null) {
    return null;
  }
  return { value, currency, assetScale };
}

function toSnapshot(row: PaymentRow): PaymentSnapshot {
  return {
    id: row.id,
    reference: row.reference,
    state: row.state,
    senderUserId: row.sender_user_id,
    senderWalletId: row.sender_wallet_id,
    recipientWalletAddress: row.recipient_wallet_address,
    debitAmount: amount(row.debit_value, row.debit_currency, row.debit_scale),
    receiveAmount: amount(row.receive_value, row.receive_currency, row.receive_scale),
    quoteId: row.quote_id,
    quoteExpiresAt: row.quote_expires_at,
    incomingPaymentId: row.incoming_payment_id,
    outgoingPaymentId: row.outgoing_payment_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
