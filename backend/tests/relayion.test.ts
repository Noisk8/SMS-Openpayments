import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import type { Db } from "../src/db";
import { AppError } from "../src/errors";
import { createSmsProvider } from "../src/sms/provider-factory";
import { RelayionSmsProvider, type RelayionFetch } from "../src/sms/providers/relayion";
import { testConfig, testDatabaseUrl, testDb, testPaymentProvider } from "./helpers";

const API_KEY = "rlyn_test_key";
const WEBHOOK_SECRET = "whsec_test_secret";

function relayionConfig(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return testConfig({
    SMS_PROVIDER: "relayion",
    RELAYION_API_KEY: API_KEY,
    RELAYION_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...overrides,
  });
}

function sign(raw: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

interface FetchCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

interface FakeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

function jsonResponse(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

/** Fake fetch that records calls and delegates responses to `handler`. */
function fakeFetch(handler: (call: FetchCall) => FakeResponse | Promise<FakeResponse>) {
  const calls: FetchCall[] = [];
  const fetchImpl: RelayionFetch = async (url, init) => {
    const call: FetchCall = init ? { url, init } : { url };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

describe("Relayion SMS provider", () => {
  describe("validateWebhook", () => {
    it("accepts a correctly signed inbound.received event", () => {
      const raw = JSON.stringify({
        event: "inbound.received",
        timestamp: "2026-01-01T00:00:00.000Z",
        data: { id: "in-1", senderNumber: "+639000000000", simPhoneNumber: "+639111111111" },
      });
      const provider = new RelayionSmsProvider(relayionConfig());
      expect(
        provider.validateWebhook({
          headers: { "x-relayion-signature": sign(raw) },
          body: JSON.parse(raw),
          rawBody: raw,
        }),
      ).toBe(true);
    });

    it("rejects a wrong signature", () => {
      const raw = JSON.stringify({ event: "inbound.received", data: { id: "in-1" } });
      const provider = new RelayionSmsProvider(relayionConfig());
      expect(
        provider.validateWebhook({
          headers: { "x-relayion-signature": sign(raw, "other-secret") },
          body: JSON.parse(raw),
          rawBody: raw,
        }),
      ).toBe(false);
      expect(
        provider.validateWebhook({ headers: { "x-relayion-signature": "deadbeef" }, body: JSON.parse(raw), rawBody: raw }),
      ).toBe(false);
    });

    it("rejects when the raw body is missing or the signature header is absent", () => {
      const provider = new RelayionSmsProvider(relayionConfig());
      const body = { event: "inbound.received", data: { id: "in-1" } };
      expect(provider.validateWebhook({ headers: { "x-relayion-signature": sign("{}") }, body })).toBe(false);
      expect(provider.validateWebhook({ headers: {}, body, rawBody: JSON.stringify(body) })).toBe(false);
    });

    it("rejects a non inbound event even with a valid signature", () => {
      const raw = JSON.stringify({ event: "outbound.delivered", data: { id: "out-1" } });
      const provider = new RelayionSmsProvider(relayionConfig());
      expect(
        provider.validateWebhook({ headers: { "x-relayion-signature": sign(raw) }, body: JSON.parse(raw), rawBody: raw }),
      ).toBe(false);
    });
  });

  describe("parseIncoming", () => {
    it("maps a payload that already includes the body", async () => {
      const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ success: true, data: {} }));
      const provider = new RelayionSmsProvider(relayionConfig(), { fetch: fetchImpl });
      const inbound = await provider.parseIncoming({
        headers: {},
        rawBody: "",
        body: {
          event: "inbound.received",
          timestamp: "2026-01-01T00:00:00.000Z",
          data: {
            id: "in-1",
            senderNumber: "+639000000000",
            simPhoneNumber: "+639111111111",
            receivedAt: "2026-01-01T00:00:05.000Z",
            body: "AYUDA",
          },
        },
      });

      expect(inbound).toEqual({
        provider: "relayion",
        messageId: "in-1",
        from: "+639000000000",
        to: "+639111111111",
        text: "AYUDA",
        receivedAt: "2026-01-01T00:00:05.000Z",
      });
      expect(calls).toHaveLength(0);
    });

    it("fetches the body from the API when the webhook omits it", async () => {
      const { fetchImpl, calls } = fakeFetch(() =>
        jsonResponse({ success: true, data: { id: "in-2", body: "PAGAR 10" } }),
      );
      const provider = new RelayionSmsProvider(relayionConfig(), { fetch: fetchImpl });
      const inbound = await provider.parseIncoming({
        headers: {},
        rawBody: "",
        body: {
          event: "inbound.received",
          timestamp: "2026-01-02T00:00:00.000Z",
          data: { id: "in-2", senderNumber: "+639000000001", simPhoneNumber: "+639111111112" },
        },
      });

      expect(inbound.text).toBe("PAGAR 10");
      expect(inbound.receivedAt).toBe("2026-01-02T00:00:00.000Z");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://api.relayion.com/api/v1/inbound/in-2");
      expect(calls[0]?.init?.headers?.authorization).toBe(`Bearer ${API_KEY}`);
    });

    it("throws VALIDATION_FAILED on a malformed payload", async () => {
      const provider = new RelayionSmsProvider(relayionConfig());
      await expect(provider.parseIncoming({ headers: {}, body: { event: "inbound.received", data: {} } })).rejects.toThrow(
        AppError,
      );
      await expect(
        provider.parseIncoming({ headers: {}, body: { event: "inbound.received", data: {} } }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });
  });

  describe("sendMessage", () => {
    it("posts the outbound payload and maps DISPATCHED to queued", async () => {
      const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ success: true, data: { id: "out-1", status: "DISPATCHED" } }));
      const provider = new RelayionSmsProvider(relayionConfig({ RELAYION_DEVICE_ID: "device-9" }), { fetch: fetchImpl });

      const result = await provider.sendMessage({ to: "+639000000000", from: "+639111111111", text: "Hola" });

      expect(result).toEqual({ status: "queued", providerMessageId: "out-1" });
      expect(calls[0]?.url).toBe("https://api.relayion.com/api/v1/outbound");
      expect(calls[0]?.init?.method).toBe("POST");
      expect(calls[0]?.init?.headers?.authorization).toBe(`Bearer ${API_KEY}`);
      expect(JSON.parse(calls[0]?.init?.body ?? "{}")).toEqual({
        recipientNumber: "+639000000000",
        body: "Hola",
        deviceId: "device-9",
      });
    });

    it("omits deviceId when it is not configured", async () => {
      const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ success: true, data: { id: "out-2", status: "QUEUED" } }));
      const provider = new RelayionSmsProvider(relayionConfig(), { fetch: fetchImpl });
      await provider.sendMessage({ to: "+639000000000", from: "+639111111111", text: "Hola" });
      expect(JSON.parse(calls[0]?.init?.body ?? "{}")).toEqual({
        recipientNumber: "+639000000000",
        body: "Hola",
      });
    });

    it("reports failed on an HTTP error without throwing", async () => {
      const { fetchImpl } = fakeFetch(() =>
        jsonResponse({ success: false, error: { message: "No eligible device", code: "NO_ELIGIBLE_DEVICE" } }, 422),
      );
      const provider = new RelayionSmsProvider(relayionConfig(), { fetch: fetchImpl });
      const result = await provider.sendMessage({ to: "+639000000000", from: "+639111111111", text: "Hola" });
      expect(result.status).toBe("failed");
      expect(result.error).toContain("No eligible device");
      expect(result.error).toContain("NO_ELIGIBLE_DEVICE");
    });

    it("reports failed on a network error without throwing", async () => {
      const { fetchImpl } = fakeFetch(() => {
        throw new Error("socket hang up");
      });
      const provider = new RelayionSmsProvider(relayionConfig(), { fetch: fetchImpl });
      const result = await provider.sendMessage({ to: "+639000000000", from: "+639111111111", text: "Hola" });
      expect(result).toEqual({ status: "failed", error: "socket hang up" });
    });
  });

  it("acknowledges with a JSON ack", () => {
    const provider = new RelayionSmsProvider(relayionConfig());
    expect(provider.acknowledge()).toEqual({ success: true });
  });

  it("is selected by the factory", () => {
    expect(createSmsProvider(relayionConfig()).name).toBe("relayion");
  });
});

describe("Relayion webhook route", () => {
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

  it("accepts a raw-body-signed webhook and persists the message", async () => {
    const config = relayionConfig();
    const { fetchImpl } = fakeFetch(() => jsonResponse({ success: true, data: {} }));
    app = buildApp({
      config,
      db,
      provider: new RelayionSmsProvider(config, { fetch: fetchImpl }),
      paymentProvider: testPaymentProvider(),
      secretBox: null,
    });

    const raw = JSON.stringify({
      event: "inbound.received",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        id: "in-e2e",
        senderNumber: "+639000000000",
        simPhoneNumber: "+639111111111",
        body: "AYUDA",
      },
    });

    const ok = await app.inject({
      method: "POST",
      url: "/webhooks/sms",
      headers: { "content-type": "application/json", "x-relayion-signature": sign(raw) },
      payload: raw,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ success: true });
    const stored = await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM sms_messages");
    expect(stored?.n).toBe(1);

    const rejected = await app.inject({
      method: "POST",
      url: "/webhooks/sms",
      headers: { "content-type": "application/json", "x-relayion-signature": sign(raw, "wrong-secret") },
      payload: raw,
    });
    expect(rejected.statusCode).toBe(401);
  });
});

describe("Relayion configuration", () => {
  it("requires the API key and webhook secret", () => {
    expect(() =>
      loadConfig({ DATABASE_URL: testDatabaseUrl(), SMS_PROVIDER: "relayion" } as NodeJS.ProcessEnv),
    ).toThrow(/RELAYION_/);

    const config = loadConfig({
      DATABASE_URL: testDatabaseUrl(),
      SMS_PROVIDER: "relayion",
      RELAYION_API_KEY: API_KEY,
      RELAYION_WEBHOOK_SECRET: WEBHOOK_SECRET,
    } as NodeJS.ProcessEnv);
    expect(config.RELAYION_API_KEY).toBe(API_KEY);
    expect(config.RELAYION_WEBHOOK_SECRET).toBe(WEBHOOK_SECRET);
    expect(config.RELAYION_DEVICE_ID).toBe("");
  });
});
