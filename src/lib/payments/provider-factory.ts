import type { PrismaClient } from "@/generated/prisma/client";
import { getEnv, type AppEnv } from "@/lib/config/env";
import { getPrisma } from "@/lib/db/prisma";
import { MockPaymentProvider } from "@/lib/payments/providers/mock";
import { OpenPaymentsProvider } from "@/lib/payments/providers/openpayments";
import type { PaymentProvider } from "@/lib/payments/types";

/** Crea el proveedor de pagos indicado por PAYMENT_PROVIDER. */
export function getPaymentProvider(
  env: AppEnv = getEnv(),
  prisma: PrismaClient = getPrisma(),
): PaymentProvider {
  switch (env.PAYMENT_PROVIDER) {
    case "mock":
      return new MockPaymentProvider(prisma, env.MOCK_CURRENCY, env.MOCK_ASSET_SCALE);
    case "openpayments":
      return OpenPaymentsProvider.fromEnv(prisma, env);
    default:
      throw new Error("Proveedor de pagos no soportado");
  }
}
