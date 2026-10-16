import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedGateway, ManagedRemotePayment } from "../src/managed/rafiki";
import { handleManagedCommand, fundTestAccount, reconcileManagedPayments, type ManagedDeps } from "../src/managed/service";
import { testConfig, testDb } from "./helpers";
import { generateEncryptionKey } from "../src/security/encryption";
import { buildApp } from "../src/app";
import { MockSmsProvider } from "../src/sms/providers/mock";
import { processNextSmsJob } from "../src/managed/worker";

async function fixture() {
  const config = testConfig({ ENCRYPTION_KEY: generateEncryptionKey() });
  const db = (await testDb());
  let sent = "0";
  const amount = { value: "5000", assetCode: "COP" as const, assetScale: 0 as const };
  const gateway: ManagedGateway = {
    createWallet: vi.fn(async id => ({ id: `wallet-${id}`, address: `http://rafiki.test/accounts/${id}` })),
    prepare: vi.fn(async () => ({ quoteId: "quote-1", incomingId: "incoming-1", expiresAt: new Date(Date.now() + 300_000).toISOString() })),
    createOutgoing: vi.fn(async () => "outgoing-1"),
    fund: vi.fn(async () => {}),
    getOutgoing: vi.fn(async () => ({ id: "outgoing-1", state: sent === "0" ? "SENDING" : "COMPLETED", debitAmount: amount, receiveAmount: amount, sentAmount: { ...amount, value: sent } } as ManagedRemotePayment)),
    withdrawIncoming: vi.fn(async () => {}),
  };
  let sequence = 0;
  const deps = { config, db, gateway };
  const command = async (from: string, text: string, messageId = `sms-${++sequence}`) => (await handleManagedCommand(deps, { provider: "mock", messageId, from, to: "+15551234567", text, receivedAt: new Date().toISOString() }));
  return { config, db, gateway, deps, command, complete: () => { sent = "5000"; } };
}

describe("cuentas COP administradas por SMS", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  const alice = "+573001234567", bob = "+573001234568";
  beforeEach(async () => { f = (await fixture()); });
  afterEach(async () => (await f.db.close()));
  async function signup(phone: string) {
    const reply = await f.command(phone, "CREAR CUENTA");
    const code = /VERIFICAR (\d{6})/.exec(reply)![1];
    expect(await f.command(phone, `VERIFICAR ${code}`)).toContain("lista");
  }
  async function assertBalanced() {
    const unbalanced = (await f.db.all("SELECT journal_id FROM managed_entries GROUP BY journal_id HAVING SUM(amount) != 0"));
    expect(unbalanced).toEqual([]);
    const accounts = (await f.db.all("SELECT user_id, balance FROM managed_accounts")) as Array<{ user_id: string; balance: number }>;
    for (const account of accounts) {
      const sum = (await f.db.get("SELECT COALESCE(SUM(amount), 0)::bigint AS value FROM managed_entries WHERE account = ?", [`user:${account.user_id}`])) as { value: number };
      expect(sum.value).toBe(account.balance);
    }
  }

  it("crea cuentas por OTP, envía COP mediante Rafiki y refleja saldo confirmado", async () => {
    await signup(alice); await signup(bob);
    expect(await f.command(alice, "SALDO")).toContain("0 COP");
    (await fundTestAccount(f.deps, alice, 10000, "initial"));
    (await fundTestAccount(f.deps, alice, 10000, "initial"));
    await expect(fundTestAccount(f.deps, alice, 11000, "initial")).rejects.toThrow();
    const proposal = await f.command(alice, `PAGAR 5000 COP A ${bob}`, "request-1");
    const confirm = /CONFIRMAR ([a-f0-9-]+) ([A-Z0-9]+)/.exec(proposal)!;
    expect(confirm).toBeTruthy();
    expect(f.gateway.createOutgoing).not.toHaveBeenCalled();
    const states = await Promise.all([f.command(alice, confirm[0]), f.command(alice, confirm[0])]);
    expect(states.every(state => state.includes("PROCESSING"))).toBe(true);
    expect(f.gateway.createOutgoing).toHaveBeenCalledTimes(1);
    expect(await f.command(alice, "SALDO")).toContain("disponible: 5000 COP");
    expect(await f.command(alice, "SALDO")).toContain("Reservado: 5000 COP");
    expect(await f.command(bob, "SALDO")).toContain("disponible: 0 COP");
    f.complete();
    await reconcileManagedPayments(f.deps);
    await reconcileManagedPayments(f.deps);
    expect(await f.command(bob, "SALDO")).toContain("disponible: 5000 COP");
    expect(await f.command(alice, "SALDO")).toContain("Reservado: 0 COP");
    expect(await f.command(alice, confirm[0])).toContain("COMPLETED");
    expect(f.gateway.withdrawIncoming).toHaveBeenCalledTimes(1);
    (await assertBalanced());
  });

  it("abonos y conciliaciones concurrentes mantienen un único crédito", async () => {
    await signup(alice); await signup(bob);
    await Promise.all([fundTestAccount(f.deps, alice, 10000, "concurrent"), fundTestAccount(f.deps, alice, 10000, "concurrent")]);
    expect(await f.command(alice, "SALDO")).toContain("10000 COP");
    const match = /CONFIRMAR ([a-f0-9-]+) ([A-Z0-9]+)/.exec(await f.command(alice, `PAGAR 5000 A ${bob}`))!;
    await Promise.all([f.command(alice, match[0]), f.command(alice, match[0])]);
    expect(f.gateway.createOutgoing).toHaveBeenCalledTimes(1);
    f.complete();
    await Promise.all([reconcileManagedPayments(f.deps), reconcileManagedPayments(f.deps)]);
    expect(await f.command(bob, "SALDO")).toContain("disponible: 5000 COP");
    await assertBalanced();
  });

  it("bloquea operaciones sin verificación, saldo insuficiente y destinatarios ajenos", async () => {
    await expect(f.command(alice, "SALDO")).rejects.toThrow();
    await f.command(alice, "CREAR CUENTA");
    await expect(f.command(alice, "VERIFICAR 999999")).rejects.toThrow();
    expect(f.gateway.createWallet).not.toHaveBeenCalled();
    await signup(alice); await signup(bob);
    await expect(f.command(alice, `PAGAR 5000 A ${bob}`)).rejects.toThrow("Saldo insuficiente");
    (await fundTestAccount(f.deps, alice, 10000, "initial"));
    const confirm = /CONFIRMAR ([a-f0-9-]+) ([A-Z0-9]+)/.exec(await f.command(alice, `PAGAR 5000 A ${bob}`))!;
    await expect(f.command(bob, confirm[0])).rejects.toThrow("Pago no encontrado");
    expect(await f.command(alice, `CANCELAR ${confirm[1]}`)).toContain("CANCELLED");
    expect(await f.command(alice, confirm[0])).toContain("CANCELLED");
    expect(f.gateway.createOutgoing).not.toHaveBeenCalled();
    (await assertBalanced());
  });

  it("retiene fondos ante resultado incierto y no repite el débito", async () => {
    await signup(alice); await signup(bob);
    (await fundTestAccount(f.deps, alice, 10000, "initial"));
    const confirm = /CONFIRMAR ([a-f0-9-]+) ([A-Z0-9]+)/.exec(await f.command(alice, `PAGAR 5000 A ${bob}`))!;
    vi.mocked(f.gateway.createOutgoing).mockRejectedValueOnce(new Error("timeout"));
    expect(await f.command(alice, confirm[0])).toContain("NEEDS_REVIEW");
    expect(await f.command(alice, confirm[0])).toContain("NEEDS_REVIEW");
    expect(f.gateway.createOutgoing).toHaveBeenCalledTimes(1);
    expect(await f.command(bob, "SALDO")).toContain("disponible: 0 COP");
    (await assertBalanced());
  });

  it("no acredita al receptor si falla la retirada de liquidez", async () => {
    await signup(alice); await signup(bob);
    (await fundTestAccount(f.deps, alice, 10000, "initial"));
    const confirm = /CONFIRMAR ([a-f0-9-]+) ([A-Z0-9]+)/.exec(await f.command(alice, `PAGAR 5000 A ${bob}`))!;
    await f.command(alice, confirm[0]);
    f.complete();
    vi.mocked(f.gateway.withdrawIncoming).mockRejectedValue(new Error("timeout"));
    await reconcileManagedPayments(f.deps);
    expect(await f.command(bob, "SALDO")).toContain("disponible: 0 COP");
    expect(await f.command(alice, "SALDO")).toContain("Reservado: 5000 COP");
    (await assertBalanced());
  });

  it("conecta el webhook, conserva respuestas en reintentos y protege la recarga administrativa", async () => {
    const sms = new MockSmsProvider(f.config.SMS_WEBHOOK_SECRET);
    const app = buildApp({ config: f.config, db: f.db, provider: sms, managedGateway: f.gateway, secretBox: null, runWorker: false });
    const handler = async (message: Parameters<typeof handleManagedCommand>[1]) => (await handleManagedCommand(f.deps, message));
    try {
      const response = await app.inject({ method: "POST", url: "/webhooks/sms", headers: { "x-webhook-secret": "test-secret" }, payload: { messageId: "signup", from: alice, to: "+15551234567", text: "CREAR CUENTA" } });
      expect(response.statusCode).toBe(200);
      const send = vi.spyOn(sms, "sendMessage");
      send.mockRejectedValueOnce(new Error("SMS provider timeout"));
      await processNextSmsJob(f.deps, sms, handler);
      const challenges = (await f.db.get("SELECT COUNT(*) AS n FROM phone_verifications"));
      (await f.db.run("UPDATE jobs SET next_run_at = '2000-01-01', lease_until = NULL"));
      await processNextSmsJob(f.deps, sms, handler);
      expect((await f.db.get("SELECT COUNT(*) AS n FROM phone_verifications"))).toEqual(challenges);
      expect(sms.outbox.at(-1)!.text).toContain("VERIFICAR");
      const unauthorized = await app.inject({ method: "POST", url: "/admin/test/accounts/fund", payload: { phone: alice, amount: 1000, idempotencyKey: "unauthorized" } });
      expect(unauthorized.statusCode).toBe(401);
    } finally { await app.close(); }
  });
});
