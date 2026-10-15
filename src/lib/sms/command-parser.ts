import { AppError } from "@/lib/errors";
import { parseMinorUnits } from "@/lib/validation/money";
import { normalizeColombianPhone } from "@/lib/validation/phone";

export type ParsedCommand =
  | { command: "CREAR"; alias: string }
  | { command: "CONFIRMAR"; code: string }
  | { command: "ENVIAR"; amount: string; destination: string }
  | { command: "SALDO" }
  | { command: "AYUDA" }
  | { command: "DESCONOCIDO" };

/**
 * Interpreta un SMS. No ejecuta nada: solo devuelve un comando tipado.
 * Formatos: CREAR <alias> | CONFIRMAR <código> | ENVIAR <monto> <teléfono> | SALDO | AYUDA
 */
export function parseCommand(body: string): ParsedCommand {
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  const [rawCommand = "", ...args] = tokens;
  const command = rawCommand.toUpperCase();

  switch (command) {
    case "CREAR": {
      if (args.length !== 1) {
        throw new AppError("VALIDATION_FAILED", "Formato: CREAR <alias>");
      }
      return { command: "CREAR", alias: args[0]!.toLowerCase() };
    }
    case "CONFIRMAR": {
      if (args.length !== 1 || !/^\d{6}$/.test(args[0]!)) {
        throw new AppError("VALIDATION_FAILED", "Formato: CONFIRMAR <código de 6 dígitos>");
      }
      return { command: "CONFIRMAR", code: args[0]! };
    }
    case "ENVIAR": {
      if (args.length !== 2) {
        throw new AppError("VALIDATION_FAILED", "Formato: ENVIAR <monto> <teléfono>");
      }
      const amount = parseMinorUnits(args[0]!);
      const destination = normalizeColombianPhone(args[1]!);
      return { command: "ENVIAR", amount: amount.toString(), destination };
    }
    case "SALDO": {
      if (args.length !== 0) {
        throw new AppError("VALIDATION_FAILED", "Formato: SALDO");
      }
      return { command: "SALDO" };
    }
    case "AYUDA":
      return { command: "AYUDA" };
    default:
      return { command: "DESCONOCIDO" };
  }
}
