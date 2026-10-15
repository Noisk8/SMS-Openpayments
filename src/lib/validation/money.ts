import { AppError } from "@/lib/errors";

const MAX_AMOUNT_MINOR = 10_000_000_000n;

/**
 * Convierte un importe en texto a unidades mínimas (BigInt).
 * Solo admite enteros positivos en unidades mínimas del activo.
 * No usa números de punto flotante.
 */
export function parseMinorUnits(input: string): bigint {
  const normalized = input.trim().replace(/[.,](?=\d{3}(\D|$))/g, "");
  if (!/^\d{1,13}$/.test(normalized)) {
    throw new AppError("VALIDATION_FAILED", "El monto debe ser un número entero positivo.");
  }
  const value = BigInt(normalized);
  if (value <= 0n) {
    throw new AppError("VALIDATION_FAILED", "El monto debe ser mayor que cero.");
  }
  if (value > MAX_AMOUNT_MINOR) {
    throw new AppError("VALIDATION_FAILED", "El monto excede el límite permitido.");
  }
  return value;
}

export function formatMinorUnits(amount: bigint, assetScale: number): string {
  if (assetScale === 0) {
    return amount.toString();
  }
  const factor = 10n ** BigInt(assetScale);
  const whole = amount / factor;
  const fraction = (amount % factor).toString().padStart(assetScale, "0");
  return `${whole}.${fraction}`;
}
