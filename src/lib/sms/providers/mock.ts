import { randomUUID } from "node:crypto";
import { normalizeColombianPhone } from "@/lib/validation/phone";
import type { IncomingSms, SendSmsInput, SendSmsResult, SmsProvider } from "@/lib/sms/types";

export interface MockOutboundSms {
  id: string;
  to: string;
  body: string;
  createdAt: Date;
}

/**
 * Proveedor SMS simulado. No envía nada a la red: los mensajes salientes se guardan
 * en una bandeja en memoria que muestra el simulador. Nunca se expone una ruta de
 * webhook pública para este proveedor.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  readonly capabilities = { send: true, receive: true };
  private readonly outbox: MockOutboundSms[] = [];

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const id = randomUUID();
    this.outbox.push({ id, to: input.to, body: input.body, createdAt: new Date() });
    return { success: true, messageId: id };
  }

  /** Mensajes salientes simulados desde la última consulta (no los borra). */
  listOutbox(): MockOutboundSms[] {
    return [...this.outbox];
  }

  takeOutboxSince(index: number): MockOutboundSms[] {
    return this.outbox.slice(index);
  }

  outboxLength(): number {
    return this.outbox.length;
  }

  /** Construye un IncomingSms simulado con el mismo formato que los proveedores reales. */
  buildIncoming(from: string, body: string, to = "+573000000000"): IncomingSms {
    return {
      id: randomUUID(),
      from: normalizeColombianPhone(from),
      to,
      body,
      provider: this.name,
      receivedAt: new Date(),
    };
  }

  async parseIncoming(): Promise<IncomingSms> {
    throw new Error("El proveedor mock no recibe webhooks; usa buildIncoming desde el simulador.");
  }

  async validateWebhook(): Promise<boolean> {
    return false;
  }
}
