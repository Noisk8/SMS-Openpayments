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
  /**
   * Cuerpo crudo de la petición, tal cual llegó por la red. Los proveedores que
   * firman el payload original (p. ej. Relayion) deben verificar contra este
   * string y nunca contra una copia re-serializada de `body`.
   */
  rawBody?: string;
}

export interface SmsProvider {
  readonly name: string;
  /** Valida firma/autenticación del proveedor. */
  validateWebhook(request: WebhookRequest): boolean;
  /**
   * Convierte el payload nativo en el contrato interno. Puede ser asíncrono
   * cuando el proveedor debe enriquecer el payload con una llamada a su API
   * (p. ej. Relayion consulta el cuerpo cuando el webhook no lo incluye).
   */
  parseIncoming(request: WebhookRequest): InboundSms | Promise<InboundSms>;
  /** Envía un SMS por la API del proveedor. */
  sendMessage(input: SendMessageInput): Promise<SendResult>;
  /** Formato de acknowledgment que espera el proveedor. */
  acknowledge(): unknown;
}
