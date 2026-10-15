import twilio from "twilio";
import { requireEnv, type AppEnv } from "@/lib/config/env";
import { normalizeColombianPhone } from "@/lib/validation/phone";
import { SmsProviderError, type IncomingSms, type SendSmsInput, type SendSmsResult, type SmsProvider } from "@/lib/sms/types";

/**
 * Twilio: envío con el SDK oficial y recepción por webhook firmado (X-Twilio-Signature).
 * Requisito comercial: el número debe estar habilitado para SMS y verificado para Colombia.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";
  readonly capabilities = { send: true, receive: true };
  private readonly client: ReturnType<typeof twilio>;
  private readonly from: string;
  private readonly authToken: string;
  private readonly webhookUrl: string;

  constructor(env: AppEnv) {
    const values = requireEnv(env, ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"], "Twilio");
    this.client = twilio(values.TWILIO_ACCOUNT_SID, values.TWILIO_AUTH_TOKEN);
    this.from = values.TWILIO_PHONE_NUMBER;
    this.authToken = values.TWILIO_AUTH_TOKEN;
    this.webhookUrl = `${env.APP_URL.replace(/\/$/, "")}/api/webhooks/sms/twilio`;
  }

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    try {
      const message = await this.client.messages.create({
        to: input.to,
        from: this.from,
        body: input.body,
      });
      return { success: true, messageId: message.sid };
    } catch (error) {
      console.error("[twilio] envío fallido", error instanceof Error ? error.message : "desconocido");
      return { success: false, error: "No se pudo enviar el SMS." };
    }
  }

  async parseIncoming(_request: Request, rawBody: string): Promise<IncomingSms> {
    const params = new URLSearchParams(rawBody);
    const from = params.get("From");
    const to = params.get("To");
    const body = params.get("Body");
    const sid = params.get("MessageSid");
    if (!from || !to || body === null || !sid) {
      throw new SmsProviderError("Webhook de Twilio incompleto.");
    }
    return {
      id: sid,
      from: normalizeColombianPhone(from),
      to,
      body,
      provider: this.name,
      receivedAt: new Date(),
    };
  }

  async validateWebhook(request: Request, rawBody: string): Promise<boolean> {
    const signature = request.headers.get("x-twilio-signature");
    if (!signature) {
      return false;
    }
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());
    return twilio.validateRequest(this.authToken, signature, this.webhookUrl, params);
  }
}
