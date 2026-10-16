import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import type { AppConfig } from "../src/config";
import type { Db } from "../src/db";
import type { Amount } from "../src/domain";
import { registerJobHandlers } from "../src/jobs/handlers";
import { JobProcessor } from "../src/jobs/processor";
import { FakePaymentProvider } from "../src/payments/fake";
import type { WalletMetadata } from "../src/payments/types";
import { SecretBox, generateEncryptionKey } from "../src/security/encryption";
import { testConfig, testDb, testProvider } from "./helpers";

const TREASURY = "https://test.example/treasury";

const customerAddresses = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `https://test.example/customer-${index + 1}`);

const cop = (value: string): Amount => ({ value, currency: "COP", assetScale: 0 });

function walletMetadata(walletAddress: string, currency = "COP"): WalletMetadata {
  return {
    walletAddress,
    currency,
    assetScale: 0,
    authServer: "https://auth.test.example",
    resourceServer: "https://rs.test.example",
  };
}

describe("demo wallet pool", () => {
  let config: AppConfig;
  let db: Db;
  let secretBox: SecretBox;
  let provider: FakePaymentProvider;
  let app: FastifyInstance;
  let processor: JobProcessor;
  let clockMs: number;

  const adminHeaders = () => ({ authorization: `Bearer ${config.ADMIN_API_TOKEN}` });

  function registerFakeWallets(): void {
    provider.registerWallet(walletMetadata(TREASURY), { balance: cop("1000000"), grantLimit: cop("1000000") });
    for (const address of customerAddresses(9)) {
      provider.registerWallet(walletMetadata(address), { balance: cop("0"), grantLimit: cop("0") });
    }
  }

  function buildTestApp(): FastifyInstance {
    const sms = testProvider(config);
    return buildApp({
      config,
      db,
      provider: sms,
      paymentProvider: provider,
      secretBox,
      runWorker: false,
    });
  }

  async function importPool(addresses = customerAddresses(9)): Promise<{ statusCode: number; json: any }> {
    const res = await app.inject({
      method: "POST",
      url: "/admin/demo/wallet-pool/import",
      headers: adminHeaders(),
      payload: { treasury: TREASURY, customers: addresses },
    });
    return { statusCode: res.statusCode, json: res.json() };
  }

  async function registerDemo(phone: string) {
    const res = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: adminHeaders(),
      payload: { phone, assignDemoWallet: true },
    });
    return { statusCode: res.statusCode, json: res.json() };
  }

  /** Advances the job processor clock and drains every ready job. */
  async function runJobs(advanceMs = 1000): Promise<number> {
    clockMs += advanceMs;
    let processed = 0;
    while (await processor.runOnce()) {
      processed += 1;
    }
    return processed;
  }

  async function countRows(sql: string, params: readonly unknown[] = []): Promise<number> {
    const row = await db.get<{ n: number }>(sql, params);
    return Number(row?.n ?? 0);
  }

  /** Seeds a GRANTED treasury grant with a specific limit (fake provider). */
  async function seedTreasuryGrant(limit: Amount): Promise<string> {
    const wallet = await db.get<{ id: string }>("SELECT id FROM wallets WHERE wallet_address = ?", [TREASURY]);
    const granted = await provider.requestOutgoingGrant({
      wallet: walletMetadata(TREASURY),
      limit,
      finishUri: "https://app.example/callback",
      nonce: randomUUID(),
    });
    if (granted.kind !== "granted") {
      throw new Error("the fake provider should grant non-interactively");
    }
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO grants
         (id, wallet_id, status, scopes, limit_value, limit_currency, limit_scale,
          access_token_enc, expires_at, created_at, updated_at)
       VALUES (?, ?, 'GRANTED', '["outgoing-payment"]', ?, ?, ?, ?, NULL, ?, ?)`,
      [
        randomUUID(),
        wallet!.id,
        limit.value,
        limit.currency,
        limit.assetScale,
        secretBox.encrypt(granted.accessToken),
        now,
        now,
      ],
    );
    return granted.accessToken;
  }

  beforeEach(async () => {
    config = testConfig({
      DEMO_WALLET_ASSIGNMENT_ENABLED: "true",
      DEMO_TOPUP_AMOUNT: "5000",
      DEMO_TOPUP_CURRENCY: "COP",
      DEMO_TOPUP_ASSET_SCALE: "0",
      DEMO_TOPUP_MAX_AMOUNT: "10000",
      ENCRYPTION_KEY: generateEncryptionKey(),
    });
    db = await testDb();
    secretBox = new SecretBox(config.ENCRYPTION_KEY);
    provider = new FakePaymentProvider({ nonInteractiveGrant: true, initialOutgoingStatus: "COMPLETED" });
    registerFakeWallets();
    app = buildTestApp();
    clockMs = Date.now();
    processor = new JobProcessor({ db, now: () => new Date(clockMs), retryDelayMs: 1 });
    registerJobHandlers(processor, { config, db, provider, sms: testProvider(config), secretBox });
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it("importa el pool y la reimportación no reinicia asignaciones", async () => {
    const first = await importPool();
    expect(first.statusCode).toBe(200);
    expect(first.json.treasury.created).toBe(true);
    expect(first.json.customers).toMatchObject({ imported: 9, refreshed: 0, total: 9 });
    expect(await countRows("SELECT COUNT(*) AS n FROM demo_wallet_pool")).toBe(10);

    const { statusCode, json } = await registerDemo("3001110001");
    expect(statusCode).toBe(201);
    const walletAddress = json.demo.walletAddress as string;
    const assignmentId = json.demo.assignmentId as string;

    const second = await importPool();
    expect(second.statusCode).toBe(200);
    expect(second.json.treasury.created).toBe(false);
    expect(second.json.customers).toMatchObject({ imported: 0, refreshed: 9, total: 9 });

    // The assignment and its funding state survive a re-import.
    const assignment = await db.get<{ wallet_address: string; funding_status: string; allocation_status: string }>(
      `SELECT a.wallet_address, a.funding_status, p.allocation_status
         FROM demo_assignments a JOIN demo_wallet_pool p ON p.id = a.pool_wallet_id
        WHERE a.id = ?`,
      [assignmentId],
    );
    expect(assignment?.wallet_address).toBe(walletAddress);
    expect(assignment?.allocation_status).toBe("ASSIGNED");
    expect(assignment?.funding_status).toBe("PENDING");
  });

  it("rechaza duplicados, el treasury como cliente y activos incompatibles", async () => {
    const duplicated = await importPool([customerAddresses(9)[0]!, ...customerAddresses(8)]);
    expect(duplicated.statusCode).toBe(400);

    const withTreasury = await importPool([TREASURY, ...customerAddresses(8)]);
    expect(withTreasury.statusCode).toBe(400);

    provider.registerWallet(walletMetadata("https://test.example/usd-wallet", "USD"));
    const incompatible = await importPool(["https://test.example/usd-wallet", ...customerAddresses(8)]);
    expect(incompatible.statusCode).toBe(409);
    expect(incompatible.json.error).toBe("DEMO_WALLET_INCOMPATIBLE");
  });

  it("asigna una wallet y crea exactamente un top-up", async () => {
    expect((await importPool()).statusCode).toBe(200);
    const registration = await registerDemo("3001110002");
    expect(registration.statusCode).toBe(201);
    expect(registration.json.demo.fundingStatus).toBe("PENDING");
    expect(registration.json.demo.authorizationStatus).toBe("PENDING");
    expect(customerAddresses(9)).toContain(registration.json.demo.walletAddress);

    expect(await runJobs()).toBeGreaterThan(0);

    const assignment = await db.get<{ funding_status: string; authorization_status: string; pool_status: string }>(
      `SELECT a.funding_status, a.authorization_status, p.allocation_status AS pool_status
         FROM demo_assignments a JOIN demo_wallet_pool p ON p.id = a.pool_wallet_id
        WHERE a.id = ?`,
      [registration.json.demo.assignmentId],
    );
    expect(assignment?.funding_status).toBe("FUNDED");
    expect(assignment?.authorization_status).toBe("AUTHORIZED");
    expect(assignment?.pool_status).toBe("ASSIGNED");
    expect(await countRows("SELECT COUNT(*) AS n FROM payments WHERE purpose = 'DEMO_TOPUP'")).toBe(1);

    // Running the job again must not create a second transfer.
    expect(await runJobs()).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM payments WHERE purpose = 'DEMO_TOPUP'")).toBe(1);
  });

  it("repetir el registro devuelve la misma asignación sin duplicar fondos", async () => {
    await importPool();
    const first = await registerDemo("3001110003");
    expect(first.statusCode).toBe(201);

    const second = await registerDemo("3001110003");
    expect(second.statusCode).toBe(200);
    expect(second.json.demo.assignmentId).toBe(first.json.demo.assignmentId);
    expect(second.json.demo.walletAddress).toBe(first.json.demo.walletAddress);

    expect(await countRows("SELECT COUNT(*) AS n FROM demo_assignments")).toBe(1);
    expect(await countRows("SELECT COUNT(*) AS n FROM jobs WHERE type = 'demo_topup'")).toBe(1);

    await runJobs();
    expect(await countRows("SELECT COUNT(*) AS n FROM payments WHERE purpose = 'DEMO_TOPUP'")).toBe(1);
  });

  it("agota el pool en el décimo registro", async () => {
    await importPool();
    for (let index = 0; index < 9; index += 1) {
      const res = await registerDemo(`30020000${String(index).padStart(2, "0")}`);
      expect(res.statusCode).toBe(201);
    }
    const exhausted = await registerDemo("3002999999");
    expect(exhausted.statusCode).toBe(503);
    expect(exhausted.json.error).toBe("DEMO_WALLET_POOL_EXHAUSTED");
  });

  it("no reparte la misma wallet bajo registros concurrentes", async () => {
    await importPool();
    const phones = Array.from({ length: 10 }, (_, index) => `30030000${String(index).padStart(2, "0")}`);
    const results = await Promise.all(phones.map((phone) => registerDemo(phone)));

    const created = results.filter((result) => result.statusCode === 201);
    const exhausted = results.filter((result) => result.statusCode === 503);
    expect(created).toHaveLength(9);
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]!.json.error).toBe("DEMO_WALLET_POOL_EXHAUSTED");

    const assigned = created.map((result) => result.json.demo.walletAddress as string);
    expect(new Set(assigned).size).toBe(9);
    expect(await countRows("SELECT COUNT(*) AS n FROM demo_assignments")).toBe(9);
  });

  it("preserva la asignación si el treasury no tiene fondos", async () => {
    await importPool();
    const registration = await registerDemo("3001110004");
    const walletAddress = registration.json.demo.walletAddress as string;

    provider.setInsufficientFunds(TREASURY);
    await runJobs();

    const assignment = await db.get<{ funding_status: string; wallet_address: string; pool_status: string }>(
      `SELECT a.funding_status, a.wallet_address, p.allocation_status AS pool_status
         FROM demo_assignments a JOIN demo_wallet_pool p ON p.id = a.pool_wallet_id
        WHERE a.id = ?`,
      [registration.json.demo.assignmentId],
    );
    expect(assignment?.funding_status).toBe("FAILED");
    expect(assignment?.wallet_address).toBe(walletAddress);
    expect(assignment?.pool_status).toBe("ASSIGNED");
  });

  it("un grant insuficiente exige la acción del operador", async () => {
    await importPool();
    await seedTreasuryGrant(cop("1"));
    const registration = await registerDemo("3001110005");
    await runJobs();

    const assignment = await db.get<{ funding_status: string; authorization_status: string }>(
      "SELECT funding_status, authorization_status FROM demo_assignments WHERE id = ?",
      [registration.json.demo.assignmentId],
    );
    expect(assignment?.funding_status).toBe("OPERATOR_ACTION_REQUIRED");
    expect(assignment?.authorization_status).toBe("REJECTED");
  });

  it("reconcilia un resultado incierto sin reasignar la wallet", async () => {
    await importPool();
    const registration = await registerDemo("3001110006");
    const walletAddress = registration.json.demo.walletAddress as string;

    // The transfer may have been created but the resource read fails: uncertain.
    provider.failNextGetForWallet(TREASURY);
    await runJobs();

    const pending = await db.get<{ funding_status: string; funding_payment_id: string | null; pool_status: string }>(
      `SELECT a.funding_status, a.funding_payment_id, p.allocation_status AS pool_status
         FROM demo_assignments a JOIN demo_wallet_pool p ON p.id = a.pool_wallet_id
        WHERE a.id = ?`,
      [registration.json.demo.assignmentId],
    );
    expect(pending?.funding_status).toBe("RECONCILIATION_REQUIRED");
    expect(pending?.funding_payment_id).toBeTruthy();
    expect(pending?.pool_status).toBe("ASSIGNED");
    expect(await countRows("SELECT COUNT(*) AS n FROM payments WHERE purpose = 'DEMO_TOPUP'")).toBe(1);

    // The resource confirms afterwards; reconciliation settles without resending.
    const outgoing = await db.get<{ outgoing_payment_id: string }>(
      "SELECT outgoing_payment_id FROM payments WHERE id = ?",
      [pending!.funding_payment_id],
    );
    provider.setOutgoingPaymentStatus(outgoing!.outgoing_payment_id, "COMPLETED");
    await runJobs(10_000);

    const settled = await db.get<{ funding_status: string; wallet_address: string }>(
      "SELECT funding_status, wallet_address FROM demo_assignments WHERE id = ?",
      [registration.json.demo.assignmentId],
    );
    expect(settled?.funding_status).toBe("FUNDED");
    expect(settled?.wallet_address).toBe(walletAddress);
    expect(await countRows("SELECT COUNT(*) AS n FROM payments WHERE purpose = 'DEMO_TOPUP'")).toBe(1);
  });

  it("reintenta la reconciliación de un pago aún en proceso sin reenviar", async () => {
    const processingProvider = new FakePaymentProvider({
      nonInteractiveGrant: true,
      initialOutgoingStatus: "PROCESSING",
    });
    processingProvider.registerWallet(walletMetadata(TREASURY), {
      balance: cop("1000000"),
      grantLimit: cop("1000000"),
    });
    for (const address of customerAddresses(9)) {
      processingProvider.registerWallet(walletMetadata(address), { balance: cop("0"), grantLimit: cop("0") });
    }
    const processingApp = buildApp({
      config,
      db,
      provider: testProvider(config),
      paymentProvider: processingProvider,
      secretBox,
      runWorker: false,
    });
    // A large retry delay keeps the bounded retries apart inside the test.
    const processingProcessor = new JobProcessor({ db, now: () => new Date(clockMs), retryDelayMs: 600_000 });
    registerJobHandlers(processingProcessor, {
      config,
      db,
      provider: processingProvider,
      sms: testProvider(config),
      secretBox,
    });
    const drain = async (): Promise<number> => {
      let processed = 0;
      while (await processingProcessor.runOnce()) {
        processed += 1;
      }
      return processed;
    };
    try {
      const imported = await processingApp.inject({
        method: "POST",
        url: "/admin/demo/wallet-pool/import",
        headers: adminHeaders(),
        payload: { treasury: TREASURY, customers: customerAddresses(9) },
      });
      expect(imported.statusCode).toBe(200);
      const res = await processingApp.inject({
        method: "POST",
        url: "/admin/users",
        headers: adminHeaders(),
        payload: { phone: "3001110100", assignDemoWallet: true },
      });
      expect(res.statusCode).toBe(201);
      const assignmentId = res.json().demo.assignmentId as string;

      // First run creates the transfer but the resource never confirms yet.
      clockMs += 1000;
      await drain();
      const inProgress = await db.get<{ funding_status: string; funding_payment_id: string }>(
        "SELECT funding_status, funding_payment_id FROM demo_assignments WHERE id = ?",
        [assignmentId],
      );
      expect(inProgress?.funding_status).toBe("IN_PROGRESS");
      expect(await countRows("SELECT COUNT(*) AS n FROM payments WHERE purpose = 'DEMO_TOPUP'")).toBe(1);

      // The reconciliation read finds the resource still PROCESSING and is
      // requeued for a later read, not resent.
      clockMs += 60_000;
      await drain();
      const reconciling = await db.get<{ funding_status: string }>(
        "SELECT funding_status FROM demo_assignments WHERE id = ?",
        [assignmentId],
      );
      expect(reconciling?.funding_status).toBe("RECONCILIATION_REQUIRED");
      const reconcileJob = await db.get<{ status: string; attempts: number }>(
        "SELECT status, attempts FROM jobs WHERE dedupe_key = ?",
        [`demo-topup:reconcile:${assignmentId}`],
      );
      expect(reconcileJob?.status).toBe("pending");
      expect(reconcileJob?.attempts).toBeGreaterThanOrEqual(1);
      expect(await countRows("SELECT COUNT(*) AS n FROM payments WHERE purpose = 'DEMO_TOPUP'")).toBe(1);

      // The resource confirms afterwards: the same payment settles.
      const outgoing = await db.get<{ outgoing_payment_id: string }>(
        "SELECT outgoing_payment_id FROM payments WHERE id = ?",
        [inProgress!.funding_payment_id],
      );
      processingProvider.setOutgoingPaymentStatus(outgoing!.outgoing_payment_id, "COMPLETED");
      clockMs += 700_000;
      await drain();
      const settled = await db.get<{ funding_status: string }>(
        "SELECT funding_status FROM demo_assignments WHERE id = ?",
        [assignmentId],
      );
      expect(settled?.funding_status).toBe("FUNDED");
      expect(await countRows("SELECT COUNT(*) AS n FROM payments WHERE purpose = 'DEMO_TOPUP'")).toBe(1);
    } finally {
      await processingApp.close();
    }
  });

  it("demo-status nunca expone secretos", async () => {
    await importPool();
    const registration = await registerDemo("3001110007");
    await runJobs();

    const res = await app.inject({
      method: "GET",
      url: `/admin/users/${registration.json.demo.customerId}/demo-status`,
      headers: adminHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.assigned).toBe(true);
    expect(body.assignment.fundingStatus).toBe("FUNDED");
    expect(body.assignment.walletAddress).toBe(registration.json.demo.walletAddress);

    const payload = res.payload;
    expect(payload).not.toContain("access_token");
    expect(payload).not.toContain("continue_token");
    // The plaintext treasury token must not leak either.
    const grant = await db.get<{ access_token_enc: string }>(
      `SELECT g.access_token_enc FROM grants g JOIN wallets w ON w.id = g.wallet_id
        WHERE w.wallet_address = ? AND g.status = 'GRANTED' LIMIT 1`,
      [TREASURY],
    );
    expect(payload).not.toContain(secretBox.decrypt(grant!.access_token_enc));
  });

  it("asigna una wallet demo a un usuario ya creado", async () => {
    await importPool();
    const created = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: adminHeaders(),
      payload: { phone: "3001110008" },
    });
    expect(created.statusCode).toBe(201);

    const demo = await registerDemo("3001110008");
    expect(demo.statusCode).toBe(201);
    expect(demo.json.demo.customerId).toBe(created.json().user.id);
    expect(await countRows("SELECT COUNT(*) AS n FROM users WHERE id <> 'demo-treasury-user'")).toBe(1);
  });

  it("rechaza el modo demo cuando está deshabilitado", async () => {
    const disabledConfig = testConfig({
      DEMO_WALLET_ASSIGNMENT_ENABLED: "false",
      ENCRYPTION_KEY: generateEncryptionKey(),
    });
    const disabledApp = buildApp({
      config: disabledConfig,
      db,
      provider: testProvider(disabledConfig),
      paymentProvider: provider,
      secretBox: new SecretBox(disabledConfig.ENCRYPTION_KEY),
      runWorker: false,
    });
    try {
      const res = await disabledApp.inject({
        method: "POST",
        url: "/admin/users",
        headers: { authorization: `Bearer ${disabledConfig.ADMIN_API_TOKEN}` },
        payload: { phone: "3001110009", assignDemoWallet: true },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("DEMO_ASSIGNMENT_DISABLED");
    } finally {
      await disabledApp.close();
    }
  });
});
