import type { Db } from "../db";
import { claimNextJob, completeJob, failJob, type JobRow } from "./repository";

/**
 * Procesador de trabajos con claim atómico y recuperación de leases.
 *
 * Garantías:
 * - `runOnce` reclama como máximo un trabajo por llamada (claim atómico del
 *   repositorio), por lo que dos procesadores nunca ejecutan el mismo trabajo.
 * - Un fallo devuelve el trabajo a `pending` con backoff exponencial; al agotar
 *   `max_attempts` queda en `failed`.
 * - Los leases expirados se recuperan. Si el tipo registró un inspector de
 *   recuperación (`registerRecovery`), se inspecciona el trabajo interrumpido
 *   antes de decidir; si no, el handler recibe `recovered = true` para que
 *   inspeccione el estado externo en vez de re-ejecutar a ciegas.
 */

export interface JobHandlerContext {
  /** true cuando el trabajo ya se había reclamado antes (reintento o lease interrumpido). */
  recovered: boolean;
}

export type JobHandler = (job: JobRow, context: JobHandlerContext) => Promise<void> | void;

/** Resultado del inspector de un lease interrumpido. */
export type LeaseRecoveryResult = "complete" | "requeue";

export type LeaseRecoveryHandler = (job: JobRow) => Promise<LeaseRecoveryResult> | LeaseRecoveryResult;

export interface JobProcessorOptions {
  db: Db;
  /** Duración del lease al reclamar un trabajo, en ms. */
  leaseMs?: number;
  /** Retardo base de reintento; se duplica en cada intento. */
  retryDelayMs?: number;
  /** Reloj inyectable para pruebas deterministas. */
  now?: () => Date;
}

export class JobProcessor {
  private readonly db: Db;
  private readonly leaseMs: number;
  private readonly retryDelayMs: number;
  private readonly clock: () => Date;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly recoveryHandlers = new Map<string, LeaseRecoveryHandler>();

  constructor(options: JobProcessorOptions) {
    this.db = options.db;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.retryDelayMs = options.retryDelayMs ?? 5_000;
    this.clock = options.now ?? (() => new Date());
  }

  /** Registra el handler que ejecuta un trabajo normal. */
  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /** Registra un inspector para los leases interrumpidos de este tipo. */
  registerRecovery(type: string, handler: LeaseRecoveryHandler): void {
    this.recoveryHandlers.set(type, handler);
  }

  /**
   * Inspecciona los leases expirados que tengan inspector registrado.
   * Los trabajos con lease expirado SIN inspector no se tocan aquí: quedan
   * disponibles para que `runOnce` los reclame marcándolos como recuperados.
   *
   * @returns cuántos leases interrumpidos se procesaron.
   */
  async recoverExpiredLeases(): Promise<number> {
    const now = this.nowIso();
    const expired = this.db
      .prepare(
        `SELECT * FROM jobs
          WHERE status = 'leased' AND lease_until IS NOT NULL AND lease_until < ?
          ORDER BY next_run_at ASC`,
      )
      .all(now) as JobRow[];

    let recovered = 0;
    for (const job of expired) {
      const inspect = this.recoveryHandlers.get(job.type);
      if (!inspect) {
        continue;
      }
      try {
        const outcome = await inspect(job);
        if (outcome === "complete") {
          completeJob(this.db, job.id);
        } else {
          failJob(this.db, job.id, "Lease expirado: trabajo interrumpido", this.retryDelayMs);
        }
        recovered += 1;
      } catch (error) {
        failJob(this.db, job.id, `Recuperación fallida: ${errorMessage(error)}`, this.retryDelayMs);
        recovered += 1;
      }
    }
    return recovered;
  }

  /**
   * Reclama y ejecuta un trabajo. Devuelve `true` si procesó algo, `false` si no
   * había trabajo disponible (útil como `while (await runOnce()) {}`).
   */
  async runOnce(): Promise<boolean> {
    const job = claimNextJob(this.db, this.nowIso(), this.leaseMs);
    if (!job) {
      return false;
    }

    const handler = this.handlers.get(job.type);
    if (!handler) {
      failJob(this.db, job.id, `No hay handler registrado para el tipo "${job.type}"`, this.retryDelayMs);
      return true;
    }

    // attempts > 1 significa que este trabajo ya se había reclamado antes:
    // es un reintento o un lease interrumpido y debe inspeccionarse.
    const context: JobHandlerContext = { recovered: job.attempts > 1 };
    try {
      await handler(job, context);
      completeJob(this.db, job.id);
    } catch (error) {
      failJob(this.db, job.id, errorMessage(error), this.retryDelayMs);
    }
    return true;
  }

  private nowIso(): string {
    // Se preserva el formato ISO-8601 UTC que usa el repositorio de jobs.
    return this.clock().toISOString();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
