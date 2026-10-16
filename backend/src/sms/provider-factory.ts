import type { AppConfig } from "../config";
import { MockSmsProvider } from "./providers/mock";
import type { SmsProvider } from "./types";

/** El transporte SMS disponible es el simulador local. */
export function createSmsProvider(config: AppConfig): SmsProvider {
  return new MockSmsProvider(config.SMS_WEBHOOK_SECRET);
}
