import { describe, expect, it } from "vitest";
import { OpenPaymentsProvider } from "../src/payments/open-payments";
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

  it("valida la configuración del top-up demo cuando está habilitado", () => {
    const valid = loadConfig(
      base({
        DEMO_WALLET_ASSIGNMENT_ENABLED: "true",
        DEMO_TOPUP_AMOUNT: "5000",
        DEMO_TOPUP_MAX_AMOUNT: "10000",
      }),
    );
    expect(valid.DEMO_TOPUP_AMOUNT).toBe("5000");
    expect(valid.DEMO_TOPUP_CURRENCY).toBe("COP");
    expect(valid.DEMO_TOPUP_ASSET_SCALE).toBe(0);

    // The automatic top-up cannot exceed the configured ceiling.
    expect(() =>
      loadConfig(base({ DEMO_WALLET_ASSIGNMENT_ENABLED: "true", DEMO_TOPUP_AMOUNT: "20000", DEMO_TOPUP_MAX_AMOUNT: "10000" })),
    ).toThrow();

    // Zero funding is not a valid automatic top-up.
    expect(() =>
      loadConfig(base({ DEMO_WALLET_ASSIGNMENT_ENABLED: "true", DEMO_TOPUP_AMOUNT: "0" })),
    ).toThrow();
  });

  it("acepta un intervalo de grant válido y rechaza uno malformado", () => {
    const unset = loadConfig(base());
    expect(unset.OP_GRANT_INTERVAL).toBe("");

    const valid = loadConfig(base({ OP_GRANT_INTERVAL: "R1/2026-10-16T00:00:00Z/P1Y" }));
    expect(valid.OP_GRANT_INTERVAL).toBe("R1/2026-10-16T00:00:00Z/P1Y");

    expect(() => loadConfig(base({ OP_GRANT_INTERVAL: "cada mes" }))).toThrow();
  });
  it("rechaza proveedores retirados", () => {
    expect(() => loadConfig(base({ PAYMENT_PROVIDER: "rafiki" }))).toThrow();
    expect(() => loadConfig(base({ SMS_PROVIDER: "twilio" }))).toThrow();
  });

  it("permite iniciar el login sin leer la clave del proveedor y falla al intentar usar una clave ausente", async () => {
    const config = loadConfig(base({ PAYMENT_PROVIDER: "openpayments", OP_CLIENT_WALLET_ADDRESS: "https://wallet.example/client", OP_KEY_ID: "test-key", OP_PRIVATE_KEY_PATH: "/missing-chasky-test-key.pem" }));
    const provider = OpenPaymentsProvider.fromConfig(config);
    expect(provider.name).toBe("openpayments");
    await expect(provider.getWalletMetadata("https://wallet.example/user")).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

});
