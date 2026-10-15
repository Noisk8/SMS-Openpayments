import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enviarDinero } from "@/lib/transfers/send-money";
import { verSaldo } from "@/lib/balances/get-balance";
import { AppError } from "@/lib/errors";
import { makeContext, testPrisma, truncateAll, disconnectTestPrisma } from "./helpers/context";
import { ANDREA, CARLOS, balanceOf, seedCarlosAndAndrea } from "./helpers/fixtures";

const db = testPrisma();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

async function carlosAuth() {
  const user = await db.user.findUniqueOrThrow({ where: { telefono: CARLOS } });
  return { userId: user.id, channel: "web" as const };
}

function send(ctx: ReturnType<typeof makeContext>, monto: string, idempotencyKey: string, origen = CARLOS) {
  return carlosAuth().then((authorizationContext) =>
    enviarDinero({ origen, destino: ANDREA, monto, idempotencyKey, authorizationContext }, ctx),
  );
}

describe("TEST 5 y 6: transferencia de 20000 COP entre cuentas mock", () => {
  it("descuenta al origen, acredita al destino y deja saldos 30000 y 30000", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const result = await send(ctx, "20000", "sms-message-123");
    expect(result.success).toBe(true);
    expect(result.transaction.estado).toBe("COMPLETED");
    expect(await balanceOf(db, CARLOS)).toBe(30000n);
    expect(await balanceOf(db, ANDREA)).toBe(30000n);
  });

  it("registra un débito y un crédito que suman cero por transacción", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const result = await send(ctx, "5000", "check-ledger-1");
    const entries = await db.ledgerEntry.findMany({ where: { transactionId: result.transaction.id } });
    const signed = entries.reduce((sum, entry) => sum + (entry.direction === "CREDIT" ? entry.amount : -entry.amount), 0n);
    expect(entries).toHaveLength(2);
    expect(signed).toBe(0n);
  });
});

describe("TEST 7: fondos insuficientes", () => {
  it("rechaza el envío sin modificar los saldos", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const result = await send(ctx, "999999", "too-much-1");
    expect(result.success).toBe(false);
    expect(result.transaction.estado).toBe("FAILED");
    expect(await balanceOf(db, CARLOS)).toBe(50000n);
    expect(await balanceOf(db, ANDREA)).toBe(10000n);
  });
});

describe("TEST 8: operación duplicada", () => {
  it("con la misma clave de idempotencia solo se ejecuta una transferencia", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const first = await send(ctx, "20000", "dup-key-1");
    const second = await send(ctx, "20000", "dup-key-1");
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(await balanceOf(db, CARLOS)).toBe(30000n);
    expect(await db.transaction.count({ where: { idempotencyKey: "dup-key-1" } })).toBe(1);
  });

  it("reutilizar una clave con otro importe se rechaza", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    await send(ctx, "20000", "dup-key-2");
    await expect(send(ctx, "1000", "dup-key-2")).rejects.toMatchObject({ code: "DUPLICATE_OPERATION" });
  });
});

describe("TEST 13: transferencias concurrentes desde la misma cuenta", () => {
  it("nunca deja saldo negativo ni gasta dos veces los mismos fondos", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const attempts = Array.from({ length: 10 }, (_, index) => send(ctx, "10000", `race-${index}`));
    const results = await Promise.all(attempts);
    const completed = results.filter((item) => item.transaction.estado === "COMPLETED").length;
    const failed = results.filter((item) => item.transaction.estado === "FAILED").length;
    expect(completed).toBe(5);
    expect(failed).toBe(5);
    expect(await balanceOf(db, CARLOS)).toBe(0n);
    expect(await balanceOf(db, ANDREA)).toBe(60000n);
  });
});

describe("autorización de operaciones", () => {
  it("no permite enviar desde el número de otro usuario", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const andrea = await db.user.findUniqueOrThrow({ where: { telefono: ANDREA } });
    await expect(
      enviarDinero(
        {
          origen: CARLOS,
          destino: ANDREA,
          monto: "1000",
          idempotencyKey: "impersonation-1",
          authorizationContext: { userId: andrea.id, channel: "web" },
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(await balanceOf(db, CARLOS)).toBe(50000n);
  });

  it("no permite consultar el saldo de otra persona con su número", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const andrea = await db.user.findUniqueOrThrow({ where: { telefono: ANDREA } });
    await expect(
      verSaldo({ telefono: CARLOS, authorizationContext: { userId: andrea.id, channel: "sms" } }, ctx),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rechaza enviarse dinero a uno mismo", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    await expect(
      enviarDinero(
        {
          origen: CARLOS,
          destino: CARLOS,
          monto: "1000",
          idempotencyKey: "self-1",
          authorizationContext: await carlosAuth(),
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "SAME_ACCOUNT" });
  });
});
