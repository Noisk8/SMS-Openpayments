import type { AppConfig } from "../config";
import type { Db } from "../db";
import { isTerminal } from "../domain";
import { reconcilePayment } from "../payments/reconciliation";
import { getPayment } from "../payments/service";
import type { PaymentProvider } from "../payments/types";
import type { SecretBox } from "../security/encryption";
import { runCommand } from "../sms/command-service";
import { getInboundSms, sendOutboundSms } from "../sms/service";
import type { SmsProvider } from "../sms/types";
import { isPast, nowIso } from "../util/time";
import type { JobProcessor } from "./processor";

/**
 * Wiring between the SMS pipeline and the payment domain (spec §5, §9, §12).
 *
 * `process_inbound_sms` turns a persisted inbound SMS into a command run plus a
 * delivered reply. `reconcile_payment` inspects a known payment resource without
 * retrying the transfer. Recovery inspectors decide whether interrupted work is
 * already done or must be requeued, instead of replaying blindly.
 */

export interface JobHandlerDeps {
  config: AppConfig;
  db: Db;
  provider: PaymentProvider;
  sms: SmsProvider;
  secretBox: SecretBox | null;
}

interface ProcessInboundPayload {
  smsId?: string;
}

interface ReconcilePayload {
  paymentId?: string;
  accessToken?: string;
}

/** Parses a job payload defensively; malformed payloads yield an empty object. */
function parsePayload<T>(payload: string): T {
  try {
    return JSON.parse(payload || "{}") as T;
  } catch {
    return {} as T;
  }
}

export function registerJobHandlers(processor: JobProcessor, deps: JobHandlerDeps): void {
  processor.register("process_inbound_sms", async (job) => {
    const { smsId } = parsePayload<ProcessInboundPayload>(job.payload);
    if (!smsId) {
      return;
    }
    const inbound = getInboundSms(deps.db, smsId);
    if (!inbound) {
      return;
    }
    const outcome = await runCommand(deps, inbound);
    // Mark as handled before delivery: an interrupted lease must not replay a
    // command that creates a payment (PAGAR would otherwise be duplicated).
    deps.db
      .prepare(`UPDATE sms_messages SET processed_at = ? WHERE id = ? AND processed_at IS NULL`)
      .run(nowIso(), smsId);

    await sendOutboundSms(deps.db, deps.sms, {
      to: inbound.from,
      from: inbound.to,
      text: outcome.reply,
      ...(outcome.paymentId ? { paymentId: outcome.paymentId } : {}),
    });
  });

  processor.register("reconcile_payment", async (job) => {
    const { paymentId, accessToken } = parsePayload<ReconcilePayload>(job.payload);
    if (!paymentId) {
      return;
    }
    const token = accessToken ?? resolveStoredAccessToken(deps, paymentId);
    await reconcilePayment(
      { db: deps.db, provider: deps.provider, ...(token ? { accessToken: token } : {}) },
      { paymentId, ...(token ? { accessToken: token } : {}) },
    );
  });

  // --- Recovery inspectors (inspect, do not replay blindly) -----------------

  processor.registerRecovery("process_inbound_sms", (job) => {
    const { smsId } = parsePayload<ProcessInboundPayload>(job.payload);
    if (!smsId) {
      return "complete";
    }
    const row = deps.db
      .prepare(`SELECT processed_at FROM sms_messages WHERE id = ?`)
      .get(smsId) as { processed_at: string | null } | undefined;
    if (!row) {
      return "complete";
    }
    // Already handled (side effects committed): do not run the command again.
    return row.processed_at ? "complete" : "requeue";
  });

  processor.registerRecovery("reconcile_payment", (job) => {
    const { paymentId } = parsePayload<ReconcilePayload>(job.payload);
    if (!paymentId) {
      return "complete";
    }
    const payment = getPayment(deps.db, paymentId);
    if (!payment) {
      return "complete";
    }
    // Reconciliation is read-only; only requeue while the outcome is still open.
    return isTerminal(payment.state) ? "complete" : "requeue";
  });
}

/** Decrypts the newest non-expired stored grant token for a payment's wallet. */
function resolveStoredAccessToken(deps: JobHandlerDeps, paymentId: string): string | undefined {
  if (!deps.secretBox) {
    return undefined;
  }
  const payment = getPayment(deps.db, paymentId);
  if (!payment) {
    return undefined;
  }
  const rows = deps.db
    .prepare(
      `SELECT access_token_enc, expires_at FROM grants
        WHERE wallet_id = ? AND status = 'GRANTED' AND access_token_enc IS NOT NULL
        ORDER BY created_at DESC, rowid DESC`,
    )
    .all(payment.senderWalletId) as Array<{ access_token_enc: string; expires_at: string | null }>;
  for (const row of rows) {
    if (row.expires_at && isPast(row.expires_at)) {
      continue;
    }
    try {
      return deps.secretBox.decrypt(row.access_token_enc);
    } catch {
      continue;
    }
  }
  return undefined;
}
