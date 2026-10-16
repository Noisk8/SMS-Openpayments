import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { AppConfig } from "../src/config";
import type { Db } from "../src/db";
import type { Amount } from "../src/domain";
import { AppError, httpStatusFor, isAppError } from "../src/errors";
import { registerGrantRoutes } from "../src/grants/routes";
import { registerOnboardingRoutes } from "../src/onboarding/routes";
import type {
  CreateOutgoingPaymentInput,
  GrantBudgetUsage,
  GrantedAccess,
  IncomingPayment,
  OutgoingGrantRequest,
  OutgoingPayment,
  PaymentProvider,
  PendingGrant,
  Quote,
  WalletMetadata,
} from "../src/payments/types";
import { registerRecipientRoutes } from "../src/recipients/routes";
import { SecretBox, generateEncryptionKey } from "../src/security/encryption";
import { testConfig, testDb } from "./helpers";

/** Deterministic in-memory payment provider for the account/onboarding tests. */
class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  continueCalls: Array<{ interactRef: string; continueAccessToken: string }> = [];

  async getWalletMetadata(walletAddress: string): Promise<WalletMetadata> {
    if (!/^https:\/\//.test(walletAddress)) {
      throw new AppError("VALIDATION_FAILED", "wallet address inválida");
    }
    return {
      walletAddress,
      currency: "COP",
      assetScale: 0,
      authServer: "https://auth.example",
      resourceServer: "https://rs.example",
    };
  }

  async createIncomingPayment(_input: { wallet: WalletMetadata; accessToken?: string }): Promise<IncomingPayment> {
    return { id: "https://rs.example/incoming/1" };
  }

  async createQuote(_input: {
    wallet: WalletMetadata;
    receiver: string;
    debitAmount: Amount;
    accessToken?: string;
  }): Promise<Quote> {
    throw new Error("createQuote is not used in these tests");
  }

  async requestOutgoingGrant(_input: OutgoingGrantRequest): Promise<PendingGrant | GrantedAccess> {
    return {
      kind: "pending",
      interactUrl: "https://wallet.example/interact",
      continueUri: "https://wallet.example/continue",
      continueAccessToken: "continue-access-token",
    };
  }

  async continueGrant(input: {
    wallet: WalletMetadata;
    continueUri: string;
    continueAccessToken: string;
    interactRef: string;
  }): Promise<GrantedAccess | null> {
    this.continueCalls.push({
      interactRef: input.interactRef,
      continueAccessToken: input.continueAccessToken,
    });
    if (input.interactRef === "bad-ref") {
      return null;
    }
    return { kind: "granted", accessToken: "granted-access-token", expiresAt: "2027-01-01T00:00:00.000Z" };
  }

  async createOutgoingPayment(_input: CreateOutgoingPaymentInput): Promise<OutgoingPayment> {
    throw new Error("createOutgoingPayment is not used in these tests");
  }

  async getOutgoingPayment(_input: { url: string; accessToken: string }): Promise<OutgoingPayment> {
    throw new Error("getOutgoingPayment is not used in these tests");
  }

  async getGrantUsage(_input: { wallet: WalletMetadata; accessToken: string }): Promise<GrantBudgetUsage | null> {
    return {
      limit: { value: "100000", currency: "COP", assetScale: 0 },
      spent: { value: "5000", currency: "COP", assetScale: 0 },
      remaining: { value: "95000", currency: "COP", assetScale: 0 },
    };
  }

  async cancelGrant(_input: { wallet: WalletMetadata; accessToken: string }): Promise<void> {
    // no-op
  }

  async rotateAccessToken(_input: {
    wallet: WalletMetadata;
    accessToken: string;
  }): Promise<GrantedAccess | null> {
    return { kind: "granted", accessToken: "rotated-access-token", expiresAt: "2027-06-01T00:00:00.000Z" };
  }

  async revokeAccessToken(_input: { wallet: WalletMetadata; accessToken: string }): Promise<void> {
    // no-op
  }
}

describe("onboarding y gestión de cuentas", () => {
  let config: AppConfig;
  let db: Db;
  let provider: FakePaymentProvider;
  let secretBox: SecretBox;
  let app: FastifyInstance;

  const adminHeaders = (token = config?.ADMIN_API_TOKEN ?? "") => ({
    authorization: `Bearer ${token}`,
  });

  function buildTestApp(): FastifyInstance {
    const testApp = Fastify({ logger: false });
    const deps = { config, db, provider, secretBox };
    registerOnboardingRoutes(testApp, deps);
    registerRecipientRoutes(testApp, deps);
    registerGrantRoutes(testApp, deps);
    testApp.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "VALIDATION_FAILED", issues: error.issues });
      }
      if (isAppError(error)) {
        return reply.code(httpStatusFor(error.code)).send({ error: error.code, message: error.message });
      }
      return reply.code(500).send({ error: "INTERNAL" });
    });
    return testApp;
  }

  async function createUser(phone: string): Promise<{ id: string; status: string; phone: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: adminHeaders(),
      payload: { phone },
    });
    expect(res.statusCode).toBe(201);
    return res.json().user;
  }

  async function requestCode(userId: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: `/admin/users/${userId}/phone/request-code`,
      headers: adminHeaders(),
    });
    expect(res.statusCode).toBe(200);
    return res.json().devCode as string;
  }

  async function verifyCode(userId: string, code: string): Promise<number> {
    const res = await app.inject({
      method: "POST",
      url: `/admin/users/${userId}/phone/verify`,
      headers: adminHeaders(),
      payload: { code },
    });
    return res.statusCode;
  }

  async function enrollUser(
    phone: string,
    walletAddress: string,
  ): Promise<{ userId: string; grantId: string }> {
    const user = await createUser(phone);
    const code = await requestCode(user.id);
    expect(await verifyCode(user.id, code)).toBe(200);
    const connect = await app.inject({
      method: "POST",
      url: `/admin/users/${user.id}/wallets/connect`,
      headers: adminHeaders(),
      payload: { walletAddress },
    });
    expect(connect.statusCode).toBe(200);
    return { userId: user.id, grantId: connect.json().grant.id as string };
  }

  beforeEach(() => {
    config = testConfig();
    db = testDb();
    provider = new FakePaymentProvider();
    secretBox = new SecretBox(generateEncryptionKey());
    app = buildTestApp();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("crea un usuario y normaliza el teléfono", async () => {
    const created = await createUser("3001234567");
    expect(created.phone).toBe("+573001234567");
    expect(created.status).toBe("pending");

    // Normalizes numbers that already carry the country code.
    const withPrefix = await createUser("+57 300 765 4321");
    expect(withPrefix.phone).toBe("+573007654321");

    const duplicate = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: adminHeaders(),
      payload: { phone: "3001234567" },
    });
    expect(duplicate.statusCode).toBe(409);

    const invalid = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: adminHeaders(),
      payload: { phone: "123" },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("verifica el teléfono con un código de un solo uso (expiración e intentos)", async () => {
    const user = await createUser("3001111111");
    const code = await requestCode(user.id);

    // Wrong code fails and is not consumed.
    expect(await verifyCode(user.id, "000000")).toBe(400);

    expect(await verifyCode(user.id, code)).toBe(200);
    const row = db
      .prepare("SELECT phone_verified_at, status FROM users WHERE id = ?")
      .get(user.id) as { phone_verified_at: string | null; status: string };
    expect(row.phone_verified_at).not.toBeNull();
    expect(row.status).toBe("active");

    // Expired code is rejected.
    const expired = await createUser("3001222222");
    const expiredCode = await requestCode(expired.id);
    db.prepare("UPDATE phone_verifications SET expires_at = ? WHERE user_id = ?").run(
      "2000-01-01T00:00:00.000Z",
      expired.id,
    );
    expect(await verifyCode(expired.id, expiredCode)).toBe(400);

    // Attempt limit blocks even the correct code.
    const limited = await createUser("3001333333");
    const limitedCode = await requestCode(limited.id);
    for (let i = 0; i < 5; i += 1) {
      expect(await verifyCode(limited.id, "999999")).toBe(400);
    }
    expect(await verifyCode(limited.id, limitedCode)).toBe(403);
  });

  it("resuelve destinatarios por wallet explícita, teléfono registrado y alias", async () => {
    const alice = await enrollUser("3001234567", "https://wallet.example/alice");
    await enrollUser("3007654321", "https://wallet.example/bob");

    // (a) explicit wallet address
    const carol = await app.inject({
      method: "POST",
      url: `/admin/users/${alice.userId}/recipients`,
      headers: adminHeaders(),
      payload: { alias: "CAROL", walletAddress: "https://wallet.example/carol" },
    });
    expect(carol.statusCode).toBe(201);
    expect(carol.json().recipient.wallet_address).toBe("https://wallet.example/carol");

    // (b) phone already linked to a registered wallet
    const bob = await app.inject({
      method: "POST",
      url: `/admin/users/${alice.userId}/recipients`,
      headers: adminHeaders(),
      payload: { alias: "BOB", phone: "3007654321" },
    });
    expect(bob.statusCode).toBe(201);
    expect(bob.json().recipient.wallet_address).toBe("https://wallet.example/bob");
    expect(bob.json().recipient.phone).toBe("+573007654321");

    // A phone without a registered wallet does not resolve.
    const ghost = await app.inject({
      method: "POST",
      url: `/admin/users/${alice.userId}/recipients`,
      headers: adminHeaders(),
      payload: { alias: "GHOST", phone: "3009999999" },
    });
    expect(ghost.statusCode).toBe(404);

    // (c) existing user-specific alias resolves to the stored wallet.
    const resolved = await app.inject({
      method: "GET",
      url: `/admin/users/${alice.userId}/recipients/CAROL/resolve`,
      headers: adminHeaders(),
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().recipient.wallet_address).toBe("https://wallet.example/carol");

    // Duplicate alias is rejected.
    const duplicate = await app.inject({
      method: "POST",
      url: `/admin/users/${alice.userId}/recipients`,
      headers: adminHeaders(),
      payload: { alias: "CAROL", walletAddress: "https://wallet.example/carol2" },
    });
    expect(duplicate.statusCode).toBe(409);

    // Listing returns both recipients.
    const list = await app.inject({
      method: "GET",
      url: `/admin/users/${alice.userId}/recipients`,
      headers: adminHeaders(),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().recipients).toHaveLength(2);
  });

  it("protege los endpoints admin y rechaza tokens inválidos", async () => {
    const noToken = await app.inject({ method: "POST", url: "/admin/users", payload: { phone: "3001234567" } });
    expect(noToken.statusCode).toBe(401);

    const wrongToken = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: adminHeaders("token-incorrecto"),
      payload: { phone: "3001234567" },
    });
    expect(wrongToken.statusCode).toBe(401);

    const malformed = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: { authorization: "Bearer" },
      payload: { phone: "3001234567" },
    });
    expect(malformed.statusCode).toBe(401);

    const valid = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: adminHeaders(),
      payload: { phone: "3001234567" },
    });
    expect(valid.statusCode).toBe(201);
    const userId = valid.json().user.id as string;

    for (const { method, url } of [
      { method: "GET", url: `/admin/users/${userId}/recipients` },
      { method: "GET", url: "/admin/grants/unknown/usage" },
      { method: "POST", url: "/admin/grants/unknown/cancel" },
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    }

    // The callback is public but validates the stored interaction (no 401).
    const callback = await app.inject({
      method: "GET",
      url: "/auth/callback?grant_id=unknown&interact_ref=ref",
    });
    expect(callback.statusCode).toBe(404);
  });

  it("gestiona el ciclo de vida del grant (callback, usage, rotate y revoke)", async () => {
    const alice = await enrollUser("3001234567", "https://wallet.example/alice");

    // Callback validates the stored interaction and grants access.
    const callback = await app.inject({
      method: "GET",
      url: `/auth/callback?grant_id=${alice.grantId}&interact_ref=ref-ok`,
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.json()).toMatchObject({ grantId: alice.grantId, status: "GRANTED" });
    // The stored continue token was used to continue the grant.
    expect(provider.continueCalls.at(-1)?.continueAccessToken).toBe("continue-access-token");

    // Usage is reported where supported.
    const usage = await app.inject({
      method: "GET",
      url: `/admin/grants/${alice.grantId}/usage`,
      headers: adminHeaders(),
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({ supported: true });
    expect(usage.json().usage.spent.value).toBe("5000");

    // Rotation replaces the token with a later expiry.
    const rotate = await app.inject({
      method: "POST",
      url: `/admin/grants/${alice.grantId}/token/rotate`,
      headers: adminHeaders(),
    });
    expect(rotate.statusCode).toBe(200);
    expect(rotate.json()).toMatchObject({ rotated: true, expiresAt: "2027-06-01T00:00:00.000Z" });

    // Revocation ends authorization; later operations conflict.
    const revoke = await app.inject({
      method: "POST",
      url: `/admin/grants/${alice.grantId}/token/revoke`,
      headers: adminHeaders(),
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().status).toBe("REVOKED");

    const usageAfter = await app.inject({
      method: "GET",
      url: `/admin/grants/${alice.grantId}/usage`,
      headers: adminHeaders(),
    });
    expect(usageAfter.statusCode).toBe(409);

    // A rejected interaction does not grant access.
    const second = await app.inject({
      method: "POST",
      url: `/admin/users/${alice.userId}/wallets/connect`,
      headers: adminHeaders(),
      payload: { walletAddress: "https://wallet.example/alice" },
    });
    expect(second.statusCode).toBe(200);
    const pendingId = second.json().grant.id as string;
    const rejected = await app.inject({
      method: "GET",
      url: `/auth/callback?grant_id=${pendingId}&interact_ref=bad-ref`,
    });
    expect(rejected.statusCode).toBe(400);
    const stillPending = db
      .prepare("SELECT status FROM grants WHERE id = ?")
      .get(pendingId) as { status: string };
    expect(stillPending.status).toBe("PENDING_INTERACTION");
  });
});
