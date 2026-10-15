import type { Prisma } from "@/generated/prisma/client";

/** Referencia a una billetera ya conocida por la aplicación. */
export interface WalletRef {
  walletId: string;
  userId: string | null;
  provider: string;
  walletAddress: string;
  currency: string;
  assetScale: number;
}

export interface ProvisionWalletInput {
  userId: string;
  alias: string;
  walletAddress?: string;
}

export interface TransferRequest {
  transactionId: string;
  reference: string;
  sender: WalletRef;
  receiver: WalletRef;
  /** Importe en unidades mínimas del activo (escala de la billetera). */
  amount: bigint;
}

export type TransferOutcome =
  | { status: "COMPLETED"; providerTransactionId: string }
  | { status: "PROCESSING"; providerTransactionId?: string }
  | { status: "REQUIRES_AUTHORIZATION"; authorizationId: string; redirectUrl: string }
  | { status: "FAILED"; reason: string };

export type BalanceOutcome =
  | { success: true; amount: bigint; currency: string; assetScale: number }
  | { success: false; code: "BALANCE_NOT_SUPPORTED" };

/** Crea o vincula la billetera que mantiene los fondos de un usuario. */
export interface WalletProvisioningProvider {
  provisionWallet(input: ProvisionWalletInput, tx?: Prisma.TransactionClient): Promise<WalletRef>;
}

/** Ejecuta una transferencia entre dos billeteras y devuelve el estado real. */
export interface PaymentTransferProvider {
  transfer(request: TransferRequest): Promise<TransferOutcome>;
}

/** Consulta el saldo solo cuando el proveedor ofrece una API documentada para ello. */
export interface BalanceProvider {
  getBalance(wallet: WalletRef): Promise<BalanceOutcome>;
}

export interface PaymentProvider
  extends WalletProvisioningProvider,
    PaymentTransferProvider,
    BalanceProvider {
  readonly name: string;
}
