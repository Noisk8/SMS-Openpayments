import type { Amount } from "../domain";

/**
 * Frontera interna del dominio de pagos (spec §3).
 * El flujo SMS no depende del despliegue: mock/fake en local, Open Payments real en producción.
 */

export interface WalletMetadata {
  walletAddress: string;
  currency: string;
  assetScale: number;
  authServer: string;
  resourceServer: string;
}

/** Descubrimiento de metadatos de una wallet address. */
export interface WalletDirectory {
  getWalletMetadata(walletAddress: string): Promise<WalletMetadata>;
}

export interface IncomingPayment {
  id: string;
}

export interface Quote {
  id: string;
  debitAmount: Amount;
  receiveAmount: Amount;
  expiresAt: string | null;
}

export type OutgoingPaymentStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export interface OutgoingPayment {
  id: string;
  status: OutgoingPaymentStatus;
  sentAmount?: Amount;
  debitAmount?: Amount;
  error?: string;
}

export interface GrantBudgetUsage {
  limit?: Amount;
  spent?: Amount;
  remaining?: Amount;
}

export interface PendingGrant {
  kind: "pending";
  interactUrl: string;
  continueUri: string;
  continueAccessToken: string;
}

export interface GrantedAccess {
  kind: "granted";
  accessToken: string;
  expiresAt: string | null;
}

export interface OutgoingGrantRequest {
  wallet: WalletMetadata;
  limit: Amount;
  finishUri: string;
  nonce: string;
}

export interface CreateOutgoingPaymentInput {
  walletAddress: string;
  quoteId: string;
  accessToken: string;
  reference: string;
}

export interface PaymentProvider extends WalletDirectory {
  readonly name: string;
  createIncomingPayment(input: {
    wallet: WalletMetadata;
    accessToken?: string;
  }): Promise<IncomingPayment>;
  createQuote(input: {
    wallet: WalletMetadata;
    receiver: string;
    /** Exactly one of `debitAmount` / `receiveAmount` must be provided. */
    debitAmount?: Amount;
    receiveAmount?: Amount;
    accessToken?: string;
  }): Promise<Quote>;
  /** Grant interactivo para outgoing-payment, con el límite del quote. */
  requestOutgoingGrant(input: OutgoingGrantRequest): Promise<PendingGrant | GrantedAccess>;
  continueGrant(input: {
    wallet: WalletMetadata;
    continueUri: string;
    continueAccessToken: string;
    interactRef: string;
  }): Promise<GrantedAccess | null>;
  createOutgoingPayment(input: CreateOutgoingPaymentInput): Promise<OutgoingPayment>;
  getOutgoingPayment(input: { url: string; accessToken: string }): Promise<OutgoingPayment>;
  /** Presupuesto consumido del grant, si el proveedor lo soporta. */
  getGrantUsage(input: {
    wallet: WalletMetadata;
    accessToken: string;
  }): Promise<GrantBudgetUsage | null>;
  cancelGrant(input: { wallet: WalletMetadata; accessToken: string }): Promise<void>;
  rotateAccessToken(input: {
    wallet: WalletMetadata;
    accessToken: string;
  }): Promise<GrantedAccess | null>;
  revokeAccessToken(input: { wallet: WalletMetadata; accessToken: string }): Promise<void>;
}
