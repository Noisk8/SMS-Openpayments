/** Mensaje entrante normalizado. El resto de la aplicación solo conoce este formato. */
export interface IncomingSms {
  id: string;
  from: string;
  to: string;
  body: string;
  provider: string;
  receivedAt: Date;
}

export interface SendSmsInput {
  to: string;
  body: string;
}

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Contrato de cada proveedor SMS. Envío y recepción están separados.
 * `rawBody` es el cuerpo ya leído una sola vez por la ruta del webhook.
 */
export interface SmsProvider {
  readonly name: string;
  /** Capacidades realmente implementadas. Una capacidad pendiente lanza error explícito. */
  readonly capabilities: { send: boolean; receive: boolean };

  sendSms(input: SendSmsInput): Promise<SendSmsResult>;

  parseIncoming(request: Request, rawBody: string): Promise<IncomingSms>;

  validateWebhook(request: Request, rawBody: string): Promise<boolean>;
}

export class SmsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsProviderError";
  }
}
