/** Tipos y enums del dominio. Se guardan como TEXT en PostgreSQL. */

export type UserStatus = "pending" | "active" | "suspended";

export type GrantStatus =
  | "PENDING_INTERACTION"
  | "GRANTED"
  | "CANCELLED"
  | "REVOKED"
  | "EXPIRED";

export type SmsDirection = "inbound" | "outbound";

export type SmsStatus = "received" | "processing" | "processed" | "sent" | "delivered" | "failed";

export type JobStatus = "pending" | "leased" | "done" | "failed";

/** Máquina de estados de un pago (spec §12). */
export type PaymentState =
  | "RECEIVED"
  | "AWAITING_CONFIRMATION"
  | "PROCESSING"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED"
  | "NEEDS_REVIEW";

export const TERMINAL_PAYMENT_STATES: readonly PaymentState[] = [
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
];

export interface Amount {
  /** Importe entero en unidades mínimas del activo, como string. */
  value: string;
  currency: string;
  assetScale: number;
}

export function isTerminal(state: PaymentState): boolean {
  return TERMINAL_PAYMENT_STATES.includes(state);
}
