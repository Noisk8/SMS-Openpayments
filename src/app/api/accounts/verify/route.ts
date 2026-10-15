import { NextResponse } from "next/server";
import { confirmarCuenta } from "@/lib/accounts/create-account";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { getAppContext } from "@/lib/context";
import { errorResponse, readJson } from "@/lib/http/responses";

export const runtime = "nodejs";

/** Confirma el código del celular, crea la cuenta y abre sesión web. */
export async function POST(request: Request) {
  try {
    const ctx = getAppContext();
    const result = await confirmarCuenta(await readJson(request) as { telefono: string; codigo: string }, ctx);
    const response = NextResponse.json(result, { status: 201 });
    response.cookies.set(
      SESSION_COOKIE,
      createSessionToken(result.account.id),
      sessionCookieOptions(ctx.env.SESSION_TTL_SECONDS),
    );
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
