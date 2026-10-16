import type { AppConfig } from "../config";
import type { Db } from "../db";
import type { InboundSms, SmsProvider } from "./types";

export interface CommandContext {
  db: Db;
  config: AppConfig;
  provider: SmsProvider;
}

export interface CommandOutcome {
  reply: string;
}

export const HELP_TEXT = [
  "Comandos disponibles:",
  "PAGAR <monto> [MONEDA] A <alias>",
  "CONFIRMAR <codigo>",
  "CANCELAR <codigo>",
  "ESTADO <referencia>",
  "AYUDA",
].join("\n");

/**
 * Punto de entrada del servicio de comandos.
 * Iteración 1: parser mínimo con AYUDA funcional y el resto como marcador;
 * la lógica de pagos y confirmaciones se implementa en la vertical de pagos.
 */
export function handleInboundCommand(_ctx: CommandContext, sms: InboundSms): CommandOutcome {
  const verb = (sms.text.trim().split(/\s+/)[0] ?? "").toUpperCase();
  switch (verb) {
    case "AYUDA":
      return { reply: HELP_TEXT };
    case "PAGAR":
    case "CONFIRMAR":
    case "CANCELAR":
    case "ESTADO":
      return { reply: `${verb}: funcion en construccion (iteracion 1).` };
    default:
      return { reply: "Comando no reconocido. Escribe AYUDA." };
  }
}
