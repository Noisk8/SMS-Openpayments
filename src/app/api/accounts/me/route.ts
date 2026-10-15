import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getAppContext } from "@/lib/context";
import { errorResponse } from "@/lib/http/responses";

export const runtime = "nodejs";

/** Datos públicos de la cuenta autenticada. Nunca incluye claves ni secretos. */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const ctx = getAppContext();
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    const wallet = await ctx.prisma.wallet.findFirst({
      where: { userId: user.id, provider: ctx.payments.name, isSystem: false },
    });
    return NextResponse.json({
      success: true,
      account: {
        id: user.id,
        telefono: user.telefono,
        alias: user.alias,
        walletAddress: wallet?.walletAddress ?? null,
        moneda: wallet?.currency ?? null,
        provider: ctx.payments.name,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
