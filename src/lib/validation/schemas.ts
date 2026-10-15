import { z } from "zod";
import { AppError } from "@/lib/errors";
import { normalizeColombianPhone } from "@/lib/validation/phone";
import { parseMinorUnits } from "@/lib/validation/money";

const phoneField = z.string().min(1).max(20);
const aliasField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{2,19}$/, "El alias debe tener 3-20 caracteres: letras, números o guion bajo.");
const claveField = z.string().min(8, "La clave debe tener al menos 8 caracteres.").max(128);
const walletField = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://") || value.startsWith("http://localhost"), {
    message: "La wallet address debe usar HTTPS.",
  });
const codeField = z.string().regex(/^\d{6}$/, "El código debe tener 6 dígitos.");
const idempotencyField = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export const createAccountSchema = z.object({
  telefono: phoneField,
  alias: aliasField,
  clave: claveField.optional(),
  walletAddress: walletField.optional(),
});

export const verifySchema = z.object({
  telefono: phoneField,
  codigo: codeField,
});

export const sendMoneySchema = z.object({
  destino: phoneField,
  monto: z.string().min(1).max(20),
  idempotencyKey: idempotencyField,
});

export function zodToAppError(error: z.ZodError): AppError {
  const first = error.issues[0];
  return new AppError("VALIDATION_FAILED", first?.message ?? "Datos no válidos.");
}

function safeParse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw zodToAppError(result.error);
  }
  return result.data;
}

export function parseCreateAccountInput(input: unknown) {
  const data = safeParse(createAccountSchema, input);
  return {
    telefono: normalizePhoneOrThrow(data.telefono),
    alias: data.alias,
    clave: data.clave,
    walletAddress: data.walletAddress,
  };
}

export function parseVerifyInput(input: unknown) {
  const data = safeParse(verifySchema, input);
  return { telefono: normalizePhoneOrThrow(data.telefono), codigo: data.codigo };
}

export function parseSendInput(input: unknown) {
  const data = safeParse(sendMoneySchema, input);
  return {
    destino: normalizePhoneOrThrow(data.destino),
    monto: parseMinorUnits(data.monto),
    idempotencyKey: data.idempotencyKey,
  };
}

function normalizePhoneOrThrow(value: string): string {
  return normalizeColombianPhone(value);
}
