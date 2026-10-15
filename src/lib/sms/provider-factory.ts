import { getEnv, type AppEnv } from "@/lib/config/env";
import { GenericSmsProvider } from "@/lib/sms/providers/generic";
import { InalambriaSmsProvider } from "@/lib/sms/providers/inalambria";
import { MockSmsProvider } from "@/lib/sms/providers/mock";
import { OnurixSmsProvider } from "@/lib/sms/providers/onurix";
import { TwilioSmsProvider } from "@/lib/sms/providers/twilio";
import type { SmsProvider } from "@/lib/sms/types";

let mockSingleton: MockSmsProvider | undefined;

/** Instancia compartida del proveedor simulado (la bandeja de salida vive aquí). */
export function getMockSmsProvider(): MockSmsProvider {
  if (!mockSingleton) {
    mockSingleton = new MockSmsProvider();
  }
  return mockSingleton;
}

/** Selecciona el proveedor SMS indicado por SMS_PROVIDER. No acepta entrada del navegador. */
export function createSmsProvider(env: AppEnv = getEnv()): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case "mock":
      return getMockSmsProvider();
    case "twilio":
      return new TwilioSmsProvider(env);
    case "onurix":
      return new OnurixSmsProvider(env);
    case "inalambria":
      return new InalambriaSmsProvider(env);
    case "generic":
      return new GenericSmsProvider(env);
    default:
      throw new Error("Unsupported SMS provider");
  }
}
