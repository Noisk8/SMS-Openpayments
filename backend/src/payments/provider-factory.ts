import type { AppConfig } from "../config";
import { AppError } from "../errors";
import { FakePaymentProvider } from "./fake";
import { OpenPaymentsProvider } from "./open-payments";
import type { PaymentProvider } from "./types";

/**
 * Builds the payments provider from configuration.
 * - `fake`: deterministic in-memory provider for local development and tests.
 * - `openpayments`: real provider over `@interledger/open-payments`.
 */
export function createPaymentProvider(config: AppConfig): PaymentProvider {
  const currency = config.PAYMENT_CURRENCY;
  const assetScale = config.PAYMENT_ASSET_SCALE;

  switch (config.PAYMENT_PROVIDER) {
    case "fake":
      // Local mode: grants are granted immediately so onboarding + payments work
      // without an interactive wallet callback. Interactive flows are covered by tests.
      return new FakePaymentProvider({
        defaultWalletBalance: { value: "1000000", currency, assetScale },
        defaultGrantLimit: { value: "1000000", currency, assetScale },
        nonInteractiveGrant: true,
      });
    case "openpayments":
      return OpenPaymentsProvider.fromConfig(config);
    default: {
      const exhaustive: never = config.PAYMENT_PROVIDER;
      throw new AppError("INTERNAL", `Unsupported payment provider: ${String(exhaustive)}`);
    }
  }
}
