import { cookies } from "next/headers";
import type { AuthorizationContext } from "@/lib/auth/context";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/** Sesión web actual para componentes de servidor. Devuelve null si no hay sesión válida. */
export async function getWebSession(): Promise<AuthorizationContext | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}
