import type { AppConfig } from "../config";
import { MockSmsProvider } from "./providers/mock";
import type { SmsProvider } from "./types";

/** Selecciona el proveedor SMS según la configuración. */
export function createSmsProvider(config: AppConfig): SmsProvider {
  switch (config.SMS_PROVIDER) {
    case "mock":
      return new MockSmsProvider(config.SMS_WEBHOOK_SECRET);
    default: {
      const exhaustive: never = config.SMS_PROVIDER;
      throw new Error(`Proveedor SMS no soportado: ${String(exhaustive)}`);
    }
  }
}
