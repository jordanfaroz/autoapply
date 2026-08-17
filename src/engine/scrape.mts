import { and, eq, notInArray } from "drizzle-orm";
import type { Page } from "playwright";

import { scoreJob } from "../lib/claude/score.ts";
import { SCRAPE_MAX_JOBS, SCRAPE_MAX_PAGES } from "../lib/config.ts";
import { dedupeKey as buildDedupeKey } from "../lib/dedupe.ts";
import { getAnthropicKey } from "../lib/env.ts";
import { SITES, type SiteId } from "../lib/sites.ts";
import { getAdapter } from "./adapters/index.mts";
import { SelectorError, type AdapterContext, type JobStub } from "./adapters/types.mts";
import { captureFailureScreenshot } from "./browser.mts";
import { db, schema } from "./db.mts";
import { RunStoppedError, createNavigationGuard } from "./navigation-guard.mts";
import { RunControl, appendError, setCounts } from "./runs.mts";

/**
 * The scrape pipeline: search -> dedupe -> detail -> score -> queue.
 *
 * All policy lives here. The adapter supplies jobs; this module decides what is a
 * duplicate, what gets scored, and what reaches the approve queue. Nothing below is
 * site-specific.
 */

/** Statuses that do not block a same-key job from being recorded again. */
const NON_BLOCKING_STATUSES = ["duplicate", "archived_low_score"] as const;

/** A site changing shape looks the same on every job; stop rather than grind through. */
const MAX_CONSECUTIVE_DETAIL_FAILURES = 3;

/**
 * Everything that can fail before a browser is worth opening. Called by the worker
 * ahead of launch so a misconfiguration costs no page loads and no account exposure.
 */
export function precheckScrape(site: SiteId): void {
  const descriptor = SITES[site];

  const siteRow = db
    .select()
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.site, site))
    .get();

  if (!siteRow?.keywords.length) {
    throw new Error(
      `No search keywords set for ${descriptor.displayName}. Add at least one in ` +
        `Settings (for example "backend engineer") and save before scraping.`,
    );
  }

  const profile = db.select().from(schema.profile).where(eq(schema.profile.id, 1)).get();
  const hasSubstance =
    Boolean(profile?.name) ||
    Boolean(profile?.summary) ||
    (profile?.skills.length ?? 0) > 0 ||
    (profile?.experience.length ?? 0) > 0;

  if (!hasSubstance) {
    throw new Error(
      "Your profile is empty, so nothing could be scored. Upload your resume on the " +
        "Profile page and save it first.",
    );
  }

  if (!getAnthropicKey()) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set, so scraped jobs could not be scored. Copy " +
        ".env.example to .env, add your key, and restart the dev server.",
    );
  }
}

type Classification =
  | { kind: "known" }
  | { kind: "duplicate"; ofJobId: number }
  | { kind: "new" };

/**
 * Dedupe: an identical URL means we already have this exact listing; an identical
 * company+title from any site means the same role reached us twice. The second is
 * recorded rather than dropped so the tracker can show it was seen and why it was
 * skipped.
 */
function classify(stub: JobStub, dedupeKeyValue: string): Classification {
  const byUrl = db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(eq(schema.jobs.externalUrl, stub.externalUrl))
    .get();
  if (byUrl) return { kind: "known" };

  const byKey = db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.dedupeKey, dedupeKeyValue),
        notInArray(schema.jobs.status, [...NON_BLOCKING_STATUSES]),
      ),
    )
    .get();
  if (byKey) return { kind: "duplicate", ofJobId: byKey.id };

  return { kind: "new" };
}

export async function runScrape(
  site: SiteId,
  page: Page,
  control: RunControl,
  runId: number,
  log: (message: string) => void,
  /** Overrides the configured budget. Exists for integration tests. */
  budget: { maxPages: number; maxJobs: number } = {
    maxPages: SCRAPE_MAX_PAGES,
    maxJobs: SCRAPE_MAX_JOBS,
  },
): Promise<void> {
  const adapter = getAdapter(site);

  const siteRow = db
    .select()
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.site, site))
    .get();
  const globalSettings = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.id, 1))
    .get();
  const profile = db.select().from(schema.profile).where(eq(schema.profile.id, 1)).get();

  if (!siteRow || !profile) throw new Error("Settings or profile row is missing.");

  const threshold = globalSettings?.scoreThreshold ?? 70;

  const counts: Record<string, number> = {
    found: 0,
    known: 0,
    duplicates: 0,
    scraped: 0,
    queued: 0,
    archived: 0,
    scoreFailed: 0,
    detailFailed: 0,
  };
  const flush = () => setCounts(runId, counts);

  const { assertActive, afterNavigation } = createNavigationGuard({
    site,
    page,
    control,
    runId,
    log,
  });

  const ctx: AdapterContext = {
    page,
    signal: control.signal,
    log,
    assertActive,
    afterNavigation,
  };

  // --- 1. Search -----------------------------------------------------------
  const criteria = {
    keywords: siteRow.keywords,
    locations: siteRow.locations,
    experienceMin: siteRow.experienceMin,
    experienceMax: siteRow.experienceMax,
  };

  log(
    `searching ${criteria.keywords.length} keyword(s) x ` +
      `${criteria.locations.length || 1} location(s), up to ${budget.maxPages} pages each`,
  );

  const stubs = await adapter.listJobs(ctx, criteria, budget).catch(async (err) => {
      if (err instanceof SelectorError) {
        const shot = await captureFailureScreenshot(page, `${site}-search-selector`);
        throw new Error(
          `${err.message}${shot ? ` A screenshot was saved to ${shot}.` : ""}`,
        );
      }
      throw err;
    });

  counts.found = stubs.length;
  flush();
  log(`found ${stubs.length} listing(s)`);

  // --- 2. Dedupe -----------------------------------------------------------
  const fresh: Array<{ stub: JobStub; dedupeKey: string }> = [];

  for (const stub of stubs) {
    assertActive();
    const key = buildDedupeKey(stub.company, stub.title);
    const verdict = classify(stub, key);

    if (verdict.kind === "known") {
      counts.known++;
      continue;
    }

    if (verdict.kind === "duplicate") {
      db.insert(schema.jobs)
        .values({
          site,
          externalUrl: stub.externalUrl,
          company: stub.company,
          title: stub.title,
          location: stub.location,
          salaryText: stub.salaryText,
          jdText: stub.snippet,
          dedupeKey: key,
          status: "duplicate",
          duplicateOfJobId: verdict.ofJobId,
          discoveredByRunId: runId,
        })
        .run();
      counts.duplicates++;
      continue;
    }

    fresh.push({ stub, dedupeKey: key });
  }

  flush();
  log(
    `${fresh.length} new, ${counts.known} already known, ${counts.duplicates} duplicate(s)`,
  );

  // --- 3. Detail + 4. Score ------------------------------------------------
  let consecutiveDetailFailures = 0;
  let totalCostUsd = 0;

  for (const [index, { stub, dedupeKey }] of fresh.entries()) {
    assertActive();
    log(`[${index + 1}/${fresh.length}] ${stub.title} — ${stub.company}`);

    let jdText = stub.snippet;
    let salaryText = stub.salaryText;
    let location = stub.location;

    try {
      const detail = await adapter.fetchDetail(ctx, stub);
      jdText = detail.jdText ?? stub.snippet;
      salaryText = detail.salaryText ?? stub.salaryText;
      location = detail.location ?? stub.location;
      consecutiveDetailFailures = 0;
    } catch (err) {
      if (err instanceof RunStoppedError) throw err;

      consecutiveDetailFailures++;
      counts.detailFailed++;
      const message = (err as Error).message;
      log(`detail fetch failed: ${message}`);
      appendError(runId, `Could not open "${stub.title}" at ${stub.externalUrl}: ${message}`);

      if (consecutiveDetailFailures >= MAX_CONSECUTIVE_DETAIL_FAILURES) {
        const shot = await captureFailureScreenshot(page, `${site}-detail-selector`);
        flush();
        throw new Error(
          `${consecutiveDetailFailures} job pages in a row could not be read — ` +
            `${SITES[site].displayName} has probably changed its markup, so the adapter ` +
            `needs updating. Stopping rather than scraping jobs with no description.` +
            (shot ? ` A screenshot was saved to ${shot}.` : ""),
        );
      }
      // Fall through: a job with only the card snippet is still worth scoring.
    }

    // Insert before scoring, so a crash or a Claude outage leaves the scraped work
    // on disk in a visible `scraped` state rather than losing it.
    const inserted = db
      .insert(schema.jobs)
      .values({
        site,
        externalUrl: stub.externalUrl,
        company: stub.company,
        title: stub.title,
        location,
        salaryText,
        jdText,
        dedupeKey,
        status: "scraped",
        discoveredByRunId: runId,
      })
      .returning()
      .get();

    counts.scraped++;
    flush();

    try {
      const { score, usage } = await scoreJob(profile, {
        title: stub.title,
        company: stub.company,
        location,
        salaryText,
        jdText,
      });

      totalCostUsd += usage.costUsd ?? 0;

      const status = score.score >= threshold ? "queued" : "archived_low_score";
      db.update(schema.jobs)
        .set({
          matchScore: score.score,
          matchReasoning: score.reasoning,
          status,
          updatedAt: new Date(),
        })
        .where(eq(schema.jobs.id, inserted.id))
        .run();

      if (status === "queued") counts.queued++;
      else counts.archived++;

      log(`scored ${score.score} -> ${status}`);
    } catch (err) {
      if (err instanceof RunStoppedError) throw err;
      counts.scoreFailed++;
      const message = (err as Error).message;
      log(`scoring failed: ${message}`);
      appendError(runId, `Could not score "${stub.title}": ${message}`);
      // The job stays `scraped`: visible, unscored, and re-scorable later.
    }

    flush();
  }

  log(
    `done — ${counts.queued} queued, ${counts.archived} below threshold (${threshold}), ` +
      `Claude cost $${totalCostUsd.toFixed(4)}`,
  );
}
