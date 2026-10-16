import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Amount } from "../domain";
import type { PaymentProvider, WalletMetadata } from "../payments/types";

export interface DevRouteDeps {
  config: AppConfig;
  paymentProvider: PaymentProvider;
}

/** Duck-typed capability of the in-memory fake provider. */
interface RegisterableProvider {
  registerWallet(metadata: WalletMetadata, options?: { balance?: Amount }): unknown;
}

const registerWalletSchema = z.object({
  walletAddress: z.string().url(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  assetScale: z.number().int().min(0).max(12).optional(),
  balance: z.string().regex(/^\d+$/).optional(),
});

/**
 * Development-only helpers. Never mounted in production.
 * They let you exercise onboarding and payments locally with the fake provider.
 */
export function registerDevRoutes(app: FastifyInstance, deps: DevRouteDeps): void {
  const provider = deps.paymentProvider as unknown as Partial<RegisterableProvider>;
  if (typeof provider.registerWallet !== "function") {
    return;
  }

  app.post("/dev/payments/register-wallet", async (request, reply) => {
    const body = registerWalletSchema.parse(request.body);
    const currency = body.currency ?? deps.config.PAYMENT_CURRENCY;
    const assetScale = body.assetScale ?? deps.config.PAYMENT_ASSET_SCALE;
    provider.registerWallet!(
      {
        walletAddress: body.walletAddress,
        currency,
        assetScale,
        authServer: `${body.walletAddress}/auth`,
        resourceServer: `${body.walletAddress}/rs`,
      },
      body.balance ? { balance: { value: body.balance, currency, assetScale } } : {},
    );
    return reply.send({ ok: true, walletAddress: body.walletAddress, currency, assetScale });
  });

  app.get("/dev/payments/payments", async (_request, reply) => {
    return reply.send({ provider: deps.paymentProvider.name });
  });
}
