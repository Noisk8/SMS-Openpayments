import { AppError } from "@/lib/errors";
import type { AuthorizationContext } from "@/lib/auth/context";
import { readCookie, SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/** Obtiene la sesión de una petición HTTP o lanza UNAUTHORIZED. */
export function requireSession(request: Request): AuthorizationContext {
  const session = verifySessionToken(readCookie(request.headers.get("cookie"), SESSION_COOKIE));
  if (!session) {
    throw new AppError("UNAUTHORIZED", "Debes iniciar sesión.");
  }
  return session;
}
