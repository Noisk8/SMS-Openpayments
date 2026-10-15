import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { fundMockWallet } from "@/lib/payments/providers/mock";
import type { AppContext } from "@/lib/context";
import { createAccountFor } from "./accounts";

export const CARLOS = "+573001234567";
export const ANDREA = "+573109876543";

/** Carlos y Andrea con el flujo real de alta y fondos ficticios por fixture. */
export async function seedCarlosAndAndrea(ctx: AppContext, prisma: PrismaClient) {
  const carlos = await createAccountFor(ctx, CARLOS, "carlos");
  const andrea = await createAccountFor(ctx, ANDREA, "andrea");
  const walletOf = async (userId: string) =>
    prisma.wallet.findFirstOrThrow({ where: { userId, provider: "mock" } });
  await fundMockWallet(prisma, {
    walletId: (await walletOf(carlos.id)).id,
    amount: 50000n,
    currency: "COP",
    assetScale: 0,
    idempotencyKey: `fixture-${randomUUID()}`,
  });
  await fundMockWallet(prisma, {
    walletId: (await walletOf(andrea.id)).id,
    amount: 10000n,
    currency: "COP",
    assetScale: 0,
    idempotencyKey: `fixture-${randomUUID()}`,
  });
  return { carlos, andrea };
}

export async function balanceOf(prisma: PrismaClient, telefono: string): Promise<bigint> {
  const user = await prisma.user.findUniqueOrThrow({ where: { telefono } });
  const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: user.id, provider: "mock" } });
  const rows = await prisma.$queryRaw<{ balance: bigint }[]>`
    SELECT COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END), 0)::bigint AS balance
    FROM "LedgerEntry" WHERE "walletId" = ${wallet.id}`;
  return rows[0]!.balance;
}
