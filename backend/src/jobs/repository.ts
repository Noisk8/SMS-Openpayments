import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { isUniqueViolation } from "../db/errors";
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
  /** Avoids enqueuing the same work twice (e.g. a duplicated SMS). */
  dedupeKey?: string;
  nextRunAt?: string;
  maxAttempts?: number;
}

export async function enqueueJob(db: Db, input: EnqueueInput): Promise<void> {
  const now = nowIso();
  try {
    await db.run(
      `INSERT INTO jobs (id, type, payload, dedupe_key, status, attempts, max_attempts, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.type,
        JSON.stringify(input.payload ?? {}),
        input.dedupeKey ?? null,
        input.maxAttempts ?? 5,
        input.nextRunAt ?? now,
        now,
        now,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return; // already enqueued
    }
    throw error;
  }
}

/**
 * Atomically claims the next ready job (or one whose lease expired).
 * Returns null when no job is available.
 *
 * `FOR UPDATE SKIP LOCKED` guarantees that two processors never lease the same
 * row: a concurrent claimant skips the locked row instead of blocking.
 */
export async function claimNextJob(db: Db, now: string = nowIso(), leaseMs = 60_000): Promise<JobRow | null> {
  const leaseUntil = isoPlusMs(leaseMs, new Date(now));
  const row = await db.get<JobRow>(
    `WITH candidate AS (
       SELECT id FROM jobs
        WHERE status IN ('pending','leased')
          AND next_run_at <= ?
          AND (lease_until IS NULL OR lease_until < ?)
        ORDER BY next_run_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE jobs
        SET status = 'leased', lease_until = ?, attempts = attempts + 1, updated_at = ?
      WHERE id IN (SELECT id FROM candidate)
      RETURNING *`,
    [now, now, leaseUntil, now],
  );
  return row ?? null;
}

export async function completeJob(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE jobs SET status = 'done', lease_until = NULL, updated_at = ? WHERE id = ?`, [
    nowIso(),
    id,
  ]);
}

/** Retries with exponential backoff up to max_attempts; then marks 'failed'. */
export async function failJob(db: Db, id: string, error: string, retryDelayMs = 5_000): Promise<void> {
  const job = await db.get<{ attempts: number; max_attempts: number }>(
    `SELECT attempts, max_attempts FROM jobs WHERE id = ?`,
    [id],
  );
  if (!job) {
    return;
  }
  const now = nowIso();
  if (job.attempts >= job.max_attempts) {
    await db.run(
      `UPDATE jobs SET status = 'failed', lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`,
      [error, now, id],
    );
    return;
  }
  const delay = retryDelayMs * 2 ** Math.max(0, job.attempts - 1);
  await db.run(
    `UPDATE jobs SET status = 'pending', lease_until = NULL, next_run_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
    [isoPlusMs(delay), error, now, id],
  );
}
