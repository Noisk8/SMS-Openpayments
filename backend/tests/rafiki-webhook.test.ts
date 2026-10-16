import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import type { ManagedGateway, ManagedRemotePayment } from "../src/managed/rafiki";
import { fundTestAccount, handleManagedCommand, type ManagedDeps } from "../src/managed/service";
import {
  RAFIKI_SIGNATURE_TOLERANCE_MS,
  signRafikiEvent,
  verifyRafikiSignature,
  type RafikiEvent,
} from "../src/managed/webhook";
import { generateEncryptionKey } from "../src/security/encryption";
import { MockSmsProvider } from "../src/sms/providers/mock";
import { testConfig, testDb } from "./helpers";

const SECRET = "whsec-test-secret";
const NOW = 1_800_000_000_000;
const completed: RafikiEvent = { id: "evt-1", type: "outgoing_payment.completed", data: { id: "outgoing-1", state: "COMPLETED" } };

describe("Rafiki webhook signature", () => {
  it("accepts a fresh event signed with the same secret", async () => {
    const header = signRafikiEvent(completed, SECRET, NOW);
    expect((await verifyRafikiSignature(completed, header, SECRET, NOW))).toBe(true);
  });

  it("rejects a wrong secret, a tampered payload and a stale timestamp", async () => {
    const header = signRafikiEvent(completed, SECRET, NOW);
    expect((await verifyRafikiSignature(completed, header, "other-secret", NOW))).toBe(false);
    expect((await verifyRafikiSignature({ ...completed, data: { id: "outgoing-2" } }, header, SECRET, NOW))).toBe(false);
    const old = signRafikiEvent(completed, SECRET, NOW - RAFIKI_SIGNATURE_TOLERANCE_MS - 1_000);
    expect((await verifyRafikiSignature(completed, old, SECRET, NOW))).toBe(false);
  });

  it("fails closed without a secret or with a malformed header", async () => {
    const header = signRafikiEvent(completed, SECRET, NOW);
    expect((await verifyRafikiSignature(completed, header, "", NOW))).toBe(false);
    expect((await verifyRafikiSignature(completed, undefined, SECRET, NOW))).toBe(false);
    expect((await verifyRafikiSignature(completed, "t=1, v2=" + "a".repeat(64), SECRET, NOW))).toBe(false);
    expect((await verifyRafikiSignature(completed, "garbage", SECRET, NOW))).toBe(false);
  });
});

describe("POST /webhooks/rafiki", () => {
  const alice = "+573001234567";
  const bob = "+573001234568";
  let db: Awaited<ReturnType<typeof testDb>>;
  let app: ReturnType<typeof buildApp>;
  let deps: ManagedDeps;
  let remoteSent = "0";
  let gateway: ManagedGateway;

  beforeEach(async () => {
    const config = testConfig({ ENCRYPTION_KEY: generateEncryptionKey(), RAFIKI_WEBHOOK_SECRET: SECRET });
    db = (await testDb());
    const amount = { value: "5000", assetCode: "COP" as const, assetScale: 0 as const };
    remoteSent = "0";
    gateway = {
      createWallet: vi.fn(async id => ({ id: `wallet-${id}`, address: `http://rafiki.test/accounts/${id}` })),
      prepare: vi.fn(async () => ({ quoteId: "quote-1", incomingId: "incoming-1", expiresAt: new Date(Date.now() + 300_000).toISOString() })),
      createOutgoing: vi.fn(async () => "outgoing-1"),
      fund: vi.fn(async () => {}),
      getOutgoing: vi.fn(async () => ({
        id: "outgoing-1",
        state: remoteSent === "0" ? "SENDING" : "COMPLETED",
        debitAmount: amount,
        receiveAmount: amount,
        sentAmount: { ...amount, value: remoteSent },
      } as ManagedRemotePayment)),
      withdrawIncoming: vi.fn(async () => {}),
    };
    deps = { config, db, gateway };
    app = buildApp({
      config,
      db,
      provider: new MockSmsProvider(config.SMS_WEBHOOK_SECRET),
      managedGateway: gateway,
      secretBox: null,
      runWorker: false,
    });
  });

  afterEach(async () => {
    await app.close();
    (await db.close());
  });

  async function signup(phone: string) {
    const reply = await handleManagedCommand(deps, { provider: "mock", messageId: `signup-${phone}`, from: phone, to: "+15551234567", text: "CREAR CUENTA", receivedAt: new Date().toISOString() });
    const code = /VERIFICAR (\d{6})/.exec(reply)![1];
    await handleManagedCommand(deps, { provider: "mock", messageId: `verify-${phone}`, from: phone, to: "+15551234567", text: `VERIFICAR ${code}`, receivedAt: new Date().toISOString() });
  }

  /** Creates a transfer that reached PROCESSING with outgoing-1 linked. */
  async function processingTransfer(): Promise<string> {
    await signup(alice);
    await signup(bob);
    (await fundTestAccount(deps, alice, 10000, "initial"));
    const send = async (text: string, id: string) => (await handleManagedCommand(deps, { provider: "mock", messageId: id, from: alice, to: "+15551234567", text, receivedAt: new Date().toISOString() }));
    const proposal = await send(`PAGAR 5000 COP A ${bob}`, "pay-1");
    const confirm = /CONFIRMAR ([a-f0-9-]+) ([A-Z0-9]+)/.exec(proposal)!;
    await send(confirm[0], "pay-2");
    expect(gateway.createOutgoing).toHaveBeenCalledTimes(1);
    // Confirmation itself polls Rafiki; reset so each test asserts only its own webhook behavior.
    vi.mocked(gateway.getOutgoing).mockClear();
    return confirm[1]!;
  }

  function post(body: RafikiEvent, signature?: string) {
    return app.inject({
      method: "POST",
      url: "/webhooks/rafiki",
      headers: { "content-type": "application/json", ...(signature ? { "rafiki-signature": signature } : {}) },
      payload: JSON.stringify(body),
    });
  }

  it("rejects unsigned events without touching the transfer", async () => {
    const transferId = await processingTransfer();
    remoteSent = "5000";
    const response = await post(completed);
    expect(response.statusCode).toBe(401);
    expect(gateway.getOutgoing).not.toHaveBeenCalled();
    expect(((await db.get("SELECT state FROM managed_transfers WHERE id = ?", [transferId])) as { state: string }).state).toBe("PROCESSING");
  });

  it("reconciles the linked transfer through the Admin API when the signature is valid", async () => {
    const transferId = await processingTransfer();
    remoteSent = "5000";
    const response = await post(completed, signRafikiEvent(completed, SECRET));
    expect(response.statusCode).toBe(200);
    expect(gateway.getOutgoing).toHaveBeenCalledWith("outgoing-1");
    expect(((await db.get("SELECT state FROM managed_transfers WHERE id = ?", [transferId])) as { state: string }).state).toBe("COMPLETED");
  });

  it("acknowledges valid events for unknown payments without side effects", async () => {
    await processingTransfer();
    const unknown: RafikiEvent = { id: "evt-2", type: "outgoing_payment.completed", data: { id: "outgoing-999" } };
    const response = await post(unknown, signRafikiEvent(unknown, SECRET));
    expect(response.statusCode).toBe(200);
    expect(gateway.getOutgoing).not.toHaveBeenCalled();
  });
});
