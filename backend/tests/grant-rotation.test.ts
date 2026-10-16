import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config";
import type { Db } from "../src/db";
import type { Amount } from "../src/domain";
import { AppError } from "../src/errors";
import { rotateGrantToken } from "../src/grants/service";
import { registerJobHandlers } from "../src/jobs/handlers";
import { JobProcessor } from "../src/jobs/processor";
import { connectWallet, type OnboardingDeps } from "../src/onboarding/service";
import { FakePaymentProvider } from "../src/payments/fake";
import { requestOutgoingAccess } from "../src/payments/service";
import type { WalletMetadata } from "../src/payments/types";
import { SecretBox, generateEncryptionKey } from "../src/security/encryption";
import { testConfig, testDb, testProvider } from "./helpers";

const wallet: WalletMetadata = {
  walletAddress: "https://wallet.example/alice",
  currency: "COP",
  assetScale: 0,
  authServer: "https://auth.wallet.example",
  resourceServer: "https://rs.wallet.example",
};

const cop = (value: string): Amount => ({ value, currency: "COP", assetScale: 0 });
const INTERVAL = "R1/2026-10-16T00:00:00Z/P1Y";

interface GrantRowLike {
  id: string;
  status: string;
  access_token_enc: string | null;
  access_token_manage_uri: string | null;
  expires_at: string | null;
  requires_reconsent: number;
  last_rotation_error: string | null;
  rotation_lock_until: string | null;
}

interface JobRowLike {
  status: string;
  payload: string;
  next_run_at: string;
}

describe("grant token rotation", () => {
  let config: AppConfig;
  let db: Db;
  let provider: FakePaymentProvider;
  let secretBox: SecretBox;
  let deps: OnboardingDeps;
  let nowMs: number;

  async function seedUser(): Promise<void> {
    await db.run(
      `INSERT INTO users (id, phone, phone_verified_at, status) VALUES ('u1', '+573001112233', ?, 'active')`,
      [new Date().toISOString()],
    );
  }

  async function connectGrant(): Promise<string> {
    const result = await connectWallet(deps, "u1", {
      walletAddress: wallet.walletAddress,
      limit: cop("100000"),
    });
    expect(result.grant.status).toBe("GRANTED");
    return result.grant.id;
  }

  async function grantRow(id: string): Promise<GrantRowLike> {
    const row = await db.get<GrantRowLike>(`SELECT * FROM grants WHERE id = ?`, [id]);
    if (!row) {
      throw new Error(`grant ${id} not found`);
    }
    return row;
  }

  function rotationJobs(): Promise<JobRowLike[]> {
    return db.all<JobRowLike>(
      `SELECT status, payload, next_run_at FROM jobs WHERE type = 'rotate_grant_token'
        ORDER BY created_at ASC, seq ASC`,
    );
  }

  beforeEach(async () => {
    nowMs = Date.now();
    config = testConfig();
    db = await testDb();
    provider = new FakePaymentProvider({
      nonInteractiveGrant: true,
      accessTokenTtlMs: 600_000,
      now: () => new Date(nowMs),
    });
    provider.registerWallet(wallet, { balance: cop("1000000"), grantLimit: cop("1000000") });
    secretBox = new SecretBox(generateEncryptionKey());
    deps = { config, db, provider, secretBox };
    await seedUser();
  });

  afterEach(async () => {
    await db.close();
  });

  it("stores the token manage URI and expiry, and schedules the first rotation", async () => {
    const grantId = await connectGrant();
    const row = await grantRow(grantId);

    expect(row.status).toBe("GRANTED");
    expect(row.access_token_manage_uri).toBeTruthy();
    expect(row.expires_at).toBeTruthy();
    expect(row.requires_reconsent).toBe(0);
    expect(secretBox.decrypt(row.access_token_enc as string)).toBeTruthy();
    expect(provider.accessTokenManageUri(secretBox.decrypt(row.access_token_enc as string))).toBe(
      row.access_token_manage_uri,
    );

    const jobs = await rotationJobs();
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0]?.payload as string).grantId).toBe(grantId);
    expect(JSON.parse(jobs[0]?.payload as string).expectedExpiresAt).toBe(row.expires_at);
    // Scheduled shortly before expiry (T-120s).
    expect(Date.parse(jobs[0]?.next_run_at as string)).toBeLessThan(Date.parse(row.expires_at as string));
  });

  it("rotates the token through the job handler and reschedules the next rotation", async () => {
    const grantId = await connectGrant();
    const before = await grantRow(grantId);
    const oldToken = secretBox.decrypt(before.access_token_enc as string);

    // Move the clock to when the rotation job becomes due, then run it.
    const initial = (await rotationJobs())[0];
    nowMs = Date.parse(initial?.next_run_at as string) + 1000;

    const processor = new JobProcessor({ db, now: () => new Date(nowMs) });
    registerJobHandlers(processor, { config, db, provider, sms: testProvider(config), secretBox });
    expect(await processor.runOnce()).toBe(true);

    const after = await grantRow(grantId);
    const newToken = secretBox.decrypt(after.access_token_enc as string);
    expect(newToken).not.toBe(oldToken);
    expect(after.access_token_manage_uri).not.toBe(before.access_token_manage_uri);
    expect(after.access_token_manage_uri).toBe(provider.accessTokenManageUri(newToken));
    expect(after.expires_at).not.toBe(before.expires_at);
    expect(after.requires_reconsent).toBe(0);

    const jobs = await rotationJobs();
    expect(jobs).toHaveLength(2);
    const next = jobs.find((job) => job.status === "pending");
    expect(next).toBeTruthy();
    expect(JSON.parse(next?.payload as string).grantId).toBe(grantId);
    expect(JSON.parse(next?.payload as string).expectedExpiresAt).toBe(after.expires_at);
  });

  it("requires new consent when the token already expired (no silent failure, no reschedule)", async () => {
    const grantId = await connectGrant();
    // Force the stored expiry into the past: rotation is no longer possible.
    await db.run(`UPDATE grants SET expires_at = ? WHERE id = ?`, [
      new Date(Date.now() - 1000).toISOString(),
      grantId,
    ]);

    const result = await rotateGrantToken({ config, db, provider, secretBox }, grantId);
    expect(result.rotated).toBe(false);
    expect(result.requiresReconsent).toBe(true);
    expect(result.reason).toBe("token_expired");

    const row = await grantRow(grantId);
    expect(row.requires_reconsent).toBe(1);
    expect(row.last_rotation_error).toBeTruthy();
    // The token is untouched and no further rotation was scheduled.
    expect(secretBox.decrypt(row.access_token_enc as string)).toBeTruthy();
    expect(await rotationJobs()).toHaveLength(1);
  });

  it("requires new consent when the provider rejects the rotation", async () => {
    const grantId = await connectGrant();
    const row = await grantRow(grantId);
    provider.expireAccessToken(secretBox.decrypt(row.access_token_enc as string));

    const result = await rotateGrantToken({ config, db, provider, secretBox }, grantId);
    expect(result.rotated).toBe(false);
    expect(result.requiresReconsent).toBe(true);
    expect(result.reason).toBe("rotation_rejected");
    expect((await grantRow(grantId)).requires_reconsent).toBe(1);
    expect(await rotationJobs()).toHaveLength(1);
  });

  it("treats an authorization error as requiring new consent", async () => {
    const grantId = await connectGrant();
    provider.failNextRotation(new AppError("UNAUTHORIZED", "access token no válido"));

    const result = await rotateGrantToken({ config, db, provider, secretBox }, grantId);
    expect(result.rotated).toBe(false);
    expect(result.requiresReconsent).toBe(true);
    expect(result.reason).toBe("rotation_unauthorized");
    expect((await grantRow(grantId)).requires_reconsent).toBe(1);
  });

  it("does not require consent on a transient failure and retries successfully", async () => {
    const grantId = await connectGrant();
    provider.failNextRotation(new AppError("PROVIDER_ERROR", "timeout simulado"));

    await expect(rotateGrantToken({ config, db, provider, secretBox }, grantId)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    const afterFail = await grantRow(grantId);
    expect(afterFail.requires_reconsent).toBe(0);
    expect(afterFail.rotation_lock_until).toBeNull();

    const retry = await rotateGrantToken({ config, db, provider, secretBox }, grantId);
    expect(retry.rotated).toBe(true);
    expect((await grantRow(grantId)).requires_reconsent).toBe(0);
  });

  it("does not rotate while another rotation holds the lock", async () => {
    const grantId = await connectGrant();
    const before = await grantRow(grantId);
    await db.run(`UPDATE grants SET rotation_lock_until = ? WHERE id = ?`, [
      new Date(Date.now() + 30_000).toISOString(),
      grantId,
    ]);

    const result = await rotateGrantToken({ config, db, provider, secretBox }, grantId);
    expect(result.rotated).toBe(false);
    expect(result.reason).toBe("rotation_in_progress");
    expect((await grantRow(grantId)).access_token_enc).toBe(before.access_token_enc);
  });

  it("never runs two rotations for the same grant at the same time", async () => {
    provider = new FakePaymentProvider({
      nonInteractiveGrant: true,
      accessTokenTtlMs: 600_000,
      rotationDelayMs: 60,
    });
    provider.registerWallet(wallet, { balance: cop("1000000"), grantLimit: cop("1000000") });
    deps = { config, db, provider, secretBox };
    const grantId = await connectGrant();

    const [a, b] = await Promise.all([
      rotateGrantToken(deps, grantId),
      rotateGrantToken(deps, grantId),
    ]);
    expect([a, b].filter((result) => result.rotated)).toHaveLength(1);
    expect([a, b].find((result) => !result.rotated)?.reason).toBe("rotation_in_progress");
  });

  it("includes the configured limits.interval in the outgoing grant request", async () => {
    const withInterval = testConfig({ OP_GRANT_INTERVAL: INTERVAL });
    await requestOutgoingAccess(
      { db, provider, config: withInterval },
      { wallet, limit: cop("5000"), finishUri: "https://app.example/cb", nonce: "n1" },
    );
    expect(provider.lastOutgoingGrantRequest()?.interval).toBe(INTERVAL);
  });

  it("omits limits.interval when it is not configured", async () => {
    await requestOutgoingAccess(
      { db, provider, config },
      { wallet, limit: cop("5000"), finishUri: "https://app.example/cb", nonce: "n2" },
    );
    expect(provider.lastOutgoingGrantRequest()?.interval).toBeUndefined();
  });

  it("applies the configured interval when connecting a wallet", async () => {
    const withInterval = testConfig({ OP_GRANT_INTERVAL: INTERVAL });
    await connectWallet(
      { config: withInterval, db, provider, secretBox },
      "u1",
      { walletAddress: wallet.walletAddress, limit: cop("100000") },
    );
    expect(provider.lastOutgoingGrantRequest()?.interval).toBe(INTERVAL);
  });
});
