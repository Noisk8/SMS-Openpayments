import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config";
import type { Db } from "../src/db";
import type { Amount } from "../src/domain";
import { FakePaymentProvider } from "../src/payments/fake";
import type { GrantedAccess, PendingGrant, WalletMetadata } from "../src/payments/types";
import { createRecipient } from "../src/recipients/service";
import { SecretBox, generateEncryptionKey } from "../src/security/encryption";
import {
  MVP_MAX_AMOUNT_MAJOR,
  parseMvpAmount,
  runCommand,
  type CommandServiceDeps,
} from "../src/sms/command-service";
import { MockSmsProvider } from "../src/sms/providers/mock";
import { nowIso } from "../src/util/time";
import { testConfig, testDb } from "./helpers";

const SENDER_PHONE = "+573001112233";
const OTHER_PHONE = "+573009998877";

const senderWallet: WalletMetadata = {
  walletAddress: "https://wallet.example/alice",
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
  recipient_id: string | null;
  confirmation_hash: string | null;
  confirmation_expires_at: string | null;
  confirmation_attempts: number;
  outgoing_payment_id: string | null;
}

describe("SMS MVP short commands", () => {
  let config: AppConfig;
  let db: Db;
  let provider: FakePaymentProvider;
  let sms: MockSmsProvider;
  let secretBox: SecretBox;
  let deps: CommandServiceDeps;
  let counter: number;

  /** Registers a wallet on the fake provider for a fresh recipient alias. */
  async function addRecipient(alias: string, walletAddress: string): Promise<void> {
    provider.registerWallet({
      walletAddress,
      currency: "COP",
      assetScale: 0,
      authServer: "https://auth.example",
      resourceServer: "https://rs.example",
    });
    await createRecipient(deps, { userId: "u1", alias, walletAddress });
  }

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
    provider.registerWallet(senderWallet, { balance: cop("1000000"), grantLimit: cop("1000000") });
    // The alias is the only destination the SMS interface exposes.
    await addRecipient("Ana", "https://wallet.example/ana");
    await addRecipient("Tienda Ruta N", "https://wallet.example/tienda");
    await addRecipient("Juan", "https://wallet.example/juan");
  }

  /** Mints an outgoing access token and stores it as a `GRANTED` grant. */
  async function storeGrantedToken(limit: Amount = cop("1000000")): Promise<string> {
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

  const codeFromShort = (reply: string): string => {
    const match = reply.match(/Responde\s+(\d{4})\s+para pagar/);
    expect(match).not.toBeNull();
    return match?.[1] as string;
  };

  const paymentRow = async (): Promise<PaymentRowLike> =>
    (await db.get<PaymentRowLike>(`SELECT * FROM payments`)) as PaymentRowLike;

  const pendingRow = async (): Promise<PaymentRowLike> => {
    const row = await db.get<PaymentRowLike>(
      `SELECT * FROM payments WHERE state = 'AWAITING_CONFIRMATION'`,
    );
    expect(row).toBeTruthy();
    return row as PaymentRowLike;
  };

  beforeEach(async () => {
    config = testConfig();
    db = await testDb();
    provider = new FakePaymentProvider();
    sms = new MockSmsProvider(config.SMS_WEBHOOK_SECRET);
    secretBox = new SecretBox(generateEncryptionKey());
    counter = 0;
    deps = { config, db, provider, sms, secretBox };
    await seed();
  });

  afterEach(async () => {
    await db.close();
  });

  const SHORT_HELP = [
    "Para pagar: P <monto> <destino>",
    "Ejemplo:    P 1000 RUTA",
    "Confirmar:  responde solo el codigo de 4 digitos",
    "0 cancela | 1 ultimo pago | 9 ayuda",
  ].join("\n");

  it("9 y las palabras de ayuda devuelven la misma ayuda corta, sin listar destinos", async () => {
    for (const text of ["9", "AYUDA", "ayuda", "HELP", "help", "Ayuda"]) {
      const help = await run(text);
      expect(help.reply).toBe(SHORT_HELP);
      expect(help.reply).not.toMatch(/Tienda Ruta N|Ana|Juan/);
    }
  });

  it("P 1000 <alias> prepara el pago con la moneda de la wallet", async () => {
    const res = await run("P 1000 Tienda Ruta N");
    expect(res.state).toBe("AWAITING_CONFIRMATION");
    expect(res.reply).toContain("Envias: 1000");
    expect(res.reply).toContain("Destino: Tienda Ruta N");
    expect(res.reply).toContain("Recibe: 1000");
    expect(res.reply).toContain("0 cancela. Vence en 5 min.");
    expect(res.reply).not.toContain("COP");

    const code = codeFromShort(res.reply);
    expect(code).toMatch(/^\d{4}$/);

    const row = await pendingRow();
    expect(row.confirmation_hash).toBeTruthy();
    expect(row.confirmation_hash).not.toContain(code);
    expect(row.confirmation_attempts).toBe(0);
    expect(row.recipient_id).toBeTruthy();
  });

  it("P 1000 TIENDARUTAN resuelve el alias sin espacios y sin distinguir mayúsculas", async () => {
    const res = await run("p 1000 tiendarutan");
    expect(res.state).toBe("AWAITING_CONFIRMATION");
    expect(res.reply).toContain("Destino: Tienda Ruta N");
    expect(res.reply).toContain("Responde");
    await run("0");

    const mixed = await run("P 1000 tIeNdA rUtA n");
    expect(mixed.state).toBe("AWAITING_CONFIRMATION");
    expect(mixed.reply).toContain("Destino: Tienda Ruta N");
  });

  it("P acepta espacios de más y rechaza formatos incorrectos", async () => {
    const extra = await run("P   1000   Ana");
    expect(extra.state).toBe("AWAITING_CONFIRMATION");
    await run("0");

    for (const bad of ["P 1000", "P abc Ana", "P 1.000 Ana", "P 1,000 Ana", "P -5 Ana", `P ${MVP_MAX_AMOUNT_MAJOR + 1} Ana`]) {
      const res = await run(bad);
      expect(res.reply).toBe("Formato: P 1000 ANA. 9 para ayuda.");
    }
    const count = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM payments`);
    expect(count?.n).toBe(1);
  });

  it("un destinatario numérico ya no existe: P 1000 2 no resuelve ningún pago", async () => {
    const res = await run("P 1000 2");
    expect(res.reply).toBe("Destino no encontrado. 9 para ayuda.");

    const count = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM payments`);
    expect(count?.n).toBe(0);

    // A bare unknown digit is not a command either.
    const unknown = await run("7");
    expect(unknown.reply).toBe("Comando no reconocido. 9 para ayuda.");
  });

  it("destino inexistente informa y no crea pagos", async () => {
    const res = await run("P 1000 Nadie");
    expect(res.reply).toBe("Destino no encontrado. 9 para ayuda.");
    const count = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM payments`);
    expect(count?.n).toBe(0);
  });

  it("un pago nuevo reemplaza al pendiente anterior", async () => {
    await run("P 1000 Tienda Ruta N");
    const second = await run("P 2000 Juan");
    expect(second.reply).toContain("Responde");
    const rows = await db.all<{ state: string }>(`SELECT state FROM payments ORDER BY seq`);
    expect(rows.map((row) => row.state)).toEqual(["CANCELLED", "AWAITING_CONFIRMATION"]);
  });

  it("2 ya no lista destinos: es un comando desconocido", async () => {
    const res = await run("2");
    expect(res.reply).toBe("Comando no reconocido. 9 para ayuda.");
    expect(res.reply).not.toMatch(/destino/i);
    expect(res.reply).not.toMatch(/Ana|Juan|Tienda/);
  });

  it("un destinatario borrado deja de resolver y su número no lo sustituye", async () => {
    const removed = await db.get<{ id: string }>(`SELECT id FROM recipients WHERE alias = 'Tienda Ruta N'`);
    await db.run(`DELETE FROM recipients WHERE id = ?`, [removed?.id]);

    const gone = await run("P 1000 Tienda Ruta N");
    expect(gone.reply).toBe("Destino no encontrado. 9 para ayuda.");

    // Its old recipient number never resolves either.
    const numbered = await run("P 1000 2");
    expect(numbered.reply).toBe("Destino no encontrado. 9 para ayuda.");
  });

  it("cada usuario resuelve solo sus propios alias", async () => {
    await db.run(
      `INSERT INTO users (id, phone, phone_verified_at, status) VALUES ('u2', ?, ?, 'active')`,
      [OTHER_PHONE, nowIso()],
    );
    await db.run(
      `INSERT INTO wallets (id, user_id, wallet_address, currency, asset_scale, auth_server, resource_server)
       VALUES ('w2', 'u2', 'https://wallet.example/bob', 'COP', 0, ?, ?)`,
      [senderWallet.authServer, senderWallet.resourceServer],
    );
    provider.registerWallet({ ...senderWallet, walletAddress: "https://wallet.example/bob" });
    provider.registerWallet({ ...senderWallet, walletAddress: "https://wallet.example/carol" });
    await createRecipient(
      { config, db, provider, secretBox },
      { userId: "u2", alias: "Carol", walletAddress: "https://wallet.example/carol" },
    );

    const res = await run("P 1000 Carol", OTHER_PHONE);
    expect(res.state).toBe("AWAITING_CONFIRMATION");
    expect(res.reply).toContain("Destino: Carol");

    // An alias owned by another user is never visible here.
    const foreign = await run("P 1000 Ana", OTHER_PHONE);
    expect(foreign.reply).toBe("Destino no encontrado. 9 para ayuda.");
  });

  it("un código de 4 dígitos confirma el pago pendiente y avisa al confirmar", async () => {
    await storeGrantedToken();
    const prepared = await run("P 1000 Tienda Ruta N");
    const code = codeFromShort(prepared.reply);

    const created: string[] = [];
    const originalCreate = provider.createOutgoingPayment.bind(provider);
    provider.createOutgoingPayment = async (input) => {
      const outgoing = await originalCreate(input);
      created.push(outgoing.id);
      return outgoing;
    };

    const confirm = await run(code);
    expect(confirm.state).toBe("PROCESSING");
    expect(confirm.reply).toContain("Pago en proceso: 1000 a Tienda Ruta N.");
    expect(confirm.reply).toContain("1 para consultar.");

    // Repeating the code never debits twice.
    const repeat = await run(code);
    expect(repeat.reply).toBe("No tienes un pago pendiente. 9 para ayuda.");
    expect(created).toHaveLength(1);
  });

  it("avisa 'Pago confirmado' cuando el proveedor confirma la liquidación", async () => {
    provider = new FakePaymentProvider({ initialOutgoingStatus: "COMPLETED" });
    provider.registerWallet(senderWallet, { balance: cop("1000000"), grantLimit: cop("1000000") });
    provider.registerWallet({ ...senderWallet, walletAddress: "https://wallet.example/ana" });
    provider.registerWallet({ ...senderWallet, walletAddress: "https://wallet.example/tienda" });
    provider.registerWallet({ ...senderWallet, walletAddress: "https://wallet.example/juan" });
    deps = { config, db, provider, sms, secretBox };
    await storeGrantedToken();

    const prepared = await run("P 1000 Tienda Ruta N");
    const code = codeFromShort(prepared.reply);
    const confirm = await run(code);
    expect(confirm.state).toBe("COMPLETED");
    expect(confirm.reply).toBe("Pago confirmado: 1000 a Tienda Ruta N.");
  });

  it("cuenta los intentos fallidos y los bloquea", async () => {
    const prepared = await run("P 1000 Tienda Ruta N");
    const code = codeFromShort(prepared.reply);
    const wrong = code === "0000" ? "1111" : "0000";

    for (let remaining = 4; remaining >= 0; remaining -= 1) {
      const attempt = await run(wrong);
      expect(attempt.reply).toBe(`Codigo incorrecto. Quedan ${remaining} intentos.`);
    }
    expect((await pendingRow()).confirmation_attempts).toBe(5);

    const blocked = await run(code);
    expect(blocked.reply).toBe("Demasiados intentos. Envia 0 para cancelar.");
  });

  it("un código vencido vence el pago y permite crear otro", async () => {
    const prepared = await run("P 1000 Tienda Ruta N");
    const code = codeFromShort(prepared.reply);
    await db.run(`UPDATE payments SET confirmation_expires_at = ? WHERE state = 'AWAITING_CONFIRMATION'`, [
      "2000-01-01T00:00:00.000Z",
    ]);

    const confirm = await run(code);
    expect(confirm.reply).toBe("El pago vencio. Crea otro con P monto destino.");
    expect(confirm.state).toBe("EXPIRED");
    expect((await paymentRow()).state).toBe("EXPIRED");

    // A new payment can be created right away.
    const next = await run("P 2000 Juan");
    expect(next.state).toBe("AWAITING_CONFIRMATION");
    expect(next.reply).toContain("Envias: 2000");
  });

  it("un pago vencido no bloquea un pago nuevo aunque no se confirme", async () => {
    await run("P 1000 Tienda Ruta N");
    await db.run(`UPDATE payments SET confirmation_expires_at = ? WHERE state = 'AWAITING_CONFIRMATION'`, [
      "2000-01-01T00:00:00.000Z",
    ]);

    const next = await run("P 3000 Ana");
    expect(next.state).toBe("AWAITING_CONFIRMATION");
    const count = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM payments WHERE state = 'AWAITING_CONFIRMATION'`);
    expect(count?.n).toBe(1);
  });

  it("0 cancela solo el pago pendiente", async () => {
    const cancelled = await run("0");
    expect(cancelled.reply).toBe("No tienes un pago pendiente. 9 para ayuda.");

    await run("P 1000 Tienda Ruta N");
    const res = await run("0");
    expect(res.reply).toBe("Pago cancelado. No se envio dinero.");
    expect(res.state).toBe("CANCELLED");
    expect((await paymentRow()).state).toBe("CANCELLED");

    const again = await run("0");
    expect(again.reply).toBe("No tienes un pago pendiente. 9 para ayuda.");
  });

  it("1 muestra el último pago, incluido el pendiente, sin repetir el código", async () => {
    const none = await run("1");
    expect(none.reply).toBe("No tienes pagos. 9 para ayuda.");

    const prepared = await run("P 1000 Tienda Ruta N");
    const code = codeFromShort(prepared.reply);
    const status = await run("1");
    expect(status.reply).toContain("Ultimo pago: 1000 a Tienda Ruta N.");
    expect(status.reply).toContain("Estado: pendiente.");
    expect(status.reply).toContain("SMS original");
    expect(status.reply).not.toContain(code);

    await run("0");
    const afterCancel = await run("1");
    expect(afterCancel.reply).toContain("Estado: cancelado.");
    expect(afterCancel.reply).toContain("No se envio dinero.");
  });

  it("nunca reutiliza un código para otro pago del mismo usuario", async () => {
    const first = await run("P 1000 Tienda Ruta N");
    const firstCode = codeFromShort(first.reply);
    await run("0");

    const second = await run("P 2000 Juan");
    const secondCode = codeFromShort(second.reply);
    expect(secondCode).not.toBe(firstCode);

    const registry = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM sms_confirmation_codes`);
    expect(registry?.n).toBe(2);
  });

  it("acepta mayúsculas/minúsculas y espacios extra en todos los comandos", async () => {
    const prepared = await run("  p   1000   tienda ruta n  ");
    expect(prepared.state).toBe("AWAITING_CONFIRMATION");
    const code = codeFromShort(prepared.reply);

    const unknownTwo = await run("2");
    expect(unknownTwo.reply).toBe("Comando no reconocido. 9 para ayuda.");

    const status = await run("1");
    expect(status.reply).toContain("Estado: pendiente.");

    const cancelled = await run("0");
    expect(cancelled.state).toBe("CANCELLED");

    const help = await run("9");
    expect(help.reply).toContain("P <monto> <destino>");
    expect(code).toMatch(/^\d{4}$/);
  });

  it("mantiene los comandos largos como alternativa compatible", async () => {
    const prepared = await run("PAGAR 5000 A bob");
    // `bob` is not among the sender's aliases, so the long command fails too.
    expect(prepared.reply).toMatch(/no existe un destinatario/i);

    const long = await run("pagar 1000 a Ana");
    expect(long.state).toBe("AWAITING_CONFIRMATION");
    const longCode = long.reply.match(/CONFIRMAR\s+(\d{4})/)?.[1] as string;
    expect(longCode).toMatch(/^\d{4}$/);

    const cancelled = await run(`cancelar ${longCode}`);
    expect(cancelled.state).toBe("CANCELLED");

    const reference = (await paymentRow()).reference;
    const estado = await run(`estado ${reference}`);
    expect(estado.reply).toContain("cancelado");

    // Both the word and the digit return the same short help now.
    for (const text of ["AYUDA", "ayuda", "HELP"]) {
      const ayuda = await run(text);
      expect(ayuda.reply).toBe(SHORT_HELP);
    }
  });

  it("parsea montos MVP como enteros positivos en unidades mayores", () => {
    expect(parseMvpAmount("1000", 0)).toBe("1000");
    expect(parseMvpAmount("1000", 2)).toBe("100000");
    expect(parseMvpAmount("1.000", 0)).toBeNull();
    expect(parseMvpAmount("1,000", 0)).toBeNull();
    expect(parseMvpAmount("-5", 0)).toBeNull();
    expect(parseMvpAmount("0", 0)).toBeNull();
    expect(parseMvpAmount("abc", 0)).toBeNull();
  });
});
