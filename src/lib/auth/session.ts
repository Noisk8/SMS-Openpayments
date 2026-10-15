import { getEnv } from "@/lib/config/env";
import { signWithPurpose } from "@/lib/crypto/encryption";
import { timingSafeEqual } from "node:crypto";
import type { AuthorizationContext } from "@/lib/auth/context";

export const SESSION_COOKIE = "sms_session";

/** Sesión web sin estado: userId.expiraEnEpochSegundos.firma (HMAC-SHA256). */
export function createSessionToken(userId: string, now: number = Date.now()): string {
  const expires = Math.floor(now / 1000) + getEnv().SESSION_TTL_SECONDS;
  const payload = `${userId}.${expires}`;
  return `${payload}.${signWithPurpose("session", payload)}`;
}

export function verifySessionToken(token: string | undefined, now: number = Date.now()): AuthorizationContext | null {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [userId, expiresRaw, signature] = parts as [string, string, string];
  const payload = `${userId}.${expiresRaw}`;
  const expected = signWithPurpose("session", payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires * 1000 < now) {
    return null;
  }
  return { userId, channel: "web" };
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return undefined;
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
