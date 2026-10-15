import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleIncomingSms } from "@/lib/sms/command-handler";
import { getMockSmsProvider } from "@/lib/sms/provider-factory";
import { makeContext, testPrisma, truncateAll, disconnectTestPrisma } from "./helpers/context";
import { ANDREA, CARLOS, balanceOf, seedCarlosAndAndrea } from "./helpers/fixtures";
import { lastCodeFor } from "./helpers/accounts";

const db = testPrisma();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe("TEST 9 y 10: flujo SMS completo con el procesador compartido", () => {
  it("ENVIAR ejecuta la transferencia, notifica a ambos y mantiene saldos", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const mock = getMockSmsProvider();
    const start = mock.outboxLength();
    const message = mock.buildIncoming(CARLOS, "ENVIAR 20000 3109876543");
    const result = await handleIncomingSms(message, ctx);

    expect(result.command).toBe("ENVIAR");
    expect(await balanceOf(db, CARLOS)).toBe(30000n);
    expect(await balanceOf(db, ANDREA)).toBe(30000n);
    const sent = mock.takeOutboxSince(start);
    expect(sent.map((item) => item.to)).toEqual(expect.arrayContaining([CARLOS, ANDREA]));
    expect(sent.find((item) => item.to === CARLOS)?.body).toMatch(/Transferencia exitosa/);
  });

  it("SALDO responde con el saldo del remitente", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const mock = getMockSmsProvider();
    const start = mock.outboxLength();
    await handleIncomingSms(mock.buildIncoming(CARLOS, "SALDO"), ctx);
    const reply = mock.takeOutboxSince(start).at(-1);
    expect(reply?.body).toContain("Saldo: 50000 COP");
  });

  it("CREAR y CONFIRMAR crean la cuenta desde SMS", async () => {
    const ctx = makeContext();
    const mock = getMockSmsProvider();
    await handleIncomingSms(mock.buildIncoming("+573015551234", "CREAR laura"), ctx);
    const code = lastCodeFor("+573015551234");
    const result = await handleIncomingSms(mock.buildIncoming("+573015551234", `CONFIRMAR ${code}`), ctx);
    expect(result.command).toBe("CONFIRMAR");
    expect(await db.user.findUnique({ where: { telefono: "+573015551234" } })).not.toBeNull();
  });

  it("un usuario sin cuenta recibe instrucciones y no ejecuta pagos", async () => {
    const ctx = makeContext();
    const mock = getMockSmsProvider();
    const start = mock.outboxLength();
    await handleIncomingSms(mock.buildIncoming("+573016661234", "ENVIAR 1000 3109876543"), ctx);
    expect(mock.takeOutboxSince(start).at(-1)?.body).toContain("CREAR");
    expect(await db.transaction.count({ where: { senderId: { not: null } } })).toBe(0);
  });
});

describe("TEST 8: SMS duplicado con el mismo identificador", () => {
  it("solo ejecuta una transferencia aunque el mensaje llegue dos veces", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const mock = getMockSmsProvider();
    const message = mock.buildIncoming(CARLOS, "ENVIAR 20000 3109876543");
    const first = await handleIncomingSms(message, ctx);
    const second = await handleIncomingSms(message, ctx);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(await balanceOf(db, CARLOS)).toBe(30000n);
    expect(await db.transaction.count({ where: { senderId: { not: null } } })).toBe(1);
  });
});

describe("TEST 11: cambiar el proveedor SMS no cambia la lógica de pagos", () => {
  it("el mismo SMS produce el mismo resultado con otro proveedor de envío", async () => {
    const ctx = makeContext();
    await seedCarlosAndAndrea(ctx, db);
    const sentByOther: string[] = [];
    const otherProvider = {
      name: "twilio",
      capabilities: { send: true, receive: true },
      async sendSms(input: { to: string; body: string }) {
        sentByOther.push(input.to);
        return { success: true, messageId: `SM-${sentByOther.length}` };
      },
      async parseIncoming() {
        throw new Error("no usado");
      },
      async validateWebhook() {
        return false;
      },
    };
    const mock = getMockSmsProvider();
    const result = await handleIncomingSms(
      mock.buildIncoming(CARLOS, "ENVIAR 20000 3109876543"),
      { ...ctx, sms: otherProvider },
    );
    expect(result.command).toBe("ENVIAR");
    expect(sentByOther).toEqual(expect.arrayContaining([CARLOS, ANDREA]));
    expect(await balanceOf(db, CARLOS)).toBe(30000n);
    expect(await balanceOf(db, ANDREA)).toBe(30000n);
  });
});
