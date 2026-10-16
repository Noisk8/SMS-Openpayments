import type { Amount } from "../domain";
import { AppError } from "../errors";

/**
 * Aritmética de importes (spec §10).
 * Los montos se guardan siempre como strings enteros escalados; toda operación
 * usa BigInt y nunca coma flotante. `assetScale` indica cuántos decimales define
 * la unidad mínima del activo, por lo que dos importes solo son comparables si
 * comparten `currency` y `assetScale`.
 */

/** Convierte el valor entero escalado a BigInt. Lanza si no es un entero válido. */
export function toBigInt(amount: Pick<Amount, "value">): bigint {
  const raw = amount.value.trim();
  if (!/^-?\d+$/.test(raw)) {
    throw new AppError("VALIDATION_FAILED", `Importe inválido: "${amount.value}" no es un entero escalado.`);
  }
  return BigInt(raw);
}

export interface Asset {
  currency: string;
  assetScale: number;
}

/** Dos importes son del mismo activo cuando coinciden moneda y escala. */
export function sameAsset(a: Asset, b: Asset): boolean {
  return a.currency === b.currency && a.assetScale === b.assetScale;
}

function requireSameAsset(a: Amount, b: Amount): void {
  if (!sameAsset(a, b)) {
    throw new AppError(
      "VALIDATION_FAILED",
      `No se pueden operar importes de activos distintos (${a.currency}@${a.assetScale} vs ${b.currency}@${b.assetScale}).`,
    );
  }
}

/** Compara dos importes del mismo activo: -1, 0 o 1. */
export function compareAmounts(a: Amount, b: Amount): number {
  requireSameAsset(a, b);
  const left = toBigInt(a);
  const right = toBigInt(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Resta b - a (mismo activo). */
export function subtractAmounts(b: Amount, a: Amount): Amount {
  requireSameAsset(a, b);
  return { ...b, value: (toBigInt(b) - toBigInt(a)).toString() };
}

/** Suma a + b (mismo activo). */
export function addAmounts(a: Amount, b: Amount): Amount {
  requireSameAsset(a, b);
  return { ...a, value: (toBigInt(a) + toBigInt(b)).toString() };
}

/** Construye un importe normalizando el valor a string entero. */
export function makeAmount(value: bigint | string, currency: string, assetScale: number): Amount {
  const big = typeof value === "bigint" ? value : BigInt(value);
  return { value: big.toString(), currency, assetScale };
}

/**
 * Representación decimal para mostrar al usuario (conversión explícita).
 * No se usa para persistir ni para aritmética.
 */
export function formatForDisplay(amount: Amount): string {
  const negative = toBigInt(amount) < 0n;
  const digits = toBigInt(amount).toString().replace("-", "");
  const scale = amount.assetScale;
  if (scale === 0) {
    return `${negative ? "-" : ""}${digits} ${amount.currency}`;
  }
  const padded = digits.padStart(scale + 1, "0");
  const whole = padded.slice(0, padded.length - scale);
  const fraction = padded.slice(padded.length - scale);
  return `${negative ? "-" : ""}${whole}.${fraction} ${amount.currency}`;
}
