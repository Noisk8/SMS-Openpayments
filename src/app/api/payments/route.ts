import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getAppContext } from "@/lib/context";
import { errorResponse, readJson } from "@/lib/http/responses";
import { enviarDinero } from "@/lib/transfers/send-money";

export const runtime = "nodejs";

/** Envío de dinero desde la sesión autenticada. El origen nunca se toma del cliente. */
export async function POST(request: Request) {
  try {
    const session = requireSession(request);
    const ctx = getAppContext();
    const body = (await readJson(request)) as Record<string, unknown>;
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    const result = await enviarDinero(
      {
        origen: user.telefono,
        destino: String(body.destino ?? ""),
        monto: String(body.monto ?? ""),
        idempotencyKey: String(body.idempotencyKey ?? ""),
        authorizationContext: session,
      },
      ctx,
    );
    const status = result.transaction.estado === "COMPLETED" ? 201 : result.success ? 202 : 422;
    return NextResponse.json(result, { status });
  } catch (error) {
    return errorResponse(error);
  }
}
