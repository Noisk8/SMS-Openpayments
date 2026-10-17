import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import type { Db } from "../src/db";
import { MockSmsProvider } from "../src/sms/providers/mock";
import { testConfig, testDb, testPaymentProvider } from "./helpers";

const inboundPayload = {
  messageId: "msg-1",
  from: "+573001234567",
  to: "+570000000000",
  text: "AYUDA",
};

describe("webhook SMS", () => {
  let db: Db;
  let provider: MockSmsProvider;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    const config = testConfig();
    db = await testDb();
    provider = new MockSmsProvider(config.SMS_WEBHOOK_SECRET);
    app = buildApp({ config, db, provider, paymentProvider: testPaymentProvider(), secretBox: null });
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it("persiste un SMS real y responde 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/sms",
      headers: { "x-webhook-secret": "test-secret" },
      payload: inboundPayload,
    });
    expect(res.statusCode).toBe(200);
    const count = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sms_messages");
    expect(count?.n).toBe(1);
  });

  it("reconoce un duplicado sin repetir efectos de negocio", async () => {
    const send = () =>
      app.inject({
        method: "POST",
        url: "/webhooks/sms",
        headers: { "x-webhook-secret": "test-secret" },
        payload: inboundPayload,
      });

    const first = await send();
    const second = await send();
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const messages = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sms_messages");
    const jobs = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs");
    expect(messages?.n).toBe(1);
    expect(jobs?.n).toBe(1);
  });

  it("rechaza una firma inválida con 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/sms",
      headers: { "x-webhook-secret": "incorrecto" },
      payload: inboundPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("el simulador dev responde a AYUDA con la ayuda corta", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dev/sms/simulate",
      payload: { from: "+573001234567", text: "AYUDA" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, duplicate: false });
    expect(String(res.json().reply)).toContain("P <monto> <destino>");
    expect(String(res.json().reply)).toContain("9 ayuda");
  });
});
