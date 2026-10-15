import { AppError } from "@/lib/errors";

/** Mensaje claro para capacidades aún no verificadas con documentación oficial. */
export function pendingCapability(provider: string, capability: string, reason: string): AppError {
  return new AppError(
    "PROVIDER_ERROR",
    `${provider}: ${capability} no está disponible todavía. ${reason}`,
  );
}
