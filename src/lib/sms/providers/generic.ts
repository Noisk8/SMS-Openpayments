import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnv, type AppEnv } from "@/lib/config/env";
import { assertSafeOutboundUrl } from "@/lib/sms/http-safety";
import { normalizeColombianPhone } from "@/lib/validation/phone";
import { SmsProviderError, type IncomingSms, type SendSmsInput, type SendSmsResult, type SmsProvider } from "@/lib/sms/types";

/**
 * Proveedor HTTP genérico, configurado por variables de entorno para integrar un proveedor
 * con contrato HTTP documentado sin tocar la lógica de la aplicación.
 *
 * Contrato (configurable por variables, no por expresiones):
 * - Envío: POST GENERIC_SMS_API_URL, JSON { "to": "+57...", "text": "..." },
 *   autenticación "Authorization: Bearer <GENERIC_SMS_API_KEY>",
 *   respuesta JSON con campo "id" (se usa como messageId).
 * - Recepción: POST del proveedor con JSON { "id", "from", "to", "text" } y cabecera
 *   "X-Signature" = HMAC-SHA256 en hexadecimal del cuerpo crudo con GENERIC_SMS_WEBHOOK_SECRET.
 *
 * Sin GENERIC_SMS_WEBHOOK_SECRET el webhook se rechaza en todos los entornos.
 */
export class GenericSmsProvider implements SmsProvider {
  readonly name = "generic";
  readonly capabilities = { send: true, receive: true };
  private readonly apiUrl: URL;
  private readonly apiKey: string;
  private readonly webhookSecret: string;

  constructor(env: AppEnv) {
    const values = requireEnv(
      env,
      ["GENERIC_SMS_API_URL", "GENERIC_SMS_API_KEY", "GENERIC_SMS_WEBHOOK_SECRET"],
      "el proveedor SMS genérico",
    );
    this.apiUrl = assertSafeOutboundUrl(values.GENERIC_SMS_API_URL, env.NODE_ENV !== "production");
    this.apiKey = values.GENERIC_SMS_API_KEY;
    this.webhookSecret = values.GENERIC_SMS_WEBHOOK_SECRET;
  }

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ to: input.to, text: input.body }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await response.json().catch(() => null)) as { id?: string | number } | null;
      if (!response.ok || payload?.id === undefined) {
        return { success: false, error: "El proveedor SMS rechazó el envío." };
      }
      return { success: true, messageId: String(payload.id) };
    } catch {
      return { success: false, error: "No se pudo contactar al proveedor SMS." };
    }
  }

  async parseIncoming(_request: Request, rawBody: string): Promise<IncomingSms> {
    let payload: { id?: unknown; from?: unknown; to?: unknown; text?: unknown };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      throw new SmsProviderError("Cuerpo de webhook no válido.");
    }
    if (
      typeof payload.id !== "string" ||
      typeof payload.from !== "string" ||
      typeof payload.to !== "string" ||
      typeof payload.text !== "string"
    ) {
      throw new SmsProviderError("Webhook genérico incompleto.");
    }
    return {
      id: payload.id,
      from: normalizeColombianPhone(payload.from),
      to: payload.to,
      body: payload.text,
      provider: this.name,
      receivedAt: new Date(),
    };
  }

  async validateWebhook(request: Request, rawBody: string): Promise<boolean> {
    const received = request.headers.get("x-signature");
    if (!received) {
      return false;
    }
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(received, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

