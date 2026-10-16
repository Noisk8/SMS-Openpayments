import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import type { PaymentProvider } from "../payments/types";
import { requireAdmin } from "../security/authentication";
import type { SecretBox } from "../security/encryption";
import { getDemoStatus, importWalletPool } from "./service";

export interface DemoRouteDeps {
  config: AppConfig;
  db: Db;
  provider: PaymentProvider;
  secretBox: SecretBox | null;
}

const importSchema = z.object({
  treasury: z.string().url(),
  customers: z.array(z.string().url()).min(1, "Se requiere al menos una wallet de cliente"),
});

const userIdParams = z.object({ id: z.string().min(1) });

/** Registers the demo wallet pool routes. Payment assignment lives in /admin/users. */
export function registerDemoRoutes(app: FastifyInstance, deps: DemoRouteDeps): void {
  const admin = requireAdmin(deps.config);

  app.post("/admin/demo/wallet-pool/import", { preHandler: admin }, async (request, reply) => {
    const body = importSchema.parse(request.body);
    const result = await importWalletPool(deps, body);
    return reply.send(result);
  });

  app.get("/admin/users/:id/demo-status", { preHandler: admin }, async (request, reply) => {
    const params = userIdParams.parse(request.params);
    return reply.send(await getDemoStatus(deps, params.id));
  });
}
