import { requireEnv, type AppEnv } from "@/lib/config/env";
import { pendingCapability } from "@/lib/sms/providers/pending";
import type { IncomingSms, SendSmsInput, SendSmsResult, SmsProvider } from "@/lib/sms/types";

const SEND_URL = "https://www.onurix.com/api/v1/sms/send";

/**
 * Onurix: envío de SMS según https://docs.onurix.com/sms/send_sms
 * (POST form-urlencoded: client, key, phone sin "+", sms).
 *
 * Recepción: NO implementada. La documentación pública de webhooks de Onurix describe
 * WhatsApp; la recepción de SMS de doble vía se habilita por soporte (errores 1055/1056).
 * Se implementará cuando se disponga de la especificación del endpoint receptor.
 */
export class OnurixSmsProvider implements SmsProvider {
  readonly name = "onurix";
  readonly capabilities = { send: true, receive: false };
  private readonly apiKey: string;
  private readonly clientId: string;

  constructor(env: AppEnv) {
    const values = requireEnv(env, ["ONURIX_API_KEY", "ONURIX_CLIENT_ID"], "Onurix");
    this.apiKey = values.ONURIX_API_KEY;
    this.clientId = values.ONURIX_CLIENT_ID;
  }

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const form = new URLSearchParams({
      client: this.clientId,
      key: this.apiKey,
      phone: input.to.replace(/^\+/, ""),
      sms: input.body,
    });
    try {
      const response = await fetch(SEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await response.json().catch(() => null)) as { id?: string; msg?: string } | null;
      if (!response.ok || !payload?.id) {
        console.error("[onurix] respuesta no válida", response.status);
        return { success: false, error: "Onurix rechazó el envío." };
      }
      return { success: true, messageId: String(payload.id) };
    } catch {
      return { success: false, error: "No se pudo contactar a Onurix." };
    }
  }

  async parseIncoming(): Promise<IncomingSms> {
    throw pendingCapability(
      this.name,
      "recepción de SMS",
      "Requiere la especificación del endpoint de mensajes de doble vía del contrato Onurix.",
    );
  }

  async validateWebhook(): Promise<boolean> {
    // Rechazo explícito: no se acepta ningún webhook hasta tener un contrato verificable.
    return false;
  }
}

