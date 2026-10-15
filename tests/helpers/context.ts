import { randomUUID } from "node:crypto";
import { resetEnvCache, getEnv } from "@/lib/config/env";
import { createPrismaClient } from "@/lib/db/prisma";
import { createLimits, type AppContext } from "@/lib/context";
import { getPaymentProvider } from "@/lib/payments/provider-factory";
import { createSmsProvider } from "@/lib/sms/provider-factory";
import type { PrismaClient } from "@/generated/prisma/client";

let prisma: PrismaClient | undefined;

export function testPrisma(): PrismaClient {
  if (!prisma) {
    prisma = createPrismaClient(process.env.DATABASE_URL);
  }
  return prisma;
}

export async function disconnectTestPrisma(): Promise<void> {
  await prisma?.$disconnect();
  prisma = undefined;
}

/** Contexto de pruebas: base de datos real, proveedores mock y límites nuevos. */
export function makeContext(overrides: Partial<AppContext> = {}): AppContext {
  resetEnvCache();
  const env = getEnv();
  const db = testPrisma();
  return {
    env,
    prisma: db,
    payments: getPaymentProvider(env, db),
    sms: createSmsProvider(env),
    limits: createLimits(),
    ...overrides,
  };
}

export async function truncateAll(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    `TRUNCATE "LedgerEntry","Transaction","PaymentAuthorization","Wallet","PhoneVerification","SmsMessage","User" RESTART IDENTITY CASCADE`,
  );
}

export function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

