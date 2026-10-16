import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../../config";
import { AppError } from "../../errors";
import { nowIso } from "../../util/time";
import type { InboundSms, SendMessageInput, SendResult, SmsProvider, WebhookRequest } from "../types";

/** Relayion public API base URL (https://relayion.com/docs). */
export const RELAYION_BASE_URL = "https://api.relayion.com";

/** Minimal `fetch` surface we depend on, so tests can inject a fake. */
export type RelayionFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface RelayionProviderDeps {
  /** Override the HTTP client (tests inject a fake; production uses global fetch). */
  fetch?: RelayionFetch;
}

/**
 * Relayion webhook envelope. Only the fields we consume are validated; the API
 * may add more, so unknown keys are preserved.
 */
const inboundEventSchema = z
  .object({
    event: z.string().min(1),
    timestamp: z.string().optional(),
    data: z
      .object({
        id: z.string().min(1),
        deviceId: z.string().optional(),
        senderNumber: z.string().min(1),
        simSlotIndex: z.number().optional(),
        simPhoneNumber: z.string().min(1),
        receivedAt: z.string().optional(),
        // Present only when the webhook is configured with `includeBody`.
        body: z.string().optional(),
      })
      .loose(),
  })
  .loose();

/** `GET /api/v1/inbound/:id` response envelope; the fetched record always carries `body`. */
const inboundDetailSchema = z
  .object({
    success: z.boolean(),
    data: z
      .object({
        id: z.string().min(1),
        body: z.string(),
      })
      .loose(),
  })
  .loose();

const outboundResponseSchema = z
  .object({
    success: z.boolean(),
    data: z
      .object({
        id: z.string().min(1),
        status: z.string().min(1),
      })
      .loose(),
  })
  .loose();

const errorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    error: z.object({ message: z.string().optional(), code: z.string().optional() }).loose().optional(),
  })
  .loose();

/**
 * Proveedor SMS real sobre Relayion (https://relayion.com).
 *
 * - Auth: `Authorization: Bearer rlyn_...` on every API call.
 * - Inbound webhooks are signed with `X-Relayion-Signature`: HMAC-SHA256 of the
 *   RAW request body, hex-encoded. We never trust a re-serialized payload.
 * - The `inbound.received` webhook omits `body` unless `includeBody` is enabled,
 *   so `parseIncoming` fetches the message from `GET /api/v1/inbound/:id` when
 *   the body is missing.
 */
export class RelayionSmsProvider implements SmsProvider {
  readonly name = "relayion";

  private readonly fetchImpl: RelayionFetch;

  constructor(
    private readonly config: AppConfig,
    deps: RelayionProviderDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as RelayionFetch);
  }

  validateWebhook(request: WebhookRequest): boolean {
    try {
      const signature = headerValue(request.headers, "x-relayion-signature");
      if (typeof signature !== "string" || signature.length === 0) return false;
      // Signature verification requires the exact bytes Relayion signed.
      if (typeof request.rawBody !== "string") return false;

      const expected = createHmac("sha256", this.config.RELAYION_WEBHOOK_SECRET)
        .update(request.rawBody, "utf8")
        .digest("hex");
      if (!equalsConstantTime(expected, signature)) return false;

      // Only inbound events are handled; a valid signature on any other event is rejected.
      const event = readEvent(request);
      return event === "inbound.received";
    } catch {
      return false;
    }
  }

  async parseIncoming(request: WebhookRequest): Promise<InboundSms> {
    const parsed = inboundEventSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "Payload de Relayion inválido.", {
        issues: parsed.error.issues,
      });
    }
    const { data } = parsed.data;

    let text = data.body;
    if (text === undefined) {
      text = await this.fetchInboundBody(data.id);
    }

    return {
      provider: this.name,
      messageId: data.id,
      from: data.senderNumber,
      to: data.simPhoneNumber,
      text,
      receivedAt: data.receivedAt ?? parsed.data.timestamp ?? nowIso(),
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendResult> {
    const payload: Record<string, unknown> = {
      recipientNumber: input.to,
      body: input.text,
    };
    if (this.config.RELAYION_DEVICE_ID) {
      payload.deviceId = this.config.RELAYION_DEVICE_ID;
    }

    try {
      const response = await this.fetchImpl(`${RELAYION_BASE_URL}/api/v1/outbound`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.RELAYION_API_KEY}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const json = await readJson(response);
      const parsed = outboundResponseSchema.safeParse(json);
      if (!response.ok || !parsed.success) {
        return { status: "failed", error: describeError(json, response.status) };
      }

      const status = parsed.data.data.status.toUpperCase();
      if (status !== "DISPATCHED" && status !== "QUEUED") {
        return { status: "failed", error: `Relayion reported status ${parsed.data.data.status}` };
      }
      return { status: "queued", providerMessageId: parsed.data.data.id };
    } catch (error) {
      return { status: "failed", error: (error as Error).message };
    }
  }

  acknowledge(): unknown {
    return { success: true };
  }

  /** Fetches the message body for a webhook that did not include it. */
  private async fetchInboundBody(id: string): Promise<string> {
    let response: Awaited<ReturnType<RelayionFetch>>;
    try {
      response = await this.fetchImpl(`${RELAYION_BASE_URL}/api/v1/inbound/${encodeURIComponent(id)}`, {
        headers: {
          authorization: `Bearer ${this.config.RELAYION_API_KEY}`,
          accept: "application/json",
        },
      });
    } catch (error) {
      // Transient network failure: surface as a provider error so the webhook
      // controller answers 5xx and Relayion retries.
      throw new AppError("PROVIDER_ERROR", `No se pudo consultar el SMS entrante en Relayion: ${(error as Error).message}`);
    }

    const json = await readJson(response);
    const parsed = inboundDetailSchema.safeParse(json);
    if (!response.ok || !parsed.success) {
      throw new AppError("VALIDATION_FAILED", "Respuesta inválida de Relayion al consultar el SMS entrante.", {
        status: response.status,
      });
    }
    return parsed.data.data.body;
  }
}

/** Case-insensitive header lookup with array handling. */
function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | string[] | undefined {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * Constant-time comparison of two hex-encoded signatures. `timingSafeEqual`
 * requires equal-length buffers, so a length mismatch is resolved first.
 */
function equalsConstantTime(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Reads the event name from the parsed body, falling back to the raw JSON. */
function readEvent(request: WebhookRequest): string | undefined {
  const body = request.body ?? safeJsonParse(request.rawBody);
  if (typeof body === "object" && body !== null && "event" in body) {
    const event = (body as { event: unknown }).event;
    return typeof event === "string" ? event : undefined;
  }
  return undefined;
}

function safeJsonParse(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function readJson(response: Awaited<ReturnType<RelayionFetch>>): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function describeError(json: unknown, status: number): string {
  const parsed = errorEnvelopeSchema.safeParse(json);
  if (parsed.success && parsed.data.error?.message) {
    const code = parsed.data.error.code ? ` (${parsed.data.error.code})` : "";
    return `${parsed.data.error.message}${code}`;
  }
  return `Relayion respondió HTTP ${status}`;
}
