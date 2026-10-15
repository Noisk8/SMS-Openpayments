import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import type {
  BalanceOutcome,
  PaymentProvider,
  ProvisionWalletInput,
  TransferOutcome,
  TransferRequest,
  WalletRef,
} from "@/lib/payments/types";

export const MOCK_TREASURY_ADDRESS = "mock://system/treasury";

type Db = Prisma.TransactionClient;

/** Saldo derivado del libro contable: créditos menos débitos. */
export async function getLedgerBalance(db: Db, walletId: string): Promise<bigint> {
  const rows = await db.$queryRaw<{ balance: bigint }[]>`
    SELECT COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END), 0)::bigint AS balance
    FROM "LedgerEntry"
    WHERE "walletId" = ${walletId}
  `;
  return rows[0]?.balance ?? 0n;
}

/** Crea (si no existe) la cuenta de tesorería que emite fondos ficticios. */
export async function ensureTreasuryWallet(db: Db, currency: string, assetScale: number): Promise<WalletRef> {
  const wallet = await db.wallet.upsert({
    where: { walletAddress: MOCK_TREASURY_ADDRESS },
    update: {},
    create: {
      provider: "mock",
      walletAddress: MOCK_TREASURY_ADDRESS,
      isSystem: true,
      currency,
      assetScale,
    },
  });
  return toWalletRef(wallet);
}

export function toWalletRef(wallet: {
  id: string;
  userId: string | null;
  provider: string;
  walletAddress: string;
  currency: string;
  assetScale: number;
}): WalletRef {
  return {
    walletId: wallet.id,
    userId: wallet.userId,
    provider: wallet.provider,
    walletAddress: wallet.walletAddress,
    currency: wallet.currency,
    assetScale: wallet.assetScale,
  };
}

/**
 * Proveedor de pagos simulado. Todos los movimientos se registran en PostgreSQL
 * dentro de una única transacción con bloqueo de filas (SELECT ... FOR UPDATE),
 * de modo que no hay saldos negativos ni actualizaciones parciales.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  constructor(
    private readonly prisma: PrismaClient,
    private readonly currency: string,
    private readonly assetScale: number,
  ) {}

  async provisionWallet(input: ProvisionWalletInput, tx: Db = this.prisma): Promise<WalletRef> {
    if (input.walletAddress) {
      throw new AppError("VALIDATION_FAILED", "El proveedor mock no admite billeteras externas.");
    }
    const wallet = await tx.wallet.create({
      data: {
        userId: input.userId,
        provider: "mock",
        walletAddress: `mock://wallet/${input.alias}`,
        currency: this.currency,
        assetScale: this.assetScale,
      },
    });
    return toWalletRef(wallet);
  }

  async getBalance(wallet: WalletRef): Promise<BalanceOutcome> {
    const amount = await getLedgerBalance(this.prisma, wallet.walletId);
    return { success: true, amount, currency: wallet.currency, assetScale: wallet.assetScale };
  }

  async transfer(request: TransferRequest): Promise<TransferOutcome> {
    const { sender, receiver } = request;
    if (sender.currency !== receiver.currency || sender.assetScale !== receiver.assetScale) {
      return { status: "FAILED", reason: "Las billeteras usan activos distintos." };
    }
    return this.prisma.$transaction((tx) => this.executeTransfer(tx, request));
  }

  private async executeTransfer(db: Db, request: TransferRequest): Promise<TransferOutcome> {
    const { sender, receiver } = request;
    const amount = request.amount;
    const [firstId, secondId] = [sender.walletId, receiver.walletId].sort();
    const locked = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Wallet"
      WHERE "id" IN (${firstId}, ${secondId})
      ORDER BY "id"
      FOR UPDATE
    `;
    if (locked.length !== 2) {
      return { status: "FAILED", reason: "Billetera no encontrada." };
    }

    const senderBalance = await getLedgerBalance(db, sender.walletId);
    if (senderBalance < amount) {
      await db.transaction.update({
        where: { id: request.transactionId },
        data: { status: "FAILED", failureReason: "INSUFFICIENT_FUNDS" },
      });
      return { status: "FAILED", reason: "Fondos insuficientes." };
    }

    await db.ledgerEntry.createMany({
      data: [
        { transactionId: request.transactionId, walletId: sender.walletId, direction: "DEBIT", amount },
        { transactionId: request.transactionId, walletId: receiver.walletId, direction: "CREDIT", amount },
      ],
    });
    const providerTransactionId = `mock-${request.transactionId}`;
    await db.transaction.update({
      where: { id: request.transactionId },
      data: { status: "COMPLETED", completedAt: new Date(), providerTransactionId },
    });
    return { status: "COMPLETED", providerTransactionId };
  }
}

/**
 * Fondea una billetera mock desde la tesorería. Solo para fixtures y seeds de desarrollo;
 * la ruta de fondeo está bloqueada fuera de development/test.
 */
export async function fundMockWallet(
  prisma: PrismaClient,
  params: { walletId: string; amount: bigint; currency: string; assetScale: number; idempotencyKey: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const treasury = await ensureTreasuryWallet(tx, params.currency, params.assetScale);
    const target = await tx.wallet.findUniqueOrThrow({ where: { id: params.walletId } });
    if (!target.userId) {
      throw new AppError("VALIDATION_FAILED", "La billetera de destino no pertenece a un usuario.");
    }
    const existing = await tx.transaction.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
    if (existing) {
      return;
    }
    const transaction = await tx.transaction.create({
      data: {
        senderId: null,
        receiverId: target.userId,
        amount: params.amount,
        currency: params.currency,
        status: "PENDING",
        provider: "mock",
        idempotencyKey: params.idempotencyKey,
        reference: `FUND-${params.idempotencyKey}`,
      },
    });
    await tx.ledgerEntry.createMany({
      data: [
        { transactionId: transaction.id, walletId: treasury.walletId, direction: "DEBIT", amount: params.amount },
        { transactionId: transaction.id, walletId: target.id, direction: "CREDIT", amount: params.amount },
      ],
    });
    await tx.transaction.update({
      where: { id: transaction.id },
      data: { status: "COMPLETED", completedAt: new Date(), providerTransactionId: `mock-fund-${transaction.id}` },
    });
  });
}
