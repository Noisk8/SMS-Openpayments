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

  beforeEach(async () => {
    db = await testDb();
  });

  afterEach(async () => {
    await db.close();
  });

  const readJob = async (type: string): Promise<JobRowLike> => {
    const row = await db.get<JobRowLike>(
      `SELECT id, status, attempts, next_run_at, last_error FROM jobs WHERE type = ?`,
      [type],
    );
    if (!row) {
      throw new Error(`Job ${type} not found`);
    }
    return row;
  };

  it("reclama cada trabajo una sola vez", async () => {
    await enqueueJob(db, { type: "once", nextRunAt: iso(BASE) });

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
    expect((await readJob("once")).status).toBe("done");
    expect(await first.runOnce()).toBe(false);
  });

  it("reintenta con backoff exponencial", async () => {
    await enqueueJob(db, { type: "flaky", nextRunAt: new Date(Date.now()).toISOString() });

    let nowMs = Date.now();
    const processor = new JobProcessor({ db, now: () => new Date(nowMs), retryDelayMs: 1000 });
    let calls = 0;
    processor.register("flaky", () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("boom");
      }
    });

    // Attempt 1: fails and stays pending for later.
    expect(await processor.runOnce()).toBe(true);
    let job = await readJob("flaky");
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBe("boom");
    const firstDelay = Date.parse(job.next_run_at) - Date.now();
    expect(firstDelay).toBeGreaterThan(0);
    expect(firstDelay).toBeLessThanOrEqual(1500);

    // Not ready yet: it is not claimed before its time.
    expect(await processor.runOnce()).toBe(false);

    // Attempt 2: the delay grows (exponential backoff).
    nowMs = Date.parse(job.next_run_at);
    expect(await processor.runOnce()).toBe(true);
    job = await readJob("flaky");
    const secondDelay = Date.parse(job.next_run_at) - Date.now();
    expect(job.attempts).toBe(2);
    expect(secondDelay).toBeGreaterThan(firstDelay);

    // Attempt 3: success.
    nowMs = Date.parse(job.next_run_at);
    expect(await processor.runOnce()).toBe(true);
    expect((await readJob("flaky")).status).toBe("done");
    expect(calls).toBe(3);
  });

  it("marca failed al agotar max_attempts", async () => {
    await enqueueJob(db, { type: "dead", nextRunAt: new Date(Date.now()).toISOString(), maxAttempts: 2 });

    let nowMs = Date.now();
    const processor = new JobProcessor({ db, now: () => new Date(nowMs), retryDelayMs: 1000 });
    processor.register("dead", () => {
      throw new Error("siempre falla");
    });

    expect(await processor.runOnce()).toBe(true);
    let job = await readJob("dead");
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);

    nowMs = Date.parse(job.next_run_at);
    expect(await processor.runOnce()).toBe(true);
    job = await readJob("dead");
    expect(job.attempts).toBe(2);
    expect(job.status).toBe("failed");
  });

  it("recupera un lease expirado marcando el trabajo como recuperado", async () => {
    await enqueueJob(db, { type: "interrupted", nextRunAt: iso(BASE) });
    // A worker claims the job with a short lease and "dies" without completing it.
    const leased = await claimNextJob(db, iso(BASE), 1000);
    expect(leased?.id).toBe((await readJob("interrupted")).id);
    expect((await readJob("interrupted")).status).toBe("leased");

    const seen: boolean[] = [];
    const processor = new JobProcessor({ db, now: () => new Date(BASE + 2000) });
    processor.register("interrupted", (_job, context) => {
      seen.push(context.recovered);
    });

    expect(await processor.runOnce()).toBe(true);
    // The handler knows it is an interrupted job and must inspect the state.
    expect(seen).toEqual([true]);
    expect((await readJob("interrupted")).status).toBe("done");
  });

  it("inspecciona leases interrumpidos con el recovery handler, sin re-ejecutar", async () => {
    await enqueueJob(db, { type: "recoverable", nextRunAt: iso(BASE) });
    await claimNextJob(db, iso(BASE), 1000);

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
    expect((await readJob("recoverable")).status).toBe("done");
  });

  it("reencola un lease interrumpido cuando la inspección lo pide", async () => {
    await enqueueJob(db, { type: "requeue-me", nextRunAt: iso(BASE) });
    await claimNextJob(db, iso(BASE), 1000);

    const processor = new JobProcessor({
      db,
      now: () => new Date(BASE + 2000),
      retryDelayMs: 500,
    });
    processor.registerRecovery("requeue-me", () => "requeue");

    expect(await processor.recoverExpiredLeases()).toBe(1);
    const job = await readJob("requeue-me");
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.last_error).toContain("Lease expirado");
  });
});
