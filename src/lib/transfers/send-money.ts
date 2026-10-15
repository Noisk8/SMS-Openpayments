import { randomBytes } from "node:crypto";
import type { Prisma, Transaction, TransactionStatus, User, Wallet } from "@/generated/prisma/client";
import type { AppContext } from "@/lib/context";
import { AppError } from "@/lib/errors";
import type { AuthorizationContext } from "@/lib/auth/context";
import { formatMinorUnits } from "@/lib/validation/money";
import { normalizeColombianPhone } from "@/lib/validation/phone";
import { parseSendInput } from "@/lib/validation/schemas";
import { toWalletRef } from "@/lib/payments/providers/mock";

export interface EnviarDineroInput {
  /** Teléfono de origen declarado. Debe coincidir con el titular de authorizationContext. */
  origen: string;
  destino: string;
  monto: string;
  idempotencyKey: string;
  authorizationContext: AuthorizationContext;
}

export interface TransactionView {
  id: string;
  origen: string;
  destino: string;
  monto: string;
  moneda: string;
  estado: TransactionStatus;
  reference: string;
  redirectUrl?: string;
  failureReason?: string;
}

export interface EnviarDineroResult {
  success: boolean;
  transaction: TransactionView;
}

type TransactionWithParties = Transaction & { sender: User | null; receiver: User };

/**
 * Envía dinero entre dos cuentas registradas. Es la única vía de pago del sistema:
 * la web y el SMS llaman a esta función.
 */
export async function enviarDinero(input: EnviarDineroInput, ctx: AppContext): Promise<EnviarDineroResult> {
  const origen = normalizeColombianPhone(input.origen);
  const { destino, monto, idempotencyKey } = parseSendInput({
    destino: input.destino,
    monto: input.monto,
    idempotencyKey: input.idempotencyKey,
  });

  if (origen === destino) {
    throw new AppError("SAME_ACCOUNT", "No puedes enviarte dinero a ti mismo.");
  }
  if (monto > ctx.env.MAX_TRANSFER_MINOR) {
    throw new AppError("VALIDATION_FAILED", "El monto supera el límite por transferencia.");
  }

  const sender = await ctx.prisma.user.findUnique({ where: { telefono: origen } });
  if (!sender || sender.id !== input.authorizationContext.userId) {
    throw new AppError("FORBIDDEN", "No estás autorizado a enviar dinero desde esta cuenta.");
  }
  const receiver = await ctx.prisma.user.findUnique({ where: { telefono: destino } });
  if (!receiver) {
    throw new AppError("ACCOUNT_NOT_FOUND", "El destinatario no tiene una cuenta activa.");
  }
  if (!sender.phoneVerifiedAt || !receiver.phoneVerifiedAt) {
    throw new AppError("ACCOUNT_NOT_ACTIVE", "Las cuentas deben tener el teléfono verificado.");
  }

  const rate = ctx.limits.transfer.consume(`send:${sender.id}`);
  if (!rate.allowed) {
    throw new AppError("RATE_LIMITED", "Demasiadas transferencias seguidas. Espera un momento.");
  }

  const existing = await ctx.prisma.transaction.findUnique({
    where: { idempotencyKey },
    include: { sender: true, receiver: true },
  });
  if (existing) {
    if (existing.senderId !== sender.id || existing.receiverId !== receiver.id || existing.amount !== monto) {
      throw new AppError("DUPLICATE_OPERATION", "La clave de idempotencia ya se usó con otra operación.");
    }
    return { success: existing.status !== "FAILED", transaction: await toView(existing, ctx) };
  }

  const senderWallet = await findActiveWallet(ctx, sender.id);
  const receiverWallet = await findActiveWallet(ctx, receiver.id);
  if (!senderWallet || !receiverWallet) {
    throw new AppError("ACCOUNT_NOT_ACTIVE", "Una de las cuentas no tiene billetera vinculada.");
  }

  let transaction: TransactionWithParties;
  try {
    transaction = await ctx.prisma.transaction.create({
      data: {
        senderId: sender.id,
        receiverId: receiver.id,
        amount: monto,
        currency: senderWallet.currency,
        status: "PENDING",
        provider: ctx.payments.name,
        idempotencyKey,
        reference: generateReference(),
      },
      include: { sender: true, receiver: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await ctx.prisma.transaction.findUniqueOrThrow({
        where: { idempotencyKey },
        include: { sender: true, receiver: true },
      });
      return { success: raced.status !== "FAILED", transaction: await toView(raced, ctx) };
    }
    throw error;
  }

  const outcome = await ctx.payments.transfer({
    transactionId: transaction.id,
    reference: transaction.reference,
    sender: toWalletRef(senderWallet),
    receiver: toWalletRef(receiverWallet),
    amount: monto,
  });

  const updated = await persistOutcome(ctx, transaction.id, outcome);
  return { success: updated.status !== "FAILED", transaction: await toView(updated, ctx) };
}

export async function persistOutcome(
  ctx: AppContext,
  transactionId: string,
  outcome: Awaited<ReturnType<AppContext["payments"]["transfer"]>>,
): Promise<TransactionWithParties> {
  const data: Prisma.TransactionUpdateInput = {};
  switch (outcome.status) {
    case "COMPLETED":
      data.status = "COMPLETED";
      data.completedAt = new Date();
      data.providerTransactionId = outcome.providerTransactionId;
      break;
    case "PROCESSING":
      data.status = "PROCESSING";
      data.providerTransactionId = outcome.providerTransactionId;
      break;
    case "REQUIRES_AUTHORIZATION":
      data.status = "REQUIRES_AUTHORIZATION";
      break;
    case "FAILED":
      data.status = "FAILED";
      data.failureReason = outcome.reason.slice(0, 200);
      break;
  }
  return ctx.prisma.transaction.update({
    where: { id: transactionId },
    data,
    include: { sender: true, receiver: true },
  });
}

async function findActiveWallet(ctx: AppContext, userId: string): Promise<Wallet | null> {
  return ctx.prisma.wallet.findFirst({
    where: { userId, provider: ctx.payments.name, isSystem: false },
  });
}

async function toView(transaction: TransactionWithParties, ctx: AppContext): Promise<TransactionView> {
  const redirectUrl = transaction.status === "REQUIRES_AUTHORIZATION"
    ? await findAuthorizationRedirect(ctx, transaction.id)
    : undefined;
  return {
    id: transaction.id,
    origen: transaction.sender?.telefono ?? "",
    destino: transaction.receiver.telefono,
    monto: formatMinorUnits(transaction.amount, ctx.env.MOCK_ASSET_SCALE),
    moneda: transaction.currency,
    estado: transaction.status,
    reference: transaction.reference,
    redirectUrl,
    failureReason: transaction.status === "FAILED" ? transaction.failureReason ?? undefined : undefined,
  };
}

async function findAuthorizationRedirect(ctx: AppContext, transactionId: string): Promise<string | undefined> {
  const authorization = await ctx.prisma.paymentAuthorization.findFirst({
    where: { transactionId, status: "REQUIRES_AUTHORIZATION" },
    select: { interactRedirectUrl: true },
  });
  return authorization?.interactRedirectUrl ?? undefined;
}

function generateReference(): string {
  return `TX${randomBytes(4).toString("hex").toUpperCase()}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

