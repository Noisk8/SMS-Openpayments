import { loadConfig, type AppConfig } from "../src/config";
import { createDatabase, type Db } from "../src/db";
import { MockSmsProvider } from "../src/sms/providers/mock";

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    SMS_WEBHOOK_SECRET: "test-secret",
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export function testDb(): Db {
  return createDatabase(":memory:");
}

export function testProvider(config: AppConfig): MockSmsProvider {
  return new MockSmsProvider(config.SMS_WEBHOOK_SECRET);
}
