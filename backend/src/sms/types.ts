/** Contrato interno del SMS entrante (spec §5). */
export interface InboundSms {
  provider: string;
  messageId: string;
  from: string;
  to: string;
  text: string;
  receivedAt: string;
}

export interface SendMessageInput {
  to: string;
  from: string;
  text: string;
  paymentId?: string;
}

export interface SendResult {
  providerMessageId?: string;
  status: "sent" | "queued" | "failed";
  error?: string;
}

/** Petición de webhook normalizada, independiente del proveedor. */
export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface SmsProvider {
  readonly name: string;
  /** Valida firma/autenticación del proveedor. */
  validateWebhook(request: WebhookRequest): boolean;
  /** Convierte el payload nativo en el contrato interno. */
  parseIncoming(request: WebhookRequest): InboundSms;
  /** Envía un SMS por la API del proveedor. */
  sendMessage(input: SendMessageInput): Promise<SendResult>;
  /** Formato de acknowledgment que espera el proveedor. */
  acknowledge(): unknown;
}
