import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import { httpStatusFor, isAppError } from "./errors";
import { registerSmsRoutes } from "./sms/routes";
import type { SmsProvider } from "./sms/types";

export interface AppDeps {
  config: AppConfig;
  db: Db;
  provider: SmsProvider;
}

/** Construye la app Fastify sin arrancar el listener (útil para pruebas con inject). */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.config.NODE_ENV !== "test" });

  app.get("/health", async () => {
    deps.db.prepare("SELECT 1").get();
    return {
      status: "ok",
      smsProvider: deps.provider.name,
      paymentProvider: deps.config.PAYMENT_PROVIDER,
      time: new Date().toISOString(),
    };
  });

  registerSmsRoutes(app, deps);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "VALIDATION_FAILED", issues: error.issues });
    }
    if (isAppError(error)) {
      return reply.code(httpStatusFor(error.code)).send({ error: error.code, message: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "INTERNAL", message: "Error interno." });
  });

  return app;
}
