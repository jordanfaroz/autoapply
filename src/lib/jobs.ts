import "server-only";

import { desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { applications, jobs, type Job, type JobStatus } from "@/lib/db/schema";

/** Reads and the approve/reject transitions for the job tables. */

export type JobRow = Job;

export function countJobsByStatus(): Record<string, number> {
  const rows = db
    .select({ status: jobs.status, n: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.status)
    .all();

  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
}

export function listJobsByStatus(statuses: JobStatus[], limit = 200): JobRow[] {
  return db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, statuses))
    // Best match first; unscored jobs sort last rather than first.
    .orderBy(sql`coalesce(${jobs.matchScore}, -1) desc`, desc(jobs.scrapedAt))
    .limit(limit)
    .all();
}

export function getJob(id: number): JobRow | undefined {
  return db.select().from(jobs).where(eq(jobs.id, id)).get();
}

export type ApplicationSummary = {
  dryRun: boolean;
  answersUsed: Array<{ question: string; answer: string }>;
  blurb: string | null;
  appliedAt: Date;
};

/** The most recent application row for each of the given jobs, keyed by job id. */
export function getLatestApplications(jobIds: number[]): Map<number, ApplicationSummary> {
  if (jobIds.length === 0) return new Map();

  const rows = db
    .select()
    .from(applications)
    .where(inArray(applications.jobId, jobIds))
    .orderBy(desc(applications.appliedAt))
    .all();

  const byJob = new Map<number, ApplicationSummary>();
  for (const row of rows) {
    // Rows arrive newest-first; keep only the first (latest) one seen per job.
    if (!byJob.has(row.jobId)) {
      byJob.set(row.jobId, {
        dryRun: row.dryRun,
        answersUsed: row.answersUsed,
        blurb: row.blurb,
        appliedAt: row.appliedAt,
      });
    }
  }
  return byJob;
}

// ---------------------------------------------------------------------------
// Approve / reject — the only two writes this module exposes
// ---------------------------------------------------------------------------

/**
 * States a job can be approved or rejected *from*. Deliberately excludes the apply
 * lifecycle still in progress (applying/applied/parked_needs_input/manual_apply) and
 * duplicate — those are not decisions you make from the queue. `failed_needs_review`
 * *is* included: that status means the apply flow stopped and left a screenshot for
 * you to check by hand, and re-approving is exactly how you send it back for another
 * attempt once you've verified nothing was half-submitted.
 */
const APPROVABLE_FROM: JobStatus[] = [
  "queued",
  "archived_low_score",
  "scraped",
  "rejected",
  "failed_needs_review",
];
const REJECTABLE_FROM: JobStatus[] = [
  "queued",
  "archived_low_score",
  "scraped",
  "approved",
  "failed_needs_review",
];

export class InvalidTransitionError extends Error {
  constructor(from: JobStatus, action: string) {
    super(`This job is "${from.replace(/_/g, " ")}" and can no longer be ${action} from here.`);
    this.name = "InvalidTransitionError";
  }
}

/**
 * The only path to `approved` in the whole app. Nothing downstream may apply to a
 * job that has not passed through here — that gate lives in the apply flow (step 7),
 * but the status this function writes is what it checks.
 */
export function approveJob(id: number): JobRow {
  const job = getJob(id);
  if (!job) throw new Error(`Job #${id} not found.`);
  if (!APPROVABLE_FROM.includes(job.status)) {
    throw new InvalidTransitionError(job.status, "approved");
  }

  return db
    .update(jobs)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(jobs.id, id))
    .returning()
    .get();
}

export function rejectJob(id: number): JobRow {
  const job = getJob(id);
  if (!job) throw new Error(`Job #${id} not found.`);
  if (!REJECTABLE_FROM.includes(job.status)) {
    throw new InvalidTransitionError(job.status, "rejected");
  }

  return db
    .update(jobs)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(jobs.id, id))
    .returning()
    .get();
}
