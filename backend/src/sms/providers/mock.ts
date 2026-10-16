import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../errors";
import { nowIso } from "../../util/time";
import type { InboundSms, SendMessageInput, SendResult, SmsProvider, WebhookRequest } from "../types";

const inboundPayload = z.object({
  messageId: z.string().min(1).optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  text: z.string().default(""),
  receivedAt: z.string().optional(),
});

export interface OutboxEntry {
  to: string;
  from: string;
  text: string;
  at: string;
  paymentId?: string;
}

/**
 * Proveedor SMS local: no habla con nadie. Guarda los envíos en memoria y
 * valida el webhook con un secreto compartido. Sirve para desarrollo y pruebas.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  readonly outbox: OutboxEntry[] = [];

  constructor(private readonly webhookSecret: string) {}

  validateWebhook(request: WebhookRequest): boolean {
    const header = request.headers["x-webhook-secret"];
    const value = Array.isArray(header) ? header[0] : header;
    return value === this.webhookSecret;
  }

  parseIncoming(request: WebhookRequest): InboundSms {
    const parsed = inboundPayload.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "Payload de SMS inválido.", {
        issues: parsed.error.issues,
      });
    }
    const body = parsed.data;
    return {
      provider: this.name,
      messageId: body.messageId ?? randomUUID(),
      from: body.from,
      to: body.to,
      text: body.text,
      receivedAt: body.receivedAt ?? nowIso(),
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendResult> {
    this.outbox.push({
      to: input.to,
      from: input.from,
      text: input.text,
      at: nowIso(),
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
    });
    return { status: "sent", providerMessageId: `mock-${randomUUID()}` };
  }

  acknowledge(): unknown {
    return { status: "ok" };
  }
}
