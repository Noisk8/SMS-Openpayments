import { requireEnv, type AppEnv } from "@/lib/config/env";
import { pendingCapability } from "@/lib/sms/providers/pending";
import type { IncomingSms, SendSmsInput, SendSmsResult, SmsProvider } from "@/lib/sms/types";

const BASE_URL = "https://rest.inalambria.com";
const TOKEN_SAFETY_MARGIN_MS = 60_000;

/**
 * Inalambria API REST (cuenta de envío empresarial).
 * Envío según https://docs.inalambria.com (POST /token con Basic + grant_type=password, luego
 * POST /mtmessage con Bearer). Devices sin "+" (Colombia: 12 dígitos).
 *
 * Recepción: NO implementada. La documentación consultada describe SMS de salida por REST,
 * y la recepción de respuestas por código corto/SMPP (MO); no hay un webhook REST de entrada documentado.
 * La API Inalambria Express es un producto distinto y no se usa aquí.
 */
export class InalambriaSmsProvider implements SmsProvider {
  readonly name = "inalambria";
  readonly capabilities = { send: true, receive: false };
  private token?: { value: string; expiresAt: number };

  constructor(private readonly env: AppEnv) {
    requireEnv(env, ["INALAMBRIA_USER", "INALAMBRIA_PASSWORD"], "Inalambria");
  }

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    try {
      const token = await this.getToken();
      const response = await fetch(`${BASE_URL}/mtmessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Type: 1,
          MessageText: input.body,
          Devices: input.to.replace(/^\+/, ""),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await response.json().catch(() => null)) as
        | { TransactionNumber?: string; Status?: number; MessageText?: string }
        | null;
      if (!response.ok || payload?.Status !== 0) {
        console.error("[inalambria] envío rechazado", response.status);
        return { success: false, error: "Inalambria rechazó el envío." };
      }
      return { success: true, messageId: payload.TransactionNumber };
    } catch {
      return { success: false, error: "No se pudo contactar a Inalambria." };
    }
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }
    const credentials = Buffer.from(`${this.env.INALAMBRIA_USER}:${this.env.INALAMBRIA_PASSWORD}`).toString("base64");
    const response = await fetch(`${BASE_URL}/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "password" }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!response.ok || !payload.access_token) {
      throw new Error("No se pudo obtener el token de Inalambria");
    }
    const lifetimeMs = (payload.expires_in ?? 14_400) * 1000;
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + lifetimeMs - TOKEN_SAFETY_MARGIN_MS,
    };
    return this.token.value;
  }

  async parseIncoming(): Promise<IncomingSms> {
    throw pendingCapability(
      this.name,
      "recepción de SMS",
      "Requiere la configuración de mensajes entrantes (código corto o SMPP) confirmada por Inalambria.",
    );
  }

  async validateWebhook(): Promise<boolean> {
    return false;
  }
}
