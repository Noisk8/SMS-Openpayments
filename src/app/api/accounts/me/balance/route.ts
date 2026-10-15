import { NextResponse } from "next/server";
import { verSaldo } from "@/lib/balances/get-balance";
import { requireSession } from "@/lib/auth/require-session";
import { getAppContext } from "@/lib/context";
import { errorResponse } from "@/lib/http/responses";

export const runtime = "nodejs";

/** Saldo de la cuenta autenticada (no de un número arbitrario). */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const ctx = getAppContext();
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    const result = await verSaldo({ telefono: user.telefono, authorizationContext: session }, ctx);
    if (!result.success) {
      return NextResponse.json(result, { status: 501 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
