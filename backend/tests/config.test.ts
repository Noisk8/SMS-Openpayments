import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("config", () => {
  it("aplica valores por defecto válidos", () => {
    const config = loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(config.PORT).toBe(3000);
    expect(config.PAYMENT_PROVIDER).toBe("fake");
    expect(config.PAYMENT_CURRENCY).toBe("COP");
    expect(config.PAYMENT_ASSET_SCALE).toBe(0);
    expect(config.SMS_PROVIDER).toBe("mock");
  });

  it("rechaza una moneda que no es ISO 4217", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "test", PAYMENT_CURRENCY: "pesos" } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it("valida el rango de asset scale", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "test", PAYMENT_ASSET_SCALE: "99" } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});
