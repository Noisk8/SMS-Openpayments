import type { Db } from "../db";
import { isTerminal, type PaymentState } from "../domain";
import { AppError } from "../errors";
import { getPayment, refreshPaymentStatus } from "./service";
import type { PaymentProvider } from "./types";

/**
 * Reconciliación de pagos (spec §12): recuperación de trabajo interrumpido.
 *
 * Regla de oro: NUNCA se reintenta a ciegas. Para los pagos en PROCESSING o
 * NEEDS_REVIEW solo se consultan los recursos ya conocidos. Si no hay un
 * outgoing-payment persistido, o el recurso no responde, el pago permanece en
 * NEEDS_REVIEW y se reporta como no resuelto (revisión manual), en lugar de
 * crear un segundo outgoing-payment.
 */

export interface ReconciliationDeps {
  db: Db;
  provider: PaymentProvider;
  /** Access token por defecto para consultar los recursos. */
  accessToken?: string;
}

export type ReconcileOutcome = "completed" | "failed" | "still_processing" | "unresolved" | "terminal";

export interface ReconcileItem {
  paymentId: string;
  outcome: ReconcileOutcome;
  previousState: PaymentState;
  state: PaymentState | null;
  reason?: string;
}

export interface ReconciliationResult {
  inspected: number;
  updated: number;
  unresolved: number;
  items: ReconcileItem[];
}

/** Consulta el recurso de un único pago y decide el resultado sin reintentar la transferencia. */
export async function reconcilePayment(
  deps: ReconciliationDeps,
  input: { paymentId: string; accessToken?: string },
): Promise<ReconcileItem> {
  const payment = await getPayment(deps.db, input.paymentId);
  if (!payment) {
    throw new AppError("NOT_FOUND", `Pago no encontrado: ${input.paymentId}`);
  }
  if (isTerminal(payment.state)) {
    return {
      paymentId: payment.id,
      outcome: "terminal",
      previousState: payment.state,
      state: payment.state,
      reason: "El pago ya está en un estado terminal.",
    };
  }
  if (!payment.outgoingPaymentId) {
    // Resultado incierto sin recurso conocido: no hay nada que consultar.
    return {
      paymentId: payment.id,
      outcome: "unresolved",
      previousState: payment.state,
      state: payment.state,
      reason: "Sin recurso de outgoing-payment conocido; requiere revisión manual.",
    };
  }
  const accessToken = input.accessToken ?? deps.accessToken;
  if (!accessToken) {
    return {
      paymentId: payment.id,
      outcome: "unresolved",
      previousState: payment.state,
      state: payment.state,
      reason: "Falta access token para consultar el recurso.",
    };
  }

  try {
    const updated = await refreshPaymentStatus(
      { db: deps.db, provider: deps.provider },
      { paymentId: payment.id, accessToken },
    );
    if (updated.state === "COMPLETED") {
      return { paymentId: payment.id, outcome: "completed", previousState: payment.state, state: updated.state };
    }
    if (updated.state === "FAILED") {
      return { paymentId: payment.id, outcome: "failed", previousState: payment.state, state: updated.state };
    }
    return {
      paymentId: payment.id,
      outcome: "still_processing",
      previousState: payment.state,
      state: updated.state,
      reason: "El recurso sigue sin confirmar el pago.",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      paymentId: payment.id,
      outcome: "unresolved",
      previousState: payment.state,
      state: payment.state,
      reason,
    };
  }
}

/** Recorre los pagos en PROCESSING/NEEDS_REVIEW y los reconcilia uno a uno. */
export async function reconcilePendingPayments(
  deps: ReconciliationDeps,
  options: { limit?: number; accessToken?: string } = {},
): Promise<ReconciliationResult> {
  const rows = await deps.db.all<{ id: string }>(
    `SELECT id FROM payments
      WHERE state IN ('PROCESSING','NEEDS_REVIEW')
      ORDER BY updated_at ASC
      LIMIT ?`,
    [options.limit ?? 50],
  );

  const items: ReconcileItem[] = [];
  for (const row of rows) {
    items.push(await reconcilePayment(deps, { paymentId: row.id, accessToken: options.accessToken }));
  }

  return {
    inspected: items.length,
    updated: items.filter((item) => item.outcome === "completed" || item.outcome === "failed").length,
    unresolved: items.filter((item) => item.outcome === "unresolved" || item.outcome === "still_processing").length,
    items,
  };
}
