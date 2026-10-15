import type { AppContext } from "@/lib/context";
import { AppError } from "@/lib/errors";
import type { AuthorizationContext } from "@/lib/auth/context";
import { formatMinorUnits } from "@/lib/validation/money";
import { normalizeColombianPhone } from "@/lib/validation/phone";

export interface VerSaldoInput {
  telefono: string;
  authorizationContext: AuthorizationContext;
}

export type VerSaldoResult =
  | {
      success: true;
      telefono: string;
      alias: string;
      saldo: string;
      moneda: string;
      billetera: string;
    }
  | { success: false; code: "BALANCE_NOT_SUPPORTED" };

/** Consulta el saldo solo para el titular autenticado. */
export async function verSaldo(input: VerSaldoInput, ctx: AppContext): Promise<VerSaldoResult> {
  const telefono = normalizeColombianPhone(input.telefono);
  const user = await ctx.prisma.user.findUnique({ where: { telefono } });
  if (!user || user.id !== input.authorizationContext.userId) {
    throw new AppError("FORBIDDEN", "No estás autorizado a consultar este saldo.");
  }

  const wallet = await ctx.prisma.wallet.findFirst({
    where: { userId: user.id, provider: ctx.payments.name, isSystem: false },
  });
  if (!wallet) {
    throw new AppError("ACCOUNT_NOT_FOUND", "La cuenta no tiene billetera vinculada.");
  }

  const outcome = await ctx.payments.getBalance({
    walletId: wallet.id,
    userId: user.id,
    provider: wallet.provider,
    walletAddress: wallet.walletAddress,
    currency: wallet.currency,
    assetScale: wallet.assetScale,
  });
  if (!outcome.success) {
    return outcome;
  }
  return {
    success: true,
    telefono: user.telefono,
    alias: user.alias,
    saldo: formatMinorUnits(outcome.amount, outcome.assetScale),
    moneda: outcome.currency,
    billetera: wallet.walletAddress,
  };
}
