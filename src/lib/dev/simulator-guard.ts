import { getEnv } from "@/lib/config/env";
import { AppError } from "@/lib/errors";

/** El simulador solo existe en development/test y con SMS_SIMULATOR_ENABLED=true. */
export function assertSimulatorEnabled(): void {
  const env = getEnv();
  if (env.NODE_ENV === "production" || !env.SMS_SIMULATOR_ENABLED) {
    throw new AppError("NOT_AVAILABLE_IN_ENVIRONMENT", "El simulador SMS no está disponible en este entorno.");
  }
}
