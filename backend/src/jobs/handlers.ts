import type { AppConfig } from "../config";
import type { Db } from "../db";
import { getAssignmentById } from "../demo/repository";
import { DEMO_TOPUP_JOB, isDemoFundingSettled, runDemoTopUp } from "../demo/service";
import { isTerminal } from "../domain";
import { rotateGrantToken } from "../grants/service";
import { getGrantRow } from "../onboarding/service";
import { reconcilePayment } from "../payments/reconciliation";
import { getPayment } from "../payments/service";
import type { PaymentProvider } from "../payments/types";
import type { SecretBox } from "../security/encryption";
import { runCommand } from "../sms/command-service";
import { getInboundSms, sendOutboundSms } from "../sms/service";
import type { SmsProvider } from "../sms/types";
import { isPast, nowIso } from "../util/time";
import type { JobProcessor } from "./processor";
import { ROTATE_GRANT_TOKEN_JOB, type RotationJobPayload } from "./rotation";

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

interface DemoTopUpPayload {
  assignmentId?: string;
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
    const inbound = await getInboundSms(deps.db, smsId);
    if (!inbound) {
      return;
    }
    const outcome = await runCommand(deps, inbound);
    // Mark as handled before delivery: an interrupted lease must not replay a
    // command that creates a payment (PAGAR would otherwise be duplicated).
    await deps.db.run(
      `UPDATE sms_messages SET processed_at = ? WHERE id = ? AND processed_at IS NULL`,
      [nowIso(), smsId],
    );

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
    const token = accessToken ?? (await resolveStoredAccessToken(deps, paymentId));
    await reconcilePayment(
      { db: deps.db, provider: deps.provider, ...(token ? { accessToken: token } : {}) },
      { paymentId, ...(token ? { accessToken: token } : {}) },
    );
  });

  // Demo onboarding funding: prepares and executes (or reconciles) the single
  // automatic treasury top-up. Never re-sends a transfer blindly.
  processor.register(DEMO_TOPUP_JOB, async (job) => {
    const { assignmentId } = parsePayload<DemoTopUpPayload>(job.payload);
    if (!assignmentId) {
      return;
    }
    await runDemoTopUp(
      { config: deps.config, db: deps.db, provider: deps.provider, secretBox: deps.secretBox },
      { assignmentId },
    );
  });

  // Rotates an access token shortly before it expires, so a granted grant stays
  // usable without re-consent. The rotation service is single-flight and flags
  // the grant when a fresh consent is required; it also schedules the next run.
  processor.register(ROTATE_GRANT_TOKEN_JOB, async (job) => {
    const { grantId, expectedExpiresAt } = parsePayload<RotationJobPayload>(job.payload);
    if (!grantId) {
      return;
    }
    const grant = await getGrantRow(deps.db, grantId);
    if (!grant || grant.status !== "GRANTED" || grant.requires_reconsent) {
      return;
    }
    // A stale schedule: another rotation already advanced the expiry.
    if (expectedExpiresAt !== undefined && grant.expires_at !== expectedExpiresAt) {
      return;
    }
    await rotateGrantToken(
      { config: deps.config, db: deps.db, provider: deps.provider, secretBox: deps.secretBox },
      grantId,
    );
  });

  // --- Recovery inspectors (inspect, do not replay blindly) -----------------

  processor.registerRecovery("process_inbound_sms", async (job) => {
    const { smsId } = parsePayload<ProcessInboundPayload>(job.payload);
    if (!smsId) {
      return "complete";
    }
    const row = await deps.db.get<{ processed_at: string | null }>(
      `SELECT processed_at FROM sms_messages WHERE id = ?`,
      [smsId],
    );
    if (!row) {
      return "complete";
    }
    // Already handled (side effects committed): do not run the command again.
    return row.processed_at ? "complete" : "requeue";
  });

  processor.registerRecovery("reconcile_payment", async (job) => {
    const { paymentId } = parsePayload<ReconcilePayload>(job.payload);
    if (!paymentId) {
      return "complete";
    }
    const payment = await getPayment(deps.db, paymentId);
    if (!payment) {
      return "complete";
    }
    // Reconciliation is read-only; only requeue while the outcome is still open.
    return isTerminal(payment.state) ? "complete" : "requeue";
  });

  processor.registerRecovery(DEMO_TOPUP_JOB, async (job) => {
    const { assignmentId } = parsePayload<DemoTopUpPayload>(job.payload);
    if (!assignmentId) {
      return "complete";
    }
    const assignment = await getAssignmentById(deps.db, assignmentId);
    if (!assignment) {
      return "complete";
    }
    // Already settled: nothing to redo. Otherwise requeue to reconcile.
    return isDemoFundingSettled(assignment.funding_status) ? "complete" : "requeue";
  });

  processor.registerRecovery(ROTATE_GRANT_TOKEN_JOB, async (job) => {
    const { grantId } = parsePayload<RotationJobPayload>(job.payload);
    if (!grantId) {
      return "complete";
    }
    const grant = await getGrantRow(deps.db, grantId);
    if (!grant || grant.status !== "GRANTED" || grant.requires_reconsent) {
      return "complete";
    }
    // If the token already expired there is nothing to rotate: consent is needed.
    return grant.expires_at && isPast(grant.expires_at) ? "complete" : "requeue";
  });
}

/** Decrypts the newest non-expired stored grant token for a payment's wallet. */
async function resolveStoredAccessToken(deps: JobHandlerDeps, paymentId: string): Promise<string | undefined> {
  if (!deps.secretBox) {
    return undefined;
  }
  const payment = await getPayment(deps.db, paymentId);
  if (!payment) {
    return undefined;
  }
  const rows = await deps.db.all<{ access_token_enc: string; expires_at: string | null }>(
    `SELECT access_token_enc, expires_at FROM grants
      WHERE wallet_id = ? AND status = 'GRANTED' AND access_token_enc IS NOT NULL
        AND requires_reconsent = 0
      ORDER BY created_at DESC, seq DESC`,
    [payment.senderWalletId],
  );
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
