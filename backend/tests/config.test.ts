import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { testDatabaseUrl } from "./helpers";

const base = (overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv =>
  ({
    NODE_ENV: "test",
    DATABASE_URL: testDatabaseUrl(),
    ...overrides,
  }) as NodeJS.ProcessEnv;

describe("config", () => {
  it("aplica valores por defecto válidos", () => {
    const config = loadConfig(base());
    expect(config.PORT).toBe(3000);
    expect(config.PAYMENT_PROVIDER).toBe("fake");
    expect(config.PAYMENT_CURRENCY).toBe("COP");
    expect(config.PAYMENT_ASSET_SCALE).toBe(0);
    expect(config.SMS_PROVIDER).toBe("mock");
  });

  it("rechaza una moneda que no es ISO 4217", () => {
    expect(() => loadConfig(base({ PAYMENT_CURRENCY: "pesos" }))).toThrow();
  });

  it("valida el rango de asset scale", () => {
    expect(() => loadConfig(base({ PAYMENT_ASSET_SCALE: "99" }))).toThrow();
  });
});
