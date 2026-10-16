import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import type { Amount } from "../src/domain";
import { AppError } from "../src/errors";
import { FakePaymentProvider } from "../src/payments/fake";
import { reconcilePendingPayments } from "../src/payments/reconciliation";
import {
  continueOutgoingAccess,
  executePayment,
  getPayment,
  preparePayment,
  refreshPaymentStatus,
  requestOutgoingAccess,
  type PaymentServiceDeps,
} from "../src/payments/service";
import type { GrantedAccess, WalletMetadata } from "../src/payments/types";
import { testDb } from "./helpers";

const senderWallet: WalletMetadata = {
  walletAddress: "https://sender.example/alice",
  currency: "COP",
  assetScale: 0,
  authServer: "https://auth.sender.example",
  resourceServer: "https://rs.sender.example",
};

const recipientWallet: WalletMetadata = {
  walletAddress: "https://receiver.example/bob",
  currency: "COP",
  assetScale: 0,
  authServer: "https://auth.receiver.example",
  resourceServer: "https://rs.receiver.example",
};

const cop = (value: string): Amount => ({ value, currency: "COP", assetScale: 0 });

function seed(db: Db): void {
  db.prepare(`INSERT INTO users (id, phone, status) VALUES ('u1', '+573001112233', 'active')`).run();
  db.prepare(
    `INSERT INTO wallets (id, user_id, wallet_address, currency, asset_scale, auth_server, resource_server)
     VALUES ('w1', 'u1', ?, 'COP', 0, ?, ?)`,
  ).run(senderWallet.walletAddress, senderWallet.authServer, senderWallet.resourceServer);
}

describe("flujo de pagos (proveedor fake)", () => {
  let db: Db;
  let provider: FakePaymentProvider;
  let deps: PaymentServiceDeps;

  beforeEach(() => {
    db = testDb();
    seed(db);
    provider = new FakePaymentProvider();
    provider.registerWallet(senderWallet, { balance: cop("100000"), grantLimit: cop("100000") });
    provider.registerWallet(recipientWallet);
    deps = { db, provider };
  });

  afterEach(() => {
    db.close();
  });

  async function prepare(debit: Amount = cop("5000"), idempotencyKey?: string) {
    return preparePayment(deps, {
      senderUserId: "u1",
      senderWalletId: "w1",
      senderWalletAddress: senderWallet.walletAddress,
      recipientWalletAddress: recipientWallet.walletAddress,
      debitAmount: debit,
      idempotencyKey,
    });
  }

  /** Obtiene un access token del grant interactivo completando la interacción. */
  async function grant(limit: Amount, nonce = "n1"): Promise<GrantedAccess> {
    const pending = await requestOutgoingAccess(deps, {
      wallet: senderWallet,
      limit,
      finishUri: "https://app.example/callback",
      nonce,
    });
    expect(pending.kind).toBe("pending");
    if (pending.kind !== "pending") {
      return pending;
    }
    const granted = await continueOutgoingAccess(deps, {
      wallet: senderWallet,
      continueUri: pending.continueUri,
      continueAccessToken: pending.continueAccessToken,
      interactRef: `grant-${nonce}`,
    });
    expect(granted).not.toBeNull();
    return granted as GrantedAccess;
  }

  it("prepara el pago persistiendo los snapshots del quote", async () => {
    const payment = await prepare();
    expect(payment.state).toBe("AWAITING_CONFIRMATION");
    expect(payment.debitAmount).toEqual(cop("5000"));
    expect(payment.receiveAmount).toEqual(cop("5000"));
    expect(payment.quoteId).toBeTruthy();
    expect(payment.quoteExpiresAt).toBeTruthy();
    expect(payment.incomingPaymentId).toBeTruthy();
  });

  it("un quote expirado exige reconfirmar y no ejecuta", async () => {
    const payment = await prepare();
    // Simula el paso del tiempo: el quote persistido queda vencido.
    db.prepare(`UPDATE payments SET quote_expires_at = ? WHERE id = ?`).run(
      new Date(Date.now() - 1000).toISOString(),
      payment.id,
    );

    await expect(executePayment(deps, { paymentId: payment.id, accessToken: "tok" })).rejects.toMatchObject({
      code: "QUOTE_EXPIRED",
    });
    // Sigue pendiente de confirmación: no se ejecuta ni se descarta.
    expect(getPayment(db, payment.id)?.state).toBe("AWAITING_CONFIRMATION");
  });

  it("no marca COMPLETED hasta que el recurso lo confirma", async () => {
    const payment = await prepare();
    const token = await grant(cop("100000"));

    const afterCreate = await executePayment(deps, { paymentId: payment.id, accessToken: token.accessToken });
    expect(afterCreate.state).toBe("PROCESSING");
    expect(afterCreate.outgoingPaymentId).toBeTruthy();

    // El recurso existe pero aún no confirma el envío.
    expect(getPayment(db, payment.id)?.state).toBe("PROCESSING");

    provider.setOutgoingPaymentStatus(afterCreate.outgoingPaymentId as string, "COMPLETED");
    const confirmed = await refreshPaymentStatus(deps, {
      paymentId: payment.id,
      accessToken: token.accessToken,
    });
    expect(confirmed.state).toBe("COMPLETED");
  });

  it("distingue presupuesto de grant insuficiente de fondos insuficientes", async () => {
    // Caso A: el importe supera el presupuesto autorizado del grant.
    const budgetPayment = await prepare();
    const smallGrant = await grant(cop("1000"));
    const budgetError = await executePayment(deps, {
      paymentId: budgetPayment.id,
      accessToken: smallGrant.accessToken,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(budgetError).toBeInstanceOf(AppError);
    expect((budgetError as AppError).code).toBe("INSUFFICIENT_GRANT_BUDGET");
    expect(getPayment(db, budgetPayment.id)?.state).toBe("FAILED");

    // Caso B: hay presupuesto suficiente pero la wallet no tiene fondos.
    provider.setWalletBalance(senderWallet.walletAddress, cop("100"));
    const fundsPayment = await prepare();
    const wideGrant = await grant(cop("100000"));
    const fundsError = await executePayment(deps, {
      paymentId: fundsPayment.id,
      accessToken: wideGrant.accessToken,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(fundsError).toBeInstanceOf(AppError);
    expect((fundsError as AppError).code).toBe("INSUFFICIENT_FUNDS");
    expect(getPayment(db, fundsPayment.id)?.state).toBe("FAILED");

    // Los dos errores son códigos distintos y accionables de forma distinta.
    expect((budgetError as AppError).code).not.toBe((fundsError as AppError).code);
  });

  it("reconcilia un resultado incierto consultando el recurso conocido", async () => {
    const payment = await prepare();
    const token = await grant(cop("100000"));

    // La consulta falla tras crear el recurso: resultado incierto.
    provider.failNextGetForWallet(senderWallet.walletAddress);
    const uncertain = await executePayment(deps, { paymentId: payment.id, accessToken: token.accessToken });
    expect(uncertain.state).toBe("NEEDS_REVIEW");
    expect(uncertain.outgoingPaymentId).toBeTruthy();

    // El recurso confirma después; la reconciliación lo resuelve sin reenviar.
    provider.setOutgoingPaymentStatus(uncertain.outgoingPaymentId as string, "COMPLETED");
    const result = await reconcilePendingPayments(deps, { accessToken: token.accessToken });
    expect(result.updated).toBe(1);
    expect(getPayment(db, payment.id)?.state).toBe("COMPLETED");
  });

  it("no reintenta a ciegas un create incierto sin recurso conocido", async () => {
    const payment = await prepare();
    const token = await grant(cop("100000"));

    provider.failNextCreatePayment();
    const uncertain = await executePayment(deps, { paymentId: payment.id, accessToken: token.accessToken });
    expect(uncertain.state).toBe("NEEDS_REVIEW");
    expect(uncertain.outgoingPaymentId).toBeNull();

    const result = await reconcilePendingPayments(deps, { accessToken: token.accessToken });
    expect(result.inspected).toBe(1);
    expect(result.unresolved).toBe(1);
    expect(getPayment(db, payment.id)?.state).toBe("NEEDS_REVIEW");
  });
});
