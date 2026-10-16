import twilio from "twilio";
import { z } from "zod";
import type { AppConfig } from "../../config";
import { AppError } from "../../errors";
import { nowIso } from "../../util/time";
import type { InboundSms, SendMessageInput, SendResult, SmsProvider, WebhookRequest } from "../types";

const payloadSchema = z.object({
  MessageSid: z.string().min(1),
  AccountSid: z.string().min(1),
  From: z.string().min(1),
  To: z.string().min(1),
  Body: z.string(),
});

/**
 * Proveedor SMS real sobre Twilio. Valida cada webhook con la firma X-Twilio-Signature
 * (requiere TWILIO_WEBHOOK_URL exactamente igual a la URL configurada en Twilio).
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";

  constructor(private readonly config: AppConfig) {}

  validateWebhook(request: WebhookRequest): boolean {
    const signature = request.headers["x-twilio-signature"];
    const fields = z.record(z.string(), z.string()).safeParse(request.body);
    if (typeof signature !== "string" || !fields.success) return false;
    if (fields.data.AccountSid !== this.config.TWILIO_ACCOUNT_SID) return false;
    return twilio.validateRequest(
      this.config.TWILIO_AUTH_TOKEN,
      signature,
      this.config.TWILIO_WEBHOOK_URL,
      fields.data,
    );
  }

  parseIncoming(request: WebhookRequest): InboundSms {
    const result = payloadSchema.safeParse(request.body);
    if (!result.success) {
      throw new AppError("VALIDATION_FAILED", "Payload de Twilio inválido.");
    }
    const body = result.data;
    return {
      provider: this.name,
      messageId: body.MessageSid,
      from: body.From,
      to: body.To,
      text: body.Body,
      receivedAt: nowIso(),
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendResult> {
    try {
      const client = twilio(this.config.TWILIO_ACCOUNT_SID, this.config.TWILIO_AUTH_TOKEN);
      const message = await client.messages.create({ to: input.to, from: input.from, body: input.text });
      return { status: "queued", providerMessageId: message.sid };
    } catch (error) {
      return { status: "failed", error: (error as Error).message };
    }
  }

  acknowledge(): string {
    return new twilio.twiml.MessagingResponse().toString();
  }
}
