import "server-only";

import { desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { applications, jobs, type JobStatus } from "@/lib/db/schema";
import { getSiteSettings } from "@/lib/settings";
import { SITES, isSiteId, type SiteId } from "@/lib/sites";

/** Reads that back the Tracker and Dashboard pages — application history and activity. */

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export type TrackerStats = {
  total: number;
  live: number;
  dryRun: number;
  today: number;
  parkedOutstanding: number;
  needsReviewOutstanding: number;
};

/**
 * Three plain, typed queries rather than one with a raw CASE-WHEN: interpolating a
 * `Date` into a `sql` template skips Drizzle's column type mapping and better-sqlite3
 * cannot bind a Date object directly. `gte()`/`eq()` go through that mapping correctly.
 */
export function getTrackerStats(): TrackerStats {
  const total = db.select({ n: sql<number>`count(*)` }).from(applications).get()?.n ?? 0;
  const live =
    db
      .select({ n: sql<number>`count(*)` })
      .from(applications)
      .where(eq(applications.dryRun, false))
      .get()?.n ?? 0;
  const today =
    db
      .select({ n: sql<number>`count(*)` })
      .from(applications)
      .where(gte(applications.appliedAt, startOfToday()))
      .get()?.n ?? 0;

  const statusCounts = (statuses: JobStatus[]) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(jobs)
      .where(inArray(jobs.status, statuses))
      .get()?.n ?? 0;

  return {
    total,
    live,
    dryRun: total - live,
    today,
    parkedOutstanding: statusCounts(["parked_needs_input"]),
    needsReviewOutstanding: statusCounts(["failed_needs_review"]),
  };
}

export type SiteActivity = {
  site: SiteId;
  displayName: string;
  enabled: boolean;
  appliedToday: number;
  dailyCap: number;
};

/** Today's application count per site, next to its cap — the guardrail made visible. */
export function getSiteActivityToday(): SiteActivity[] {
  const rows = db
    .select({ site: jobs.site, n: sql<number>`count(*)` })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(gte(applications.appliedAt, startOfToday()))
    .groupBy(jobs.site)
    .all();
  const bySite = new Map(rows.map((r) => [r.site, r.n]));

  return getSiteSettings().map((s) => ({
    site: s.descriptor.id,
    displayName: s.descriptor.displayName,
    enabled: s.enabled,
    appliedToday: bySite.get(s.descriptor.id) ?? 0,
    dailyCap: s.dailyApplyCap,
  }));
}

export type ApplicationRow = {
  id: number;
  jobId: number;
  title: string;
  company: string;
  site: SiteId | string;
  externalUrl: string;
  appliedAt: Date;
  dryRun: boolean;
  answersUsed: Array<{ question: string; answer: string }>;
  blurb: string | null;
};

export function listApplications(limit = 200): ApplicationRow[] {
  return db
    .select({
      id: applications.id,
      jobId: applications.jobId,
      title: jobs.title,
      company: jobs.company,
      site: jobs.site,
      externalUrl: jobs.externalUrl,
      appliedAt: applications.appliedAt,
      dryRun: applications.dryRun,
      answersUsed: applications.answersUsed,
      blurb: applications.blurb,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .orderBy(desc(applications.appliedAt))
    .limit(limit)
    .all();
}

export type ManualApplyRow = {
  id: number;
  title: string;
  company: string;
  site: SiteId | string;
  externalUrl: string;
  updatedAt: Date;
};

/** Jobs routed off-site during apply — outside what this tool automates. */
export function listManualApply(limit = 100): ManualApplyRow[] {
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      site: jobs.site,
      externalUrl: jobs.externalUrl,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .where(eq(jobs.status, "manual_apply"))
    .orderBy(desc(jobs.updatedAt))
    .limit(limit)
    .all();
}

export function siteDisplayName(site: string): string {
  return isSiteId(site) ? SITES[site].displayName : site;
}
