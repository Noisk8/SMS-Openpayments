import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import { httpStatusFor, isAppError } from "./errors";
import { registerDevRoutes } from "./dev/routes";
import { registerGrantRoutes } from "./grants/routes";
import { registerOnboardingRoutes } from "./onboarding/routes";
import type { PaymentProvider } from "./payments/types";
import { registerRecipientRoutes } from "./recipients/routes";
import type { SecretBox } from "./security/encryption";
import { registerSmsRoutes } from "./sms/routes";
import type { SmsProvider } from "./sms/types";

export interface AppDeps {
  config: AppConfig;
  db: Db;
  /** SMS gateway provider (mock in local mode). */
  provider: SmsProvider;
  /** Payments provider (fake in local mode, Open Payments in production). */
  paymentProvider: PaymentProvider;
  /** Credential encryption box; null when ENCRYPTION_KEY is not configured. */
  secretBox: SecretBox | null;
}

/** Builds the Fastify app without starting the listener (testable via inject). */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.config.NODE_ENV !== "test" });

  app.get("/health", async () => {
    deps.db.prepare("SELECT 1").get();
    return {
      status: "ok",
      smsProvider: deps.provider.name,
      paymentProvider: deps.paymentProvider.name,
      time: new Date().toISOString(),
    };
  });

  registerSmsRoutes(app, { config: deps.config, db: deps.db, provider: deps.provider });

  const paymentsDeps = {
    config: deps.config,
    db: deps.db,
    provider: deps.paymentProvider,
    secretBox: deps.secretBox,
  };
  registerOnboardingRoutes(app, paymentsDeps);
  registerRecipientRoutes(app, paymentsDeps);
  registerGrantRoutes(app, paymentsDeps);

  if (deps.config.NODE_ENV !== "production") {
    registerDevRoutes(app, { config: deps.config, paymentProvider: deps.paymentProvider });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "VALIDATION_FAILED", issues: error.issues });
    }
    if (isAppError(error)) {
      return reply.code(httpStatusFor(error.code)).send({ error: error.code, message: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "INTERNAL", message: "Internal error." });
  });

  return app;
}
