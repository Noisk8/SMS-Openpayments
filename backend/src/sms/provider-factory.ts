import type { AppConfig } from "../config";
import { MockSmsProvider } from "./providers/mock";
import { RelayionSmsProvider } from "./providers/relayion";
import type { SmsProvider } from "./types";

/** Selecciona el transporte SMS: simulador local o Relayion (SMS real). */
export function createSmsProvider(config: AppConfig): SmsProvider {
  switch (config.SMS_PROVIDER) {
    case "mock":
      return new MockSmsProvider(config.SMS_WEBHOOK_SECRET);
    case "relayion":
      return new RelayionSmsProvider(config);
    default: {
      const exhaustive: never = config.SMS_PROVIDER;
      throw new Error(`Proveedor SMS no soportado: ${String(exhaustive)}`);
    }
  }
}
