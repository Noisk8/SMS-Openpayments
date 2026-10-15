import { AppError } from "@/lib/errors";

/**
 * Normaliza un celular colombiano a E.164 (+57 y 10 dígitos, móviles 3XX).
 * Acepta: 3001234567, 573001234567, +573001234567, con espacios o guiones.
 */
export function normalizeColombianPhone(input: string): string {
  const digits = input.replace(/[\s\-().]/g, "");
  let national: string | undefined;

  if (/^\+57\d{10}$/.test(digits)) {
    national = digits.slice(3);
  } else if (/^57\d{10}$/.test(digits)) {
    national = digits.slice(2);
  } else if (/^\d{10}$/.test(digits)) {
    national = digits;
  }

  if (!national || !/^3\d{9}$/.test(national)) {
    throw new AppError("INVALID_PHONE", "El número debe ser un celular colombiano válido (ej: 3001234567).");
  }
  return `+57${national}`;
}

export function isColombianPhone(input: string): boolean {
  try {
    normalizeColombianPhone(input);
    return true;
  } catch {
    return false;
  }
}
