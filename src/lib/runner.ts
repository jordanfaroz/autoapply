import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";
import { desc, eq, inArray } from "drizzle-orm";

import {
  BrowserBusyError,
  isProcessAlive,
  readLease,
  releaseLease,
  type BrowserLease,
} from "@/lib/browser-lock";
import { isWithinActiveHours } from "@/lib/active-hours";
import { db } from "@/lib/db";
import { runs, settings, siteSettings } from "@/lib/db/schema";
import type { Run, RunType } from "@/lib/db/schema";
import { SITES, type SiteId } from "@/lib/sites";

/**
 * Starts, monitors and stops worker processes. The Next process never imports
 * Playwright — it only spawns `src/engine/worker.mts` and reads the `runs` table.
 */

const WORKER_ENTRY = path.join(process.cwd(), "src", "engine", "worker.mts");

const ACTIVE_STATUSES = ["queued", "running", "paused_needs_attention"] as const;

function spawnWorker(args: string[]): number {
  const child = spawn(
    process.execPath,
    [
      // The engine's .ts imports are ESM; silence the reparse notice rather than
      // forcing "type": "module" on the whole project.
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      WORKER_ENTRY,
      ...args,
    ],
    {
      cwd: process.cwd(),
      // Survive a dev-server reload: the browser must not die because a file changed.
      detached: true,
      stdio: "ignore",
      env: process.env,
    },
  );

  child.unref();
  if (!child.pid) throw new Error("Failed to spawn the automation worker.");
  return child.pid;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Marks runs whose worker died without reporting. Without this, a crashed run stays
 * "running" forever and blocks every future start.
 *
 * A run mid-apply is deliberately left as `failed` rather than retried — the spec's
 * rule is that a crash must never turn into a silent double submission.
 */
export function reconcileStaleRuns(): number {
  const active = db
    .select()
    .from(runs)
    .where(inArray(runs.status, [...ACTIVE_STATUSES]))
    .all();

  const stale = active.filter(
    (run) => run.workerPid === null || !isProcessAlive(run.workerPid),
  );

  for (const run of stale) {
    db.update(runs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errors: [
          ...run.errors,
          "Worker process is gone — the run was marked failed on reconciliation. " +
            "Any job left mid-apply stays flagged for review rather than being retried.",
        ],
      })
      .where(eq(runs.id, run.id))
      .run();
  }

  // A lock whose owner has died would otherwise block every future run.
  const lease = readLease();
  if (!lease) releaseLease(-1);

  return stale.length;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * JSON-safe shape of a run.
 *
 * The panel receives this both as a server prop and as a polled API response, so it
 * must serialise identically either way — hence ISO strings rather than `Date`.
 */
export type RunView = {
  id: number;
  type: RunType;
  site: string;
  status: Run["status"];
  counts: Record<string, number>;
  errors: string[];
  dryRun: boolean;
  pausedReason: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export function toRunView(run: Run): RunView {
  return {
    id: run.id,
    type: run.type,
    site: run.site,
    status: run.status,
    counts: run.counts,
    errors: run.errors,
    dryRun: run.dryRun,
    pausedReason: run.pausedReason,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  };
}

export type RunnerStatus = {
  lease: BrowserLease | null;
  activeRun: RunView | null;
  recentRuns: RunView[];
};

export function getStatus(limit = 10): RunnerStatus {
  reconcileStaleRuns();

  const activeRun =
    db
      .select()
      .from(runs)
      .where(inArray(runs.status, [...ACTIVE_STATUSES]))
      .orderBy(desc(runs.startedAt))
      .get() ?? null;

  const recentRuns = db
    .select()
    .from(runs)
    .orderBy(desc(runs.startedAt))
    .limit(limit)
    .all();

  return {
    lease: readLease(),
    activeRun: activeRun ? toRunView(activeRun) : null,
    recentRuns: recentRuns.map(toRunView),
  };
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

export type StartResult =
  | { ok: true; runId: number; pid: number }
  | { ok: false; message: string };

/** Every reason a run may not begin, checked before anything is spawned. */
function preflight(site: SiteId): string | null {
  const descriptor = SITES[site];

  const siteRow = db.select().from(siteSettings).where(eq(siteSettings.site, site)).get();
  if (!siteRow?.enabled) {
    return `${descriptor.displayName} is disabled. Enable it in Settings first.`;
  }

  const global = db.select().from(settings).where(eq(settings.id, 1)).get();
  const start = siteRow.activeHoursStart ?? global?.activeHoursStart ?? "09:00";
  const end = siteRow.activeHoursEnd ?? global?.activeHoursEnd ?? "21:00";
  if (!isWithinActiveHours(start, end)) {
    return `Outside the active-hours window for ${descriptor.displayName} (${start}–${end} local).`;
  }

  const existing = db
    .select()
    .from(runs)
    .where(inArray(runs.status, [...ACTIVE_STATUSES]))
    .get();
  if (existing) {
    return `Run #${existing.id} (${existing.type} on ${existing.site}) is still ${existing.status}. Stop it first.`;
  }

  return null;
}

export function startRun(type: RunType, site: SiteId): StartResult {
  reconcileStaleRuns();

  const blocked = preflight(site);
  if (blocked) return { ok: false, message: blocked };

  const dryRun = db.select().from(settings).where(eq(settings.id, 1)).get()?.dryRun ?? true;

  const run = db
    .insert(runs)
    .values({ type, site, status: "queued", dryRun })
    .returning()
    .get();

  try {
    const pid = spawnWorker([`--kind=${type}`, `--site=${site}`, `--run-id=${run.id}`]);
    db.update(runs).set({ workerPid: pid }).where(eq(runs.id, run.id)).run();
    return { ok: true, runId: run.id, pid };
  } catch (err) {
    db.update(runs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errors: [`Could not start the worker: ${(err as Error).message}`],
      })
      .where(eq(runs.id, run.id))
      .run();
    return { ok: false, message: `Could not start the worker: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Stopping, pausing, resuming
// ---------------------------------------------------------------------------

export type ActionResult = { ok: boolean; message: string };

/**
 * Asks the worker to stop by flipping the status column, then hard-kills it if it
 * has not exited. Cooperative first so a run in the middle of a form gets to tear
 * down cleanly.
 */
export async function stopRun(runId: number): Promise<ActionResult> {
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) return { ok: false, message: `Run #${runId} does not exist.` };

  if (!ACTIVE_STATUSES.includes(run.status as (typeof ACTIVE_STATUSES)[number])) {
    return { ok: false, message: `Run #${runId} is already ${run.status}.` };
  }

  db.update(runs)
    .set({ status: "stopped", finishedAt: new Date(), pausedReason: null })
    .where(eq(runs.id, runId))
    .run();

  if (run.workerPid && isProcessAlive(run.workerPid)) {
    // Give the worker a moment to notice the flag and close the browser itself.
    for (let i = 0; i < 12 && isProcessAlive(run.workerPid); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (isProcessAlive(run.workerPid)) {
      try {
        process.kill(run.workerPid, "SIGKILL");
      } catch {
        // Already gone between the check and the kill.
      }
      releaseLease(run.workerPid);
      return {
        ok: true,
        message: `Run #${runId} stopped (worker did not exit in time and was killed).`,
      };
    }
  }

  return { ok: true, message: `Run #${runId} stopped.` };
}

/** Flips a paused run back to running; the worker is polling for exactly this. */
export function resumeRun(runId: number): ActionResult {
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) return { ok: false, message: `Run #${runId} does not exist.` };
  if (run.status !== "paused_needs_attention") {
    return { ok: false, message: `Run #${runId} is not paused (it is ${run.status}).` };
  }
  if (!run.workerPid || !isProcessAlive(run.workerPid)) {
    db.update(runs)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(runs.id, runId))
      .run();
    return {
      ok: false,
      message: `The worker for run #${runId} is gone, so it cannot be resumed.`,
    };
  }

  db.update(runs)
    .set({ status: "running", pausedReason: null })
    .where(eq(runs.id, runId))
    .run();

  return { ok: true, message: `Run #${runId} resumed.` };
}

// ---------------------------------------------------------------------------
// Login window
// ---------------------------------------------------------------------------

export type LoginResult = { ok: boolean; message: string; pid?: number };

/**
 * Opens the visible browser at a site's login page so you can sign in once. The
 * session lands in the persistent profile and every later run reuses it.
 */
export function openLoginWindow(site: SiteId): LoginResult {
  reconcileStaleRuns();

  const existing = readLease();
  if (existing) {
    return {
      ok: false,
      message: new BrowserBusyError(existing).message,
    };
  }

  const activeRun = db
    .select()
    .from(runs)
    .where(inArray(runs.status, [...ACTIVE_STATUSES]))
    .get();
  if (activeRun) {
    return {
      ok: false,
      message: `Run #${activeRun.id} is ${activeRun.status}. Stop it before opening a login window.`,
    };
  }

  try {
    const pid = spawnWorker([`--kind=login`, `--site=${site}`]);
    return {
      ok: true,
      pid,
      message: `Opening ${SITES[site].displayName}. Sign in, then close the browser window.`,
    };
  } catch (err) {
    return { ok: false, message: `Could not open the browser: ${(err as Error).message}` };
  }
}

/** Used by the login button to reflect "browser is open" without a run row. */
export function getLoginLease(): BrowserLease | null {
  const lease = readLease();
  return lease?.kind === "login" ? lease : null;
}
