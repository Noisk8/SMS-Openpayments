import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { AppError } from "../errors";
import type { PaymentProvider } from "../payments/types";
import { requireAdmin } from "../security/authentication";
import type { SecretBox } from "../security/encryption";
import { createRecipient, getRecipientByAlias, listRecipients } from "./service";

export interface RecipientRouteDeps {
  config: AppConfig;
  db: Db;
  provider: PaymentProvider;
  secretBox: SecretBox | null;
}

const userIdParams = z.object({ id: z.string().min(1) });
const aliasParams = z.object({ id: z.string().min(1), alias: z.string().min(1) });

const createRecipientSchema = z
  .object({
    alias: z.string().min(1).max(64),
    walletAddress: z.string().url().optional(),
    phone: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.walletAddress) !== Boolean(value.phone), {
    message: "Indica exactamente uno de walletAddress o phone.",
  });

/** Registers recipient management routes (spec §8, §13). */
export function registerRecipientRoutes(app: FastifyInstance, deps: RecipientRouteDeps): void {
  const admin = requireAdmin(deps.config);

  app.post("/admin/users/:id/recipients", { preHandler: admin }, async (request, reply) => {
    const params = userIdParams.parse(request.params);
    const body = createRecipientSchema.parse(request.body);
    const recipient = await createRecipient(deps, {
      userId: params.id,
      alias: body.alias,
      ...(body.walletAddress ? { walletAddress: body.walletAddress } : {}),
      ...(body.phone ? { phone: body.phone } : {}),
    });
    return reply.code(201).send({ recipient });
  });

  app.get("/admin/users/:id/recipients", { preHandler: admin }, async (request, reply) => {
    const params = userIdParams.parse(request.params);
    return reply.send({ recipients: await listRecipients(deps.db, params.id) });
  });

  // Resolves an existing alias to its stored (already resolved) wallet.
  app.get("/admin/users/:id/recipients/:alias/resolve", { preHandler: admin }, async (request, reply) => {
    const params = aliasParams.parse(request.params);
    const recipient = await getRecipientByAlias(deps.db, params.id, params.alias);
    if (!recipient) {
      throw new AppError("NOT_FOUND", "No existe un destinatario con ese alias.");
    }
    return reply.send({ recipient });
  });
}
