import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../security/authentication";
import { reconcileTransfer, fundTestAccount, type ManagedDeps } from "./service";
import { verifyRafikiSignature, type RafikiEvent } from "./webhook";

export function registerManagedRoutes(app: FastifyInstance, deps: ManagedDeps) {
  // Rafiki webhook. The signature is verified first; events are still only hints. Funds are
  // reconciled by querying the private Admin API (reconcileTransfer), never from the payload.
  app.post("/webhooks/rafiki", async (request, reply) => {
    const event: RafikiEvent = z.object({ id: z.string().min(1), type: z.string().min(1), data: z.record(z.string(), z.unknown()) }).parse(request.body);
    const header = request.headers["rafiki-signature"];
    if (!verifyRafikiSignature(event, typeof header === "string" ? header : undefined, deps.config.RAFIKI_WEBHOOK_SECRET)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    const outgoingId = event.type.startsWith("outgoing_payment.") && typeof event.data.id === "string" ? event.data.id : undefined;
    const transfer = outgoingId
      ? ((await deps.db.get("SELECT id FROM managed_transfers WHERE outgoing_id = ?", [outgoingId])) as { id: string } | undefined)
      : undefined;
    if (transfer) {
      try {
        await reconcileTransfer(deps, transfer.id);
      } catch {
        // Non-200 makes Rafiki retry the event later; the periodic reconciler also covers it.
        return reply.code(500).send({ error: "RECONCILE_FAILED" });
      }
    }
    // Unknown events and transfers not yet linked are acknowledged; the reconciler handles them.
    return reply.code(200).send({ received: true });
  });
  app.get("/internal/rafiki/rates", async () => ({ base: "COP", rates: { COP: 1 } }));
  app.post("/admin/test/accounts/fund", { preHandler: requireAdmin(deps.config) }, async (request) => {
    const body = z.object({ phone: z.string(), amount: z.number().int().positive().max(1_000_000_000), idempotencyKey: z.string().min(1).max(100) }).parse(request.body);
    (await fundTestAccount(deps, body.phone, body.amount, body.idempotencyKey));
    return { ok: true, currency: "COP", testFunds: true };
  });
}
