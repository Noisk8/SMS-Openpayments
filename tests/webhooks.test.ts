import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import twilio from "twilio";
import { receiveSmsWebhook } from "@/lib/sms/webhook";
import { TwilioSmsProvider } from "@/lib/sms/providers/twilio";
import { GenericSmsProvider } from "@/lib/sms/providers/generic";
import { OnurixSmsProvider } from "@/lib/sms/providers/onurix";
import { InalambriaSmsProvider } from "@/lib/sms/providers/inalambria";
import { getEnv, resetEnvCache } from "@/lib/config/env";
import type { SendSmsInput, SmsProvider } from "@/lib/sms/types";
import { makeContext, testPrisma, truncateAll, disconnectTestPrisma } from "./helpers/context";
import { CARLOS, ANDREA, balanceOf, seedCarlosAndAndrea } from "./helpers/fixtures";

const db = testPrisma();
const WEBHOOK_URL = "http://localhost:3000/api/webhooks/sms/twilio";

/** Proveedor Twilio que registra los envíos en lugar de llamar a la red. */
class RecordingTwilio extends TwilioSmsProvider {
  readonly sent: SendSmsInput[] = [];
  override async sendSms(input: SendSmsInput) {
    this.sent.push(input);
    return { success: true, messageId: `SM${this.sent.length}` };
  }
}

function twilioRequest(params: Record<string, string>, signature?: string): Request {
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (signature) {
    headers["x-twilio-signature"] = signature;
  }
  return new Request(WEBHOOK_URL, { method: "POST", headers, body });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe("TEST 12: webhook de Twilio", () => {
  it("rechaza una solicitud sin firma válida", async () => {
    const ctx = makeContext({ sms: new RecordingTwilio(getEnv()) });
    const response = await receiveSmsWebhook(
      "twilio",
      twilioRequest({ From: CARLOS, To: "+15005550006", Body: "SALDO", MessageSid: "SMforged" }),
      ctx,
    );
    expect(response.status).toBe(401);
    expect(await db.smsMessage.count()).toBe(0);
  });

  it("rechaza una firma calculada con otra URL o token", async () => {
    const ctx = makeContext({ sms: new RecordingTwilio(getEnv()) });
    const params = { From: CARLOS, To: "+15005550006", Body: "SALDO", MessageSid: "SMbad" };
    const wrong = twilio.getExpectedTwilioSignature("otro_token", WEBHOOK_URL, params);
    const response = await receiveSmsWebhook("twilio", twilioRequest(params, wrong), ctx);
    expect(response.status).toBe(401);
  });

  it("acepta una firma válida y procesa el SMS una sola vez por MessageSid", async () => {
    await seedCarlosAndAndrea(makeContext(), db);
    const provider = new RecordingTwilio(getEnv());
    const ctx = makeContext({ sms: provider });
    const params = { From: CARLOS, To: "+15005550006", Body: "ENVIAR 20000 3109876543", MessageSid: "SMok1" };
    const signature = twilio.getExpectedTwilioSignature(getEnv().TWILIO_AUTH_TOKEN!, WEBHOOK_URL, params);

    const first = await receiveSmsWebhook("twilio", twilioRequest(params, signature), ctx);
    const second = await receiveSmsWebhook("twilio", twilioRequest(params, signature), ctx);

    expect(first.status).toBe(200);
    expect((await first.json()).duplicate).toBe(false);
    expect((await second.json()).duplicate).toBe(true);
    expect(await balanceOf(db, CARLOS)).toBe(30000n);
    expect(await balanceOf(db, ANDREA)).toBe(30000n);
    expect(provider.sent.map((item) => item.to)).toEqual(expect.arrayContaining([CARLOS, ANDREA]));
  });

  it("no acepta webhooks de un proveedor que no es el activo", async () => {
    const ctx = makeContext({ sms: new RecordingTwilio(getEnv()) });
    const response = await receiveSmsWebhook("onurix", twilioRequest({ From: CARLOS, To: "x", Body: "SALDO", MessageSid: "x" }), ctx);
    expect(response.status).toBe(404);
  });
});

describe("proveedor genérico", () => {
  it("valida la firma HMAC del cuerpo crudo", async () => {
    const provider = new GenericSmsProvider(getEnv());
    const body = JSON.stringify({ id: "m1", from: CARLOS, to: "x", text: "SALDO" });
    const good = createHmac("sha256", getEnv().GENERIC_SMS_WEBHOOK_SECRET!).update(body).digest("hex");
    const requestWith = (signature: string) =>
      new Request("http://localhost/api/webhooks/sms/generic", { method: "POST", headers: { "x-signature": signature } });
    expect(await provider.validateWebhook(requestWith(good), body)).toBe(true);
    expect(await provider.validateWebhook(requestWith("00ff"), body)).toBe(false);
    expect(await provider.validateWebhook(new Request("http://localhost/x", { method: "POST" }), body)).toBe(false);
  });

  it("parsea el mensaje normalizado al formato común", async () => {
    const provider = new GenericSmsProvider(getEnv());
    const body = JSON.stringify({ id: "m2", from: "3001234567", to: "+5700", text: "SALDO" });
    const message = await provider.parseIncoming(new Request("http://localhost/x", { method: "POST" }), body);
    expect(message).toMatchObject({ id: "m2", from: CARLOS, body: "SALDO", provider: "generic" });
  });
});

describe("proveedores sin recepción verificada", () => {
  it("Onurix e Inalambria rechazan webhooks y declaran la recepción como pendiente", async () => {
    const onurix = new OnurixSmsProvider({ ...getEnv(), ONURIX_API_KEY: "k", ONURIX_CLIENT_ID: "1" });
    const inalambria = new InalambriaSmsProvider({ ...getEnv(), INALAMBRIA_USER: "u", INALAMBRIA_PASSWORD: "p" });
    const providers: SmsProvider[] = [onurix, inalambria];
    for (const provider of providers) {
      expect(provider.capabilities.receive).toBe(false);
      expect(await provider.validateWebhook(new Request("http://localhost/x"), "{}")).toBe(false);
      await expect(provider.parseIncoming(new Request("http://localhost/x"), "{}")).rejects.toThrow(/pendiente|no está disponible/);
    }
  });

  it("el webhook de Onurix devuelve 501 y no procesa nada", async () => {
    resetEnvCache();
    const ctx = makeContext({
      sms: new OnurixSmsProvider({ ...getEnv(), SMS_PROVIDER: "onurix", ONURIX_API_KEY: "k", ONURIX_CLIENT_ID: "1" }),
    });
    const response = await receiveSmsWebhook(
      "onurix",
      new Request("http://localhost/api/webhooks/sms/onurix", { method: "POST", body: "{}" }),
      ctx,
    );
    expect(response.status).toBe(501);
    expect(await db.smsMessage.count()).toBe(0);
  });
});
