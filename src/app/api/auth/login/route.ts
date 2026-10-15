import { NextResponse } from "next/server";
import { z } from "zod";
import { verifySecret } from "@/lib/crypto/password";
import { AppError } from "@/lib/errors";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { getAppContext } from "@/lib/context";
import { errorResponse, readJson } from "@/lib/http/responses";
import { normalizeColombianPhone } from "@/lib/validation/phone";

export const runtime = "nodejs";

const loginSchema = z.object({
  telefono: z.string().min(1).max(20),
  clave: z.string().min(1).max(128),
});

/** Inicio de sesión web con teléfono y clave. Respuesta genérica ante cualquier fallo. */
export async function POST(request: Request) {
  try {
    const ctx = getAppContext();
    const parsed = loginSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new AppError("UNAUTHORIZED", "Teléfono o clave incorrectos.");
    }
    const telefono = normalizeColombianPhone(parsed.data.telefono);
    const rate = ctx.limits.login.consume(`login:${telefono}`);
    if (!rate.allowed) {
      throw new AppError("RATE_LIMITED", "Demasiados intentos. Espera antes de volver a intentarlo.");
    }
    const user = await ctx.prisma.user.findUnique({ where: { telefono } });
    const valid = user?.passwordHash ? await verifySecret(user.passwordHash, parsed.data.clave) : false;
    if (!user || !valid) {
      throw new AppError("UNAUTHORIZED", "Teléfono o clave incorrectos.");
    }
    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions(ctx.env.SESSION_TTL_SECONDS));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
