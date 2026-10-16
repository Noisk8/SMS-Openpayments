import type { FastifyInstance } from "fastify";
import { isAppError } from "../errors";
import { claimNextJob, completeJob, failJob } from "../jobs/repository";
import { getInboundSms, sendOutboundSms } from "../sms/service";
import type { InboundSms, SmsProvider } from "../sms/types";
import { handleManagedCommand, reconcileManagedPayments, type ManagedDeps } from "./service";

type CommandHandler = (sms: InboundSms) => Promise<string>;

export async function processNextSmsJob(deps: ManagedDeps, smsProvider: SmsProvider, handler: CommandHandler = sms => handleManagedCommand(deps, sms)): Promise<boolean> {
  const job = await claimNextJob(deps.db);
  if (!job) return false;
  try {
    if (job.type !== "process_inbound_sms") throw new Error("Tipo de trabajo no soportado");
    const { smsId } = JSON.parse(job.payload) as { smsId: string };
    const sms = await getInboundSms(deps.db, smsId);
    if (!sms) throw new Error("SMS no encontrado");
    const row = await deps.db.get<{ processed_at: string | null; reply_text: string | null }>("SELECT processed_at, reply_text FROM sms_messages WHERE id = ?", [smsId]);
    if (row?.processed_at) { await completeJob(deps.db, job.id); return true; }
    let reply = row?.reply_text ?? null;
    if (reply === null) {
      try { reply = await handler(sms); }
      catch (error) {
        if (!isAppError(error) || error.code === "PROVIDER_ERROR") throw error;
        reply = error.message;
      }
      await deps.db.run("UPDATE sms_messages SET reply_text = ? WHERE id = ?", [reply, smsId]);
    }
    const result = await sendOutboundSms(deps.db, smsProvider, { to: sms.from, from: sms.to, text: reply });
    if (result.status === "failed") throw new Error("No se pudo enviar la respuesta SMS");
    await deps.db.run("UPDATE sms_messages SET status = 'processed', processed_at = ? WHERE id = ?", [new Date().toISOString(), smsId]);
    await completeJob(deps.db, job.id);
  } catch {
    await failJob(deps.db, job.id, "Error al procesar el SMS administrado; revisar proveedor.");
  }
  return true;
}

export function registerManagedWorker(app: FastifyInstance, deps: ManagedDeps, smsProvider: SmsProvider): void {
  let running: Promise<unknown> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    await deps.db.run("UPDATE managed_transfers SET state = 'NEEDS_REVIEW' WHERE state = 'PROCESSING' AND outgoing_id IS NULL");
    timer = setInterval(() => {
      if (running) return;
      running = (async () => {
        await processNextSmsJob(deps, smsProvider);
        await reconcileManagedPayments(deps);
      })().catch(() => app.log.error("Error del procesador Rafiki")).finally(() => { running = undefined; });
    }, 500);
    timer.unref();
  });
  app.addHook("onClose", async () => { if (timer) clearInterval(timer); await running; });
}
