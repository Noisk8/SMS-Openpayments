import { loadConfig, type AppConfig } from "../src/config";
import { createDatabase, type Db } from "../src/db";
import { FakePaymentProvider } from "../src/payments/fake";
import { MockSmsProvider } from "../src/sms/providers/mock";

/** Domain tables truncated between tests (schema_migrations is preserved). */
const DOMAIN_TABLES = [
  "managed_entries",
  "managed_journals",
  "managed_transfers",
  "managed_accounts",
  "demo_assignments",
  "demo_wallet_pool",
  "users",
  "wallets",
  "recipients",
  "grants",
  "payments",
  "sms_messages",
  "jobs",
  "audit_events",
  "phone_verifications",
];

/** Base URL exposed by the Vitest global setup (or a CI-provided override). */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set; the Vitest global setup did not run.");
  }
  return url;
}

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: testDatabaseUrl(),
    SMS_WEBHOOK_SECRET: "test-secret",
    ...overrides,
  } as NodeJS.ProcessEnv);
}

/**
 * Opens a connection to the shared test database and truncates every domain
 * table so each test starts from a clean, order-independent state.
 */
export async function testDb(): Promise<Db> {
  const db = await createDatabase(testDatabaseUrl());
  await db.run(`TRUNCATE TABLE ${DOMAIN_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  return db;
}

export function testProvider(config: AppConfig): MockSmsProvider {
  return new MockSmsProvider(config.SMS_WEBHOOK_SECRET);
}

export function testPaymentProvider(): FakePaymentProvider {
  return new FakePaymentProvider();
}
