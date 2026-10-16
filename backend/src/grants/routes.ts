import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import type { PaymentProvider } from "../payments/types";
import { requireAdmin } from "../security/authentication";
import type { SecretBox } from "../security/encryption";
import { cancelGrant, getGrantUsage, revokeGrantToken, rotateGrantToken } from "./service";

export interface GrantRouteDeps {
  config: AppConfig;
  db: Db;
  provider: PaymentProvider;
  secretBox: SecretBox | null;
}

const grantParams = z.object({ id: z.string().min(1) });

/** Registers grant lifecycle routes (spec §7, §13). */
export function registerGrantRoutes(app: FastifyInstance, deps: GrantRouteDeps): void {
  const admin = requireAdmin(deps.config);

  app.get("/admin/grants/:id/usage", { preHandler: admin }, async (request, reply) => {
    const params = grantParams.parse(request.params);
    const usage = await getGrantUsage(deps, params.id);
    return reply.send({ grantId: params.id, ...usage });
  });

  app.post("/admin/grants/:id/cancel", { preHandler: admin }, async (request, reply) => {
    const params = grantParams.parse(request.params);
    const grant = await cancelGrant(deps, params.id);
    return reply.send({ grantId: grant.id, status: grant.status });
  });

  app.post("/admin/grants/:id/token/rotate", { preHandler: admin }, async (request, reply) => {
    const params = grantParams.parse(request.params);
    const result = await rotateGrantToken(deps, params.id);
    return reply.send({ grantId: params.id, ...result });
  });

  app.post("/admin/grants/:id/token/revoke", { preHandler: admin }, async (request, reply) => {
    const params = grantParams.parse(request.params);
    const grant = await revokeGrantToken(deps, params.id);
    return reply.send({ grantId: grant.id, status: grant.status });
  });
}
