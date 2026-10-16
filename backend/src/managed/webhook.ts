import { createHmac, timingSafeEqual } from "node:crypto";
import { canonical } from "./rafiki";

/**
 * Verificación de webhooks de Rafiki (rafiki-backend v2.x).
 *
 * Rafiki envía `{ id, type, data }` con la cabecera:
 *   Rafiki-Signature: t=<ms>, v1=<hex HMAC-SHA256(secret, "<t>.<canonical({id,type,data})>")>
 * El secreto es SIGNATURE_SECRET en Rafiki y RAFIKI_WEBHOOK_SECRET aquí.
 */

export const RAFIKI_SIGNATURE_VERSION = 1;
export const RAFIKI_SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export interface RafikiEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

const signaturePattern = /^t=(\d+),\s*v(\d+)=([0-9a-f]{64})$/;

function digestFor(event: RafikiEvent, secret: string, timestamp: number): string {
  const payload = `${timestamp}.${canonical({ id: event.id, type: event.type, data: event.data })}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Cabecera Rafiki-Signature para un evento (usado por las pruebas; Rafiki la genera en producción). */
export function signRafikiEvent(event: RafikiEvent, secret: string, timestamp: number = Date.now()): string {
  return `t=${timestamp}, v${RAFIKI_SIGNATURE_VERSION}=${digestFor(event, secret, timestamp)}`;
}

/**
 * True solo si la firma es válida, reciente y el secreto está configurado.
 * Sin secreto se rechaza todo: el endpoint falla cerrado.
 */
export function verifyRafikiSignature(
  event: RafikiEvent,
  header: string | undefined,
  secret: string,
  now: number = Date.now(),
  toleranceMs: number = RAFIKI_SIGNATURE_TOLERANCE_MS,
): boolean {
  if (!secret || !header) return false;
  const match = signaturePattern.exec(header.trim());
  if (!match || Number(match[2]) !== RAFIKI_SIGNATURE_VERSION) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > toleranceMs) return false;
  const expected = Buffer.from(digestFor(event, secret, timestamp), "hex");
  const received = Buffer.from(match[3]!, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
