import type { PrismaClient } from "@/generated/prisma/client";
import { getEnv, type AppEnv } from "@/lib/config/env";
import { getPrisma } from "@/lib/db/prisma";
import type { PaymentProvider } from "@/lib/payments/types";
import { getPaymentProvider } from "@/lib/payments/provider-factory";
import type { SmsProvider } from "@/lib/sms/types";
import { createSmsProvider } from "@/lib/sms/provider-factory";
import { RateLimiter } from "@/lib/rate-limit/limiter";

/** Dependencias de la aplicación. Se pueden sustituir en pruebas. */
export interface AppContext {
  env: AppEnv;
  prisma: PrismaClient;
  payments: PaymentProvider;
  sms: SmsProvider;
  limits: {
    login: RateLimiter;
    verification: RateLimiter;
    transfer: RateLimiter;
    smsCommand: RateLimiter;
  };
}

export function createLimits(): AppContext["limits"] {
  return {
    login: new RateLimiter(5, 15 * 60 * 1000),
    verification: new RateLimiter(5, 15 * 60 * 1000),
    transfer: new RateLimiter(10, 60 * 1000),
    smsCommand: new RateLimiter(20, 60 * 1000),
  };
}

let context: AppContext | undefined;

/** Contexto singleton del servidor. */
export function getAppContext(): AppContext {
  if (!context) {
    const env = getEnv();
    const prisma = getPrisma();
    context = {
      env,
      prisma,
      payments: getPaymentProvider(env, prisma),
      sms: createSmsProvider(env),
      limits: createLimits(),
    };
  }
  return context;
}
