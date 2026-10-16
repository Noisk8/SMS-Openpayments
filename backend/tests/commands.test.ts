import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config";
import type { Db } from "../src/db";
import type { Amount } from "../src/domain";
import { registerJobHandlers } from "../src/jobs/handlers";
import { JobProcessor } from "../src/jobs/processor";
import { FakePaymentProvider } from "../src/payments/fake";
import { refreshPaymentStatus } from "../src/payments/service";
import type { GrantedAccess, PendingGrant, WalletMetadata } from "../src/payments/types";
import { SecretBox, generateEncryptionKey } from "../src/security/encryption";
import { parseMajorUnits, runCommand, type CommandServiceDeps } from "../src/sms/command-service";
import { MockSmsProvider } from "../src/sms/providers/mock";
import { persistInboundSms } from "../src/sms/service";
import { nowIso } from "../src/util/time";
import { testConfig, testDb } from "./helpers";

const SENDER_PHONE = "+573001112233";

const senderWallet: WalletMetadata = {
  walletAddress: "https://wallet.example/alice",
  currency: "COP",
  assetScale: 0,
  authServer: "https://auth.example",
  resourceServer: "https://rs.example",
};

const recipientWallet: WalletMetadata = {
  walletAddress: "https://wallet.example/bob",
  currency: "COP",
  assetScale: 0,
  authServer: "https://auth.example",
  resourceServer: "https://rs.example",
};

const cop = (value: string): Amount => ({ value, currency: "COP", assetScale: 0 });

interface PaymentRowLike {
  id: string;
  reference: string;
  state: string;
  confirmation_hash: string | null;
  confirmation_expires_at: string | null;
  confirmation_attempts: number;
  outgoing_payment_id: string | null;
}

describe("SMS command service", () => {
  let config: AppConfig;
  let db: Db;
  let provider: FakePaymentProvider;
  let sms: MockSmsProvider;
  let secretBox: SecretBox;
  let deps: CommandServiceDeps;
  let counter: number;

  async function seed(): Promise<void> {
    await db.run(
      `INSERT INTO users (id, phone, phone_verified_at, status) VALUES ('u1', ?, ?, 'active')`,
      [SENDER_PHONE, nowIso()],
    );
    await db.run(
      `INSERT INTO wallets (id, user_id, wallet_address, currency, asset_scale, auth_server, resource_server)
       VALUES ('w1', 'u1', ?, 'COP', 0, ?, ?)`,
      [senderWallet.walletAddress, senderWallet.authServer, senderWallet.resourceServer],
    );
    await db.run(
      `INSERT INTO recipients (id, user_id, number, alias, wallet_address, currency, asset_scale)
       VALUES ('r1', 'u1', 1, 'bob', ?, 'COP', 0)`,
      [recipientWallet.walletAddress],
    );
    await db.run(`INSERT INTO recipient_counters (user_id, next_number) VALUES ('u1', 2)`);
    provider.registerWallet(senderWallet, { balance: cop("100000"), grantLimit: cop("100000") });
    provider.registerWallet(recipientWallet);
  }

  /** Mints an outgoing access token and stores it as a `GRANTED` grant. */
  async function storeGrantedToken(limit: Amount = cop("100000")): Promise<string> {
    counter += 1;
    const nonce = `n-${counter}`;
    const pending = await provider.requestOutgoingGrant({
      wallet: senderWallet,
      limit,
      finishUri: "https://app.example/callback",
      nonce,
    });
    expect(pending.kind).toBe("pending");
    const granted = await provider.continueGrant({
      wallet: senderWallet,
      continueUri: (pending as PendingGrant).continueUri,
      continueAccessToken: (pending as PendingGrant).continueAccessToken,
      interactRef: `grant-${nonce}`,
    });
    expect(granted).not.toBeNull();
    const token = (granted as GrantedAccess).accessToken;
    await db.run(
      `INSERT INTO grants
         (id, wallet_id, status, scopes, limit_value, limit_currency, limit_scale,
          access_token_enc, expires_at, created_at, updated_at)
       VALUES (?, 'w1', 'GRANTED', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `g-${counter}`,
        JSON.stringify(["outgoing-payment"]),
        limit.value,
        limit.currency,
        limit.assetScale,
        secretBox.encrypt(token),
        granted?.expiresAt ?? null,
        nowIso(),
        nowIso(),
      ],
    );
    return token;
  }

  const run = (text: string, from = SENDER_PHONE) => {
    counter += 1;
    return runCommand(deps, {
      provider: sms.name,
      messageId: `m-${counter}`,
      from,
      to: config.SMS_FROM,
      text,
      receivedAt: nowIso(),
    });
  };

  const codeFrom = (reply: string): string => {
    const match = reply.match(/CONFIRMAR\s+(\d{4})/);
    expect(match).not.toBeNull();
    return match?.[1] as string;
  };

  const paymentRow = async (): Promise<PaymentRowLike> =>
    (await db.get<PaymentRowLike>(`SELECT * FROM payments`)) as PaymentRowLike;

  beforeEach(async () => {
    config = testConfig();
    db = await testDb();
    provider = new FakePaymentProvider();
    sms = new MockSmsProvider(config.SMS_WEBHOOK_SECRET);
    secretBox = new SecretBox(generateEncryptionKey());
    counter = 0;
    await seed();
    deps = { config, db, provider, sms, secretBox };
  });

  afterEach(async () => {
    await db.close();
  });

  it("responde la ayuda corta a AYUDA y rechaza comandos desconocidos", async () => {
    const help = await run("AYUDA");
    expect(help.reply).toBe(
      ["P 1000 ANA: pagar", "Codigo recibido: confirmar", "0: cancelar", "1: ultimo pago", "9: ayuda"].join("\n"),
    );
    expect(help.reply).not.toMatch(/destino/i);

    const unknown = await run("HOLA");
    expect(unknown.reply).toMatch(/no reconocido/i);
  });

  it("acepta verbos, separador, moneda y alias en minúsculas", async () => {
    const help = await run("ayuda");
    expect(help.reply).toBe(
      ["P 1000 ANA: pagar", "Codigo recibido: confirmar", "0: cancelar", "1: ultimo pago", "9: ayuda"].join("\n"),
    );

    const prepared = await run("pagar 5000 cop a bob");
    expect(prepared.reply).toContain("Pago pendiente de confirmación");
    expect(prepared.reply).toContain("Destino: bob");

    const code = codeFrom(prepared.reply);
    const cancelled = await run(`cancelar ${code}`);
    expect(cancelled.state).toBe("CANCELLED");
  });

  it("rechaza remitentes no registrados, no verificados o suspendidos sin crear pagos", async () => {
    const stranger = await run("PAGAR 5000 A bob", "+579999999999");
    expect(stranger.reply).toMatch(/no encontramos/i);

    await db.run(`INSERT INTO users (id, phone, status) VALUES ('u2', '+573009998877', 'pending')`);
    const unverified = await run("PAGAR 5000 A bob", "+573009998877");
    expect(unverified.reply).toMatch(/no está verificado/i);

    await db.run(
      `INSERT INTO users (id, phone, phone_verified_at, status) VALUES ('u3', '+573007776655', ?, 'suspended')`,
      [nowIso()],
    );
    const suspended = await run("PAGAR 5000 A bob", "+573007776655");
    expect(suspended.reply).toMatch(/suspendida/i);

    const count = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM payments`);
    expect(count?.n).toBe(0);
  });

  it("PAGAR crea AWAITING_CONFIRMATION y almacena solo el hash del código", async () => {
    const res = await run("PAGAR 5000 A bob");
    expect(res.state).toBe("AWAITING_CONFIRMATION");
    expect(res.reply).toContain("bob");
    expect(res.reply).toContain(recipientWallet.walletAddress);
    // Amounts are shown in major units without repeating the wallet currency.
    expect(res.reply).toContain("Envías: 5000");
    expect(res.reply).toContain("Recibe: 5000");
    expect(res.reply).not.toContain("COP");

    const code = codeFrom(res.reply);
    expect(code).toMatch(/^\d{4}$/);

    const row = await paymentRow();
    expect(row.state).toBe("AWAITING_CONFIRMATION");
    expect(row.confirmation_hash).toBeTruthy();
    expect(row.confirmation_hash).not.toContain(code);
    expect(row.confirmation_expires_at).toBeTruthy();
    expect(row.confirmation_attempts).toBe(0);
  });

  it("usa la moneda de la wallet y rechaza una moneda distinta", async () => {
    const ok = await run("PAGAR 5000 A bob");
    expect(ok.reply).toContain("Envías: 5000");
    expect(ok.reply).not.toContain("COP");

    const mismatch = await run("PAGAR 5000 USD A bob");
    expect(mismatch.reply).toMatch(/no coincide/i);

    const count = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM payments`);
    expect(count?.n).toBe(1);
  });

  it("parsea montos según la escala del activo", () => {
    expect(parseMajorUnits("5000", 0)).toBe("5000");
    expect(parseMajorUnits("5.5", 0)).toBeNull();
    expect(parseMajorUnits("1.50", 2)).toBe("150");
    expect(parseMajorUnits("0.05", 2)).toBe("5");
    expect(parseMajorUnits("abc", 0)).toBeNull();
    expect(parseMajorUnits("-5", 0)).toBeNull();
  });

  it("el handler process_inbound_sms envía el SMS de confirmación con ambos montos", async () => {
    await persistInboundSms(db, {
      provider: sms.name,
      messageId: "msg-pay-1",
      from: SENDER_PHONE,
      to: config.SMS_FROM,
      text: "PAGAR 5000 A bob",
      receivedAt: nowIso(),
    });

    const processor = new JobProcessor({ db });
    registerJobHandlers(processor, deps);
    expect(await processor.runOnce()).toBe(true);

    expect(sms.outbox).toHaveLength(1);
    const sent = sms.outbox[0];
    expect(sent?.to).toBe(SENDER_PHONE);
    expect(sent?.text).toContain("bob");
    expect(sent?.text).toContain("5000");
    expect(sent?.text).not.toContain("COP");
    expect((await paymentRow()).state).toBe("AWAITING_CONFIRMATION");

    const processed = await db.get<{ processed_at: string | null }>(
      `SELECT processed_at FROM sms_messages WHERE direction = 'inbound' LIMIT 1`,
    );
    expect(processed?.processed_at).not.toBeNull();
  });

  it("rechaza un código vencido sin ejecutar", async () => {
    const res = await run("PAGAR 5000 A bob");
    const code = codeFrom(res.reply);
    await db.run(`UPDATE payments SET confirmation_expires_at = ?`, ["2000-01-01T00:00:00.000Z"]);

    const confirm = await run(`CONFIRMAR ${code}`);
    expect(confirm.reply).toMatch(/venci/i);
    // A lapsed code expires the payment automatically so a new one can be created.
    expect((await paymentRow()).state).toBe("EXPIRED");
  });

  it("limita los intentos y bloquea incluso el código correcto", async () => {
    const res = await run("PAGAR 5000 A bob");
    const code = codeFrom(res.reply);
    const wrong = code === "0000" ? "1111" : "0000";

    for (let i = 0; i < 5; i += 1) {
      const attempt = await run(`CONFIRMAR ${wrong}`);
      expect(attempt.reply).toMatch(/incorrecto/i);
    }

    const blocked = await run(`CONFIRMAR ${code}`);
    expect(blocked.reply).toMatch(/demasiados intentos/i);

    const row = await paymentRow();
    expect(row.confirmation_attempts).toBe(5);
    expect(row.state).toBe("AWAITING_CONFIRMATION");
  });

  it("CONFIRMAR con un grant válido ejecuta y un duplicado no ejecuta dos veces", async () => {
    await storeGrantedToken();
    const res = await run("PAGAR 5000 A bob");
    const code = codeFrom(res.reply);

    const created: string[] = [];
    const originalCreate = provider.createOutgoingPayment.bind(provider);
    provider.createOutgoingPayment = async (input) => {
      const outgoing = await originalCreate(input);
      created.push(outgoing.id);
      return outgoing;
    };

    const first = await run(`CONFIRMAR ${code}`);
    expect(first.state).toBe("PROCESSING");
    expect(first.reply).not.toMatch(/completad/i);

    const second = await run(`CONFIRMAR ${code}`);
    expect(second.reply).toMatch(/no tienes pagos pendientes/i);
    expect(created).toHaveLength(1);
    expect((await paymentRow()).state).toBe("PROCESSING");
  });

  it("no reporta COMPLETED hasta que el proveedor confirma el recurso", async () => {
    const token = await storeGrantedToken();
    const res = await run("PAGAR 5000 A bob");
    const code = codeFrom(res.reply);

    const confirm = await run(`CONFIRMAR ${code}`);
    expect(confirm.state).toBe("PROCESSING");
    expect(confirm.reply).not.toMatch(/completad/i);

    const outgoingId = (await paymentRow()).outgoing_payment_id as string;
    provider.setOutgoingPaymentStatus(outgoingId, "COMPLETED");
    const confirmed = await refreshPaymentStatus(
      { db, provider },
      { paymentId: res.paymentId as string, accessToken: token },
    );
    expect(confirmed.state).toBe("COMPLETED");
  });

  it("sin grant válido responde con la URL de interacción y no ejecuta", async () => {
    const res = await run("PAGAR 5000 A bob");
    const code = codeFrom(res.reply);

    const confirm = await run(`CONFIRMAR ${code}`);
    expect(confirm.reply).toContain("/interact/");
    expect(confirm.state).toBe("AWAITING_CONFIRMATION");

    const row = await paymentRow();
    expect(row.state).toBe("AWAITING_CONFIRMATION");
    expect(row.outgoing_payment_id).toBeNull();

    const grant = await db.get<{ status: string }>(
      `SELECT status FROM grants WHERE status = 'PENDING_INTERACTION'`,
    );
    expect(grant?.status).toBe("PENDING_INTERACTION");
  });

  it("CANCELAR cancela antes de ejecutar y rechaza códigos incorrectos", async () => {
    const res = await run("PAGAR 5000 A bob");
    const code = codeFrom(res.reply);
    const wrong = code === "0000" ? "1111" : "0000";

    const rejected = await run(`CANCELAR ${wrong}`);
    expect(rejected.reply).toMatch(/incorrecto|no cancelable/i);
    expect((await paymentRow()).state).toBe("AWAITING_CONFIRMATION");

    const cancelled = await run(`CANCELAR ${code}`);
    expect(cancelled.state).toBe("CANCELLED");
    expect((await paymentRow()).state).toBe("CANCELLED");

    const confirmAfter = await run(`CONFIRMAR ${code}`);
    expect(confirmAfter.reply).toMatch(/no tienes pagos pendientes/i);
  });

  it("ESTADO solo devuelve pagos del remitente", async () => {
    const res = await run("PAGAR 5000 A bob");
    const reference = (await paymentRow()).reference;

    const own = await run(`ESTADO ${reference}`);
    expect(own.reply).toContain(reference);
    expect(own.reply).toMatch(/pendiente de confirmación/i);

    await db.run(
      `INSERT INTO users (id, phone, phone_verified_at, status) VALUES ('u9', '+573001110000', ?, 'active')`,
      [nowIso()],
    );
    const other = await run(`ESTADO ${reference}`, "+573001110000");
    expect(other.reply).toMatch(/no encontramos un pago/i);

    const unknown = await run("ESTADO ref-desconocida");
    expect(unknown.reply).toMatch(/no encontramos un pago/i);
  });
});
