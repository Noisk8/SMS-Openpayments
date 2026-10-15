/**
 * Datos ficticios para desarrollo local: Carlos (50000 COP) y Andrea (10000 COP).
 * Se niega a ejecutarse en producción.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/lib/db/prisma";
import { MockPaymentProvider, fundMockWallet } from "../src/lib/payments/providers/mock";
import { normalizeColombianPhone } from "../src/lib/validation/phone";

const FIXTURES = [
  { telefono: "3001234567", alias: "carlos", funding: 50000n },
  { telefono: "3109876543", alias: "andrea", funding: 10000n },
] as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("El seed de datos ficticios no puede ejecutarse en producción.");
  }
  const prisma = createPrismaClient();
  const currency = process.env.MOCK_CURRENCY ?? "COP";
  const assetScale = Number(process.env.MOCK_ASSET_SCALE ?? "0");
  const payments = new MockPaymentProvider(prisma, currency, assetScale);

  try {
    for (const fixture of FIXTURES) {
      const telefono = normalizeColombianPhone(fixture.telefono);
      const user = await prisma.user.upsert({
        where: { telefono },
        update: {},
        create: { telefono, alias: fixture.alias, phoneVerifiedAt: new Date() },
      });
      const existingWallet = await prisma.wallet.findFirst({ where: { userId: user.id, provider: "mock" } });
      const walletId =
        existingWallet?.id ??
        (await payments.provisionWallet({ userId: user.id, alias: user.alias })).walletId;
      await fundMockWallet(prisma, {
        walletId,
        amount: fixture.funding,
        currency,
        assetScale,
        idempotencyKey: `seed-${fixture.alias}-${fixture.funding}`,
      });
      console.log(`Cuenta ficticia lista: ${user.alias} ${telefono}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
