import type { AppConfig } from "../config";
import type { Db } from "../db";
import { HELP_TEXT, SHORT_HELP_TEXT, UNKNOWN_COMMAND_REPLY, parseCommand } from "./command-service";
import type { InboundSms, SmsProvider } from "./types";

/** Dependencies available to the legacy synchronous entry (dev SMS simulator). */
export interface CommandContext {
  db: Db;
  config: AppConfig;
  provider: SmsProvider;
}

export type { CommandOutcome } from "./command-service";
export { HELP_TEXT, SHORT_HELP_TEXT };

const ASYNC_ONLY_REPLY =
  "Este comando se procesa en segundo plano. Recibirás la respuesta por SMS en unos segundos.";

/**
 * Synchronous, transport-only entry used by the dev SMS simulator.
 *
 * The command engine that prepares payments, validates confirmation codes and
 * manages grants lives in `./command-service` and runs through the
 * `process_inbound_sms` job handler, which has the payment provider and secret
 * box. This entry only resolves the stateless commands so the simulator can
 * answer immediately; payment commands are handled asynchronously by that handler.
 */
export function handleInboundCommand(_ctx: CommandContext, sms: InboundSms): { reply: string } {
  const parsed = parseCommand(sms.text);
  if (parsed.kind === "help") {
    return { reply: parsed.short ? SHORT_HELP_TEXT : HELP_TEXT };
  }
  if (parsed.kind === "unknown") {
    return { reply: UNKNOWN_COMMAND_REPLY };
  }
  return { reply: ASYNC_ONLY_REPLY };
}
