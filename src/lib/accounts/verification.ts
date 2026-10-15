import { randomInt } from "node:crypto";

export const VERIFICATION_TTL_MS = 10 * 60 * 1000;
export const MAX_VERIFICATION_ATTEMPTS = 5;

/** Código numérico de 6 dígitos para verificar el control del celular. */
export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function verificationMessage(code: string): string {
  return `SMS Pagos: tu código de verificación es ${code}. Vence en 10 minutos. No lo compartas.`;
}
