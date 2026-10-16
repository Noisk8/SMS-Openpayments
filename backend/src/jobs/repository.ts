import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { isUniqueViolation } from "../db/sqlite-errors";
import type { JobStatus } from "../domain";
import { isoPlusMs, nowIso } from "../util/time";

export interface JobRow {
  id: string;
  type: string;
  payload: string;
  dedupe_key: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  lease_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueInput {
  type: string;
  payload?: unknown;
  /** Evita encolar el mismo trabajo dos veces (p. ej. un SMS duplicado). */
  dedupeKey?: string;
  nextRunAt?: string;
  maxAttempts?: number;
}

export function enqueueJob(db: Db, input: EnqueueInput): void {
  const now = nowIso();
  try {
    db.prepare(
      `INSERT INTO jobs (id, type, payload, dedupe_key, status, attempts, max_attempts, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.type,
      JSON.stringify(input.payload ?? {}),
      input.dedupeKey ?? null,
      input.maxAttempts ?? 5,
      input.nextRunAt ?? now,
      now,
      now,
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return; // ya estaba encolado
    }
    throw error;
  }
}

/**
 * Reclama atómicamente el siguiente trabajo listo (o cuyo lease expiró).
 * Devuelve null si no hay trabajo disponible.
 */
export function claimNextJob(db: Db, now: string = nowIso(), leaseMs = 60_000): JobRow | null {
  const leaseUntil = isoPlusMs(leaseMs, new Date(now));
  const row = db
    .prepare(
      `UPDATE jobs
          SET status = 'leased', lease_until = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = (
          SELECT id FROM jobs
           WHERE status IN ('pending','leased')
             AND next_run_at <= ?
             AND (lease_until IS NULL OR lease_until < ?)
           ORDER BY next_run_at ASC
           LIMIT 1
        )
        RETURNING *`,
    )
    .get(leaseUntil, now, now, now) as JobRow | undefined;
  return row ?? null;
}

export function completeJob(db: Db, id: string): void {
  db.prepare(`UPDATE jobs SET status = 'done', lease_until = NULL, updated_at = ? WHERE id = ?`).run(
    nowIso(),
    id,
  );
}

/** Reintenta con backoff exponencial hasta max_attempts; luego marca 'failed'. */
export function failJob(db: Db, id: string, error: string, retryDelayMs = 5_000): void {
  const job = db.prepare(`SELECT attempts, max_attempts FROM jobs WHERE id = ?`).get(id) as
    | { attempts: number; max_attempts: number }
    | undefined;
  if (!job) {
    return;
  }
  const now = nowIso();
  if (job.attempts >= job.max_attempts) {
    db.prepare(
      `UPDATE jobs SET status = 'failed', lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`,
    ).run(error, now, id);
    return;
  }
  const delay = retryDelayMs * 2 ** Math.max(0, job.attempts - 1);
  db.prepare(
    `UPDATE jobs SET status = 'pending', lease_until = NULL, next_run_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
  ).run(isoPlusMs(delay), error, now, id);
}
