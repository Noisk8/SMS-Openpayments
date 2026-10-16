import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import { JobProcessor } from "../src/jobs/processor";
import { claimNextJob, enqueueJob } from "../src/jobs/repository";
import { testDb } from "./helpers";

interface JobRowLike {
  id: string;
  status: string;
  attempts: number;
  next_run_at: string;
  last_error: string | null;
}

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const iso = (ms: number): string => new Date(ms).toISOString();

describe("JobProcessor", () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  afterEach(() => {
    db.close();
  });

  const readJob = (type: string): JobRowLike =>
    db.prepare(`SELECT id, status, attempts, next_run_at, last_error FROM jobs WHERE type = ?`).get(type) as JobRowLike;

  it("reclama cada trabajo una sola vez", async () => {
    enqueueJob(db, { type: "once", nextRunAt: iso(BASE) });

    const first = new JobProcessor({ db, now: () => new Date(BASE) });
    const second = new JobProcessor({ db, now: () => new Date(BASE) });
    let calls = 0;
    const handler = (): void => {
      calls += 1;
    };
    first.register("once", handler);
    second.register("once", handler);

    const results = await Promise.all([first.runOnce(), second.runOnce()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(calls).toBe(1);
    expect(readJob("once").status).toBe("done");
    expect(await first.runOnce()).toBe(false);
  });

  it("reintenta con backoff exponencial", async () => {
    enqueueJob(db, { type: "flaky", nextRunAt: new Date(Date.now()).toISOString() });

    let nowMs = Date.now();
    const processor = new JobProcessor({ db, now: () => new Date(nowMs), retryDelayMs: 1000 });
    let calls = 0;
    processor.register("flaky", () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("boom");
      }
    });

    // Intento 1: falla y queda pendiente para más adelante.
    expect(await processor.runOnce()).toBe(true);
    let job = readJob("flaky");
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBe("boom");
    const firstDelay = Date.parse(job.next_run_at) - Date.now();
    expect(firstDelay).toBeGreaterThan(0);
    expect(firstDelay).toBeLessThanOrEqual(1500);

    // Aún no está listo: no se reclama antes de tiempo.
    expect(await processor.runOnce()).toBe(false);

    // Intento 2: el retardo crece (backoff exponencial).
    nowMs = Date.parse(job.next_run_at);
    expect(await processor.runOnce()).toBe(true);
    job = readJob("flaky");
    const secondDelay = Date.parse(job.next_run_at) - Date.now();
    expect(job.attempts).toBe(2);
    expect(secondDelay).toBeGreaterThan(firstDelay);

    // Intento 3: éxito.
    nowMs = Date.parse(job.next_run_at);
    expect(await processor.runOnce()).toBe(true);
    expect(readJob("flaky").status).toBe("done");
    expect(calls).toBe(3);
  });

  it("marca failed al agotar max_attempts", async () => {
    enqueueJob(db, { type: "dead", nextRunAt: new Date(Date.now()).toISOString(), maxAttempts: 2 });

    let nowMs = Date.now();
    const processor = new JobProcessor({ db, now: () => new Date(nowMs), retryDelayMs: 1000 });
    processor.register("dead", () => {
      throw new Error("siempre falla");
    });

    expect(await processor.runOnce()).toBe(true);
    let job = readJob("dead");
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);

    nowMs = Date.parse(job.next_run_at);
    expect(await processor.runOnce()).toBe(true);
    job = readJob("dead");
    expect(job.attempts).toBe(2);
    expect(job.status).toBe("failed");
  });

  it("recupera un lease expirado marcando el trabajo como recuperado", async () => {
    enqueueJob(db, { type: "interrupted", nextRunAt: iso(BASE) });
    // Un worker reclama el trabajo con un lease corto y "muere" sin completarlo.
    const leased = claimNextJob(db, iso(BASE), 1000);
    expect(leased?.id).toBe(readJob("interrupted").id);
    expect(readJob("interrupted").status).toBe("leased");

    const seen: boolean[] = [];
    const processor = new JobProcessor({ db, now: () => new Date(BASE + 2000) });
    processor.register("interrupted", (_job, context) => {
      seen.push(context.recovered);
    });

    expect(await processor.runOnce()).toBe(true);
    // El handler sabe que es un trabajo interrumpido y debe inspeccionar el estado.
    expect(seen).toEqual([true]);
    expect(readJob("interrupted").status).toBe("done");
  });

  it("inspecciona leases interrumpidos con el recovery handler, sin re-ejecutar", async () => {
    enqueueJob(db, { type: "recoverable", nextRunAt: iso(BASE) });
    claimNextJob(db, iso(BASE), 1000);

    const inspected: string[] = [];
    let normalCalls = 0;
    const processor = new JobProcessor({ db, now: () => new Date(BASE + 2000) });
    processor.registerRecovery("recoverable", (job) => {
      inspected.push(job.id);
      return "complete";
    });
    processor.register("recoverable", () => {
      normalCalls += 1;
    });

    expect(await processor.recoverExpiredLeases()).toBe(1);
    expect(inspected).toHaveLength(1);
    expect(normalCalls).toBe(0);
    expect(readJob("recoverable").status).toBe("done");
  });

  it("reencola un lease interrumpido cuando la inspección lo pide", async () => {
    enqueueJob(db, { type: "requeue-me", nextRunAt: iso(BASE) });
    claimNextJob(db, iso(BASE), 1000);

    const processor = new JobProcessor({
      db,
      now: () => new Date(BASE + 2000),
      retryDelayMs: 500,
    });
    processor.registerRecovery("requeue-me", () => "requeue");

    expect(await processor.recoverExpiredLeases()).toBe(1);
    const job = readJob("requeue-me");
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.last_error).toContain("Lease expirado");
  });
});
