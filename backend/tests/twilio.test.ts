import twilio from "twilio";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import type { Db } from "../src/db";
import { createSmsProvider } from "../src/sms/provider-factory";
import { TwilioSmsProvider } from "../src/sms/providers/twilio";
import { testConfig, testDatabaseUrl, testDb, testPaymentProvider } from "./helpers";

const TWILIO_URL = "https://sms.example/webhooks/sms";

describe("Twilio SMS provider", () => {
  let db: Db;
  let app: ReturnType<typeof buildApp> | undefined;

  beforeEach(async () => {
    db = await testDb();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    await db.close();
  });

  it("validates signed forms, deduplicates by MessageSid and rejects altered content", async () => {
    const config = testConfig({
      SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "ACtest",
      TWILIO_AUTH_TOKEN: "test-token",
      TWILIO_WEBHOOK_URL: TWILIO_URL,
    });
    const server = buildApp({
      config,
      db,
      provider: new TwilioSmsProvider(config),
      paymentProvider: testPaymentProvider(),
      secretBox: null,
    });
    app = server;

    const body = {
      AccountSid: "ACtest",
      MessageSid: "SMtest",
      From: "+573001234567",
      To: "+15551234567",
      Body: "AYUDA",
      ExtraField: "signed-too",
    };
    const signature = twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN, TWILIO_URL, body);
    const send = (fields: Record<string, string> = body, sig = signature) =>
      server.inject({
        method: "POST",
        url: "/webhooks/sms",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig },
        payload: new URLSearchParams(fields).toString(),
      });

    const first = await send();
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("text/xml");
    expect(first.body).toContain("<Response");

    // Same MessageSid again: acknowledged, not stored twice.
    expect((await send()).statusCode).toBe(200);
    const stored = await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM sms_messages");
    expect(stored?.n).toBe(1);

    // Altered body with the old signature.
    expect((await send({ ...body, Body: "PAGAR 999" })).statusCode).toBe(401);
    // Garbage signature.
    expect((await send(body, "invalid")).statusCode).toBe(401);
    // Missing MessageSid is signed correctly but invalid.
    const incomplete = { ...body, MessageSid: "" };
    const incompleteSignature = twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN, TWILIO_URL, incomplete);
    expect((await send(incomplete, incompleteSignature)).statusCode).toBe(400);
  });

  it("is selected by the factory and requires its credentials", () => {
    const config = testConfig({
      SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "ACtest",
      TWILIO_AUTH_TOKEN: "test-token",
      TWILIO_WEBHOOK_URL: TWILIO_URL,
    });
    expect(createSmsProvider(config).name).toBe("twilio");
    expect(() => loadConfig({ DATABASE_URL: testDatabaseUrl(), SMS_PROVIDER: "twilio" })).toThrow(/TWILIO_ACCOUNT_SID/);
  });
});
