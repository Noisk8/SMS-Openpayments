import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { isUniqueViolation } from "../db/errors";
import { AppError } from "../errors";
import { enqueueJob } from "../jobs/repository";
import { nowIso } from "../util/time";
import type { InboundSms, SendMessageInput, SendResult, SmsProvider, WebhookRequest } from "./types";

export interface InboundPersistResult {
  duplicate: boolean;
  messageRowId: string;
}

/**
 * Persiste el SMS ANTES de reconocerlo. El UNIQUE(provider, provider_message_id)
 * garantiza que un mensaje duplicado no se procese dos veces.
 */
export async function persistInboundSms(db: Db, inbound: InboundSms): Promise<InboundPersistResult> {
  const id = randomUUID();
  try {
    await db.run(
      `INSERT INTO sms_messages
         (id, provider, provider_message_id, direction, from_phone, to_phone, text, status, created_at)
       VALUES (?, ?, ?, 'inbound', ?, ?, ?, 'received', ?)`,
      [id, inbound.provider, inbound.messageId, inbound.from, inbound.to, inbound.text, inbound.receivedAt],
    );

    await enqueueJob(db, {
      type: "process_inbound_sms",
      payload: { smsId: id },
      dedupeKey: `sms:${inbound.provider}:${inbound.messageId}`,
    });
    return { duplicate: false, messageRowId: id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const row = await db.get<{ id: string }>(
        `SELECT id FROM sms_messages WHERE provider = ? AND provider_message_id = ?`,
        [inbound.provider, inbound.messageId],
      );
      return { duplicate: true, messageRowId: row?.id ?? id };
    }
    throw error;
  }
}

/** Validates, parses and persists an inbound webhook. Throws when the signature is invalid. */
export async function receiveInbound(
  db: Db,
  provider: SmsProvider,
  request: WebhookRequest,
): Promise<InboundPersistResult> {
  if (!provider.validateWebhook(request)) {
    throw new AppError("UNAUTHORIZED", "Firma de webhook inválida.");
  }
  return persistInboundSms(db, await provider.parseIncoming(request));
}

export async function getInboundSms(db: Db, id: string): Promise<InboundSms | null> {
  const row = await db.get<{
    provider: string;
    provider_message_id: string | null;
    from_phone: string;
    to_phone: string;
    text: string;
    created_at: string;
  }>(
    `SELECT provider, provider_message_id, from_phone, to_phone, text, created_at
       FROM sms_messages WHERE id = ? AND direction = 'inbound'`,
    [id],
  );
  if (!row) {
    return null;
  }
  return {
    provider: row.provider,
    messageId: row.provider_message_id ?? id,
    from: row.from_phone,
    to: row.to_phone,
    text: row.text,
    receivedAt: row.created_at,
  };
}

/** Envía por el proveedor y persiste el SMS saliente. */
export async function sendOutboundSms(
  db: Db,
  provider: SmsProvider,
  input: SendMessageInput,
): Promise<SendResult & { smsId: string }> {
  const result = await provider.sendMessage(input);
  const id = randomUUID();
  await db.run(
    `INSERT INTO sms_messages
       (id, provider, provider_message_id, direction, from_phone, to_phone, text, status, payment_id, error, created_at)
     VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      provider.name,
      result.providerMessageId ?? null,
      input.from,
      input.to,
      input.text,
      result.status,
      input.paymentId ?? null,
      result.error ?? null,
      nowIso(),
    ],
  );
  return { ...result, smsId: id };
}
