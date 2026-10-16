import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { isAppError } from "../errors";
import { nowIso } from "../util/time";
import { handleInboundCommand } from "./commands";
import { getInboundSms, receiveInbound, sendOutboundSms } from "./service";
import type { SmsProvider, WebhookRequest } from "./types";

export interface SmsRouteDeps {
  config: AppConfig;
  db: Db;
  provider: SmsProvider;
}

const simulateSchema = z.object({
  from: z.string().min(1),
  text: z.string().min(1),
  to: z.string().min(1).optional(),
});

export function registerSmsRoutes(app: FastifyInstance, deps: SmsRouteDeps): void {
  app.post("/webhooks/sms", async (request, reply) => {
    const webhookRequest: WebhookRequest = {
      headers: request.headers,
      body: request.body,
      rawBody: (request as { rawBody?: string }).rawBody,
    };
    try {
      await receiveInbound(deps.db, deps.provider, webhookRequest);
      // A duplicate is acknowledged without repeating business effects (spec §5).
      const acknowledgment = deps.provider.acknowledge();
      return reply.code(200).send(acknowledgment);
    } catch (error) {
      if (isAppError(error) && error.code === "UNAUTHORIZED") {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }
      if (isAppError(error) && error.code === "VALIDATION_FAILED") {
        return reply.code(400).send({ error: "VALIDATION_FAILED" });
      }
      // Si la persistencia falla, devolvemos 500 para que el proveedor reintente.
      throw error;
    }
  });

  if (deps.config.NODE_ENV === "production") {
    return;
  }

  // --- Solo desarrollo/pruebas: simulador de SMS -----------------------------

  app.post("/dev/sms/simulate", async (request, reply) => {
    const body = simulateSchema.parse(request.body);
    const webhookRequest: WebhookRequest = {
      headers: { "x-webhook-secret": deps.config.SMS_WEBHOOK_SECRET },
      body: {
        messageId: `sim-${randomUUID()}`,
        from: body.from,
        to: body.to ?? deps.config.SMS_FROM,
        text: body.text,
        receivedAt: nowIso(),
      },
    };
    const received = await receiveInbound(deps.db, deps.provider, webhookRequest);
    if (received.duplicate) {
      return reply.send({ ok: true, duplicate: true });
    }


    const inbound = await getInboundSms(deps.db, received.messageRowId);
    let reply_text: string | undefined;
    if (inbound) {
      const outcome = handleInboundCommand({ db: deps.db, config: deps.config, provider: deps.provider }, inbound);
      reply_text = outcome.reply;
      await sendOutboundSms(deps.db, deps.provider, {
        to: inbound.from,
        from: inbound.to,
        text: outcome.reply,
      });
    }
    return reply.send({ ok: true, duplicate: false, reply: reply_text });
  });

  app.get("/dev/sms/outbox", async (_request, reply) => {
    const provider = deps.provider as SmsProvider & { outbox?: unknown[] };
    return reply.send({ messages: provider.outbox ?? [] });
  });

  app.get("/dev/sms/messages", async (_request, reply) => {
    const messages = await deps.db.all(
      `SELECT id, provider, direction, from_phone AS "from", to_phone AS "to", text, status, created_at
         FROM sms_messages ORDER BY created_at DESC, seq DESC LIMIT 50`,
    );
    return reply.send({ messages });
  });
}
