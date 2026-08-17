import { eq, sql } from "drizzle-orm";

import type { Run, RunStatus } from "../lib/db/schema.ts";
import { db, schema } from "./db.mts";

/**
 * Run bookkeeping and the cooperative control loop.
 *
 * Stop and pause travel through the `runs.status` column rather than OS signals:
 * Windows cannot deliver SIGTERM to a child in a way that lets a handler run, so a
 * signal-based stop would kill the browser mid-form. Polling a column lets the worker
 * finish what it is doing and tear down cleanly. The Next side keeps a hard kill as a
 * fallback for a wedged worker.
 */

const POLL_INTERVAL_MS = 1_000;

export function loadRun(runId: number): Run | undefined {
  return db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
}

export function setStatus(runId: number, status: RunStatus, pausedReason?: string) {
  db.update(schema.runs)
    .set({
      status,
      pausedReason: status === "paused_needs_attention" ? (pausedReason ?? null) : null,
      ...(status === "completed" || status === "failed" || status === "stopped"
        ? { finishedAt: new Date() }
        : {}),
    })
    .where(eq(schema.runs.id, runId))
    .run();
}

export function setWorkerPid(runId: number, pid: number) {
  db.update(schema.runs).set({ workerPid: pid }).where(eq(schema.runs.id, runId)).run();
}

export function appendError(runId: number, message: string) {
  const run = loadRun(runId);
  const errors = [...(run?.errors ?? []), message].slice(-50);
  db.update(schema.runs).set({ errors }).where(eq(schema.runs.id, runId)).run();
}

export function bumpCount(runId: number, key: string, by = 1) {
  const run = loadRun(runId);
  const counts = { ...(run?.counts ?? {}) };
  counts[key] = (counts[key] ?? 0) + by;
  db.update(schema.runs).set({ counts }).where(eq(schema.runs.id, runId)).run();
}

export function setCounts(runId: number, counts: Record<string, number>) {
  db.update(schema.runs).set({ counts }).where(eq(schema.runs.id, runId)).run();
}

/** Cheap status read used by the polling loop. */
function readStatus(runId: number): RunStatus | undefined {
  return db
    .select({ status: schema.runs.status })
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .get()?.status;
}

export type StopReason = "stopped" | "gone" | "finished";

/**
 * Watches `runs.status` for the life of a run and exposes an AbortSignal that every
 * wait in the engine honours.
 */
export class RunControl {
  readonly runId: number;
  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | null = null;
  private stopReason: StopReason | null = null;

  constructor(runId: number) {
    this.runId = runId;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get aborted(): boolean {
    return this.controller.signal.aborted;
  }

  get reason(): StopReason | null {
    return this.stopReason;
  }

  start() {
    this.timer = setInterval(() => {
      const status = readStatus(this.runId);
      if (status === undefined) return this.abort("gone");
      if (status === "running" || status === "paused_needs_attention") return;
      // Anything else means someone else has already concluded this run.
      this.abort(status === "stopped" ? "stopped" : "finished");
    }, POLL_INTERVAL_MS);
    // Do not hold the event loop open just for the poller.
    this.timer.unref?.();
  }

  abort(reason: StopReason) {
    if (this.stopReason) return;
    this.stopReason = reason;
    this.controller.abort();
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Parks the run for manual intervention and waits for the UI to flip it back to
   * `running`. Resolves true when resumed, false when the run was stopped instead.
   */
  async pauseAndAwaitResume(reason: string): Promise<boolean> {
    setStatus(this.runId, "paused_needs_attention", reason);
    appendError(this.runId, `Paused: ${reason}`);

    while (!this.aborted) {
      const status = readStatus(this.runId);
      if (status === "running") return true;
      if (status !== "paused_needs_attention") return false;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return false;
  }
}

/**
 * Marks runs that claim to be active but whose worker process is gone. Called on the
 * Next side at startup; a crashed worker must never leave a run looking alive.
 */
export function staleActiveRuns(): Run[] {
  return db
    .select()
    .from(schema.runs)
    .where(
      sql`${schema.runs.status} in ('queued','running','paused_needs_attention')`,
    )
    .all();
}
