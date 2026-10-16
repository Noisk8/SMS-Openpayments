import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import type { PaymentProvider } from "../payments/types";
import { requireAdmin } from "../security/authentication";
import type { SecretBox } from "../security/encryption";
import {
  completeGrantCallback,
  connectWallet,
  createUser,
  requestPhoneVerification,
  verifyPhone,
} from "./service";

export interface OnboardingRouteDeps {
  config: AppConfig;
  db: Db;
  provider: PaymentProvider;
  secretBox: SecretBox | null;
}

const userIdParams = z.object({ id: z.string().min(1) });

const createUserSchema = z.object({ phone: z.string().min(1) });

const verifyPhoneSchema = z.object({ code: z.string().min(4).max(10) });

const amountSchema = z.object({
  value: z.string().regex(/^\d+$/, "El importe debe ser un entero en unidades mínimas"),
  currency: z.string().regex(/^[A-Z]{3}$/),
  assetScale: z.number().int().min(0).max(12),
});

const connectWalletSchema = z.object({
  walletAddress: z.string().url(),
  limit: amountSchema.optional(),
});

const callbackSchema = z.object({
  grant_id: z.string().min(1),
  interact_ref: z.string().min(1),
});

/** Registers the assisted onboarding routes (spec §6, §13). */
export function registerOnboardingRoutes(app: FastifyInstance, deps: OnboardingRouteDeps): void {
  const admin = requireAdmin(deps.config);

  app.post("/admin/users", { preHandler: admin }, async (request, reply) => {
    const body = createUserSchema.parse(request.body);
    const user = createUser(deps, body);
    return reply.code(201).send({ user });
  });

  app.post("/admin/users/:id/phone/request-code", { preHandler: admin }, async (request, reply) => {
    const params = userIdParams.parse(request.params);
    const result = requestPhoneVerification(deps, params.id);
    // The code is never logged. Outside production it is returned as a dev/test peek.
    if (deps.config.NODE_ENV === "production") {
      return reply.send({ ok: true, expiresAt: result.expiresAt });
    }
    return reply.send({ ok: true, expiresAt: result.expiresAt, devCode: result.code });
  });

  app.post("/admin/users/:id/phone/verify", { preHandler: admin }, async (request, reply) => {
    const params = userIdParams.parse(request.params);
    const body = verifyPhoneSchema.parse(request.body);
    const user = verifyPhone(deps, params.id, body.code);
    return reply.send({ ok: true, status: user.status });
  });

  app.post("/admin/users/:id/wallets/connect", { preHandler: admin }, async (request, reply) => {
    const params = userIdParams.parse(request.params);
    const body = connectWalletSchema.parse(request.body);
    const result = await connectWallet(deps, params.id, body);
    return reply.send(result);
  });

  // Public callback: validates the stored interaction, not admin credentials (spec §13).
  app.get("/auth/callback", async (request, reply) => {
    const query = callbackSchema.parse(request.query);
    const grant = await completeGrantCallback(deps, {
      grantId: query.grant_id,
      interactRef: query.interact_ref,
    });
    return reply.send({ ok: true, grantId: grant.id, status: grant.status });
  });
}
