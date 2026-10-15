import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getAppContext } from "@/lib/context";
import { errorResponse } from "@/lib/http/responses";
import { AppError } from "@/lib/errors";
import { OpenPaymentsProvider } from "@/lib/payments/providers/openpayments";
import { persistOutcome } from "@/lib/transfers/send-money";
import { toWalletRef } from "@/lib/payments/providers/mock";

export const runtime = "nodejs";

/**
 * Retorno del consentimiento de Open Payments. Solo el titular de la autorización
 * puede completarla; el token se obtiene del proveedor con el interact_ref.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = requireSession(request);
    const ctx = getAppContext();
    const authorization = await ctx.prisma.paymentAuthorization.findUnique({ where: { id } });
    if (!authorization || authorization.userId !== session.userId) {
      throw new AppError("FORBIDDEN", "Autorización no válida.");
    }
    const interactRef = new URL(request.url).searchParams.get("interact_ref");
    if (!interactRef || !authorization.transactionId || !(ctx.payments instanceof OpenPaymentsProvider)) {
      throw new AppError("VALIDATION_FAILED", "Solicitud de autorización no válida.");
    }
    const transaction = await ctx.prisma.transaction.findUniqueOrThrow({
      where: { id: authorization.transactionId },
      include: { sender: true, receiver: true },
    });
    if (!transaction.senderId) {
      throw new AppError("ACCOUNT_NOT_ACTIVE", "La transacción no tiene origen.");
    }
    const senderWallet = await ctx.prisma.wallet.findFirstOrThrow({
      where: { userId: transaction.senderId, provider: ctx.payments.name },
    });
    const receiverWallet = await ctx.prisma.wallet.findFirstOrThrow({
      where: { userId: transaction.receiverId, provider: ctx.payments.name },
    });
    const outcome = await ctx.payments.resumeAuthorization(id, interactRef, {
      transactionId: transaction.id,
      reference: transaction.reference,
      sender: toWalletRef(senderWallet),
      receiver: toWalletRef(receiverWallet),
      amount: transaction.amount,
    });
    const updated = await persistOutcome(ctx, transaction.id, outcome);
    return NextResponse.json({ success: updated.status !== "FAILED", estado: updated.status, reference: updated.reference });
  } catch (error) {
    return errorResponse(error);
  }
}
