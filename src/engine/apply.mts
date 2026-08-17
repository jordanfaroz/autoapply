import { and, eq, sql } from "drizzle-orm";
import type { Page } from "playwright";

import { generateBlurb } from "../lib/claude/blurb.ts";
import {
  mapQuestionsToAnswers,
  type AnswerBankSnapshot,
  type QuestionToMap,
} from "../lib/claude/map-questions.ts";
import { getAnthropicKey } from "../lib/env.ts";
import { normalizeQuestion } from "../lib/questions.ts";
import { SITES, type SiteId } from "../lib/sites.ts";
import { getAdapter } from "./adapters/index.mts";
import {
  SelectorError,
  SubmitVerificationError,
  type AdapterContext,
  type ApplyOutcome,
  type QuestionResolution,
  type ScreeningQuestion,
} from "./adapters/types.mts";
import { captureFailureScreenshot } from "./browser.mts";
import { db, schema } from "./db.mts";
import { checkDailyCap } from "./guards.mts";
import { betweenApplicationsDelay } from "./humanize.mts";
import { RunStoppedError, createNavigationGuard } from "./navigation-guard.mts";
import { RunControl, appendError, setCounts } from "./runs.mts";

/**
 * The apply pipeline: pulls jobs already `approved` in the queue, resolves their
 * screening questions against the answer bank (Claude touchpoint 3), generates a
 * tailored blurb for any free-text pitch field (touchpoint 4), and hands the result
 * to the adapter to fill and — outside dry run — submit.
 *
 * The approve gate is enforced here, not trusted from upstream: the query below is
 * the only place that decides what an apply run may touch, and it is hardcoded to
 * `status = 'approved'`.
 */

/** A site changing shape looks the same on every job; stop rather than grind through. */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Free-text fields whose label matches this are treated as a pitch/cover-letter
 * prompt (Claude touchpoint 4) rather than an ordinary screening question resolved
 * against the answer bank. Site-agnostic on purpose — every adapter's extracted
 * questions pass through the same classification.
 */
const BLURB_LABEL_PATTERN =
  /cover letter|why (should|do) (you|we)|why are you (a good fit|interested)|tell us (about yourself|why)|additional information|message to (the )?(recruiter|hr|employer)|anything else you.?d like|pitch|about yourself/i;

function isBlurbField(question: ScreeningQuestion): boolean {
  return question.fieldType === "textarea" && BLURB_LABEL_PATTERN.test(question.questionText);
}

export function precheckApply(site: SiteId): void {
  const descriptor = SITES[site];

  const approvedCount = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.site, site), eq(schema.jobs.status, "approved")))
    .get()?.n ?? 0;

  if (approvedCount === 0) {
    throw new Error(
      `No approved jobs for ${descriptor.displayName}. Approve at least one in the ` +
        `Queue before starting an apply run.`,
    );
  }

  if (!getAnthropicKey()) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set, so screening questions could not be mapped. " +
        "Copy .env.example to .env, add your key, and restart the dev server.",
    );
  }
}

/**
 * A worker that crashes mid-apply leaves its job at `applying`. Only one worker can
 * hold the browser lease at a time, so any job still `applying` when a *new* apply
 * run starts for this site is unambiguously stale — the run that set it never
 * finished. It is flagged for manual review rather than retried automatically: the
 * crash could have happened on either side of the real submit click, and guessing
 * wrong risks a duplicate application.
 */
export function recoverStaleApplying(site: SiteId): number {
  const stale = db
    .select({ id: schema.jobs.id, title: schema.jobs.title })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.site, site), eq(schema.jobs.status, "applying")))
    .all();

  for (const job of stale) {
    db.update(schema.jobs)
      .set({
        status: "failed_needs_review",
        failureReason:
          "Left in-progress by a run that did not finish cleanly (crash or a hard " +
          "stop mid-apply). Check this job on the site directly before re-approving " +
          "— re-approving without checking risks a duplicate application.",
        updatedAt: new Date(),
      })
      .where(eq(schema.jobs.id, job.id))
      .run();
  }

  return stale.length;
}

type ApprovedJob = typeof schema.jobs.$inferSelect;

function loadApprovedJobs(site: SiteId): ApprovedJob[] {
  return db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.site, site), eq(schema.jobs.status, "approved")))
    .orderBy(sql`coalesce(${schema.jobs.matchScore}, -1) desc`, schema.jobs.scrapedAt)
    .all();
}

export async function runApply(
  site: SiteId,
  page: Page,
  control: RunControl,
  runId: number,
  log: (message: string) => void,
): Promise<void> {
  const descriptor = SITES[site];
  const adapter = getAdapter(site);

  const recovered = recoverStaleApplying(site);
  if (recovered > 0) {
    log(
      `${recovered} job(s) were left mid-apply by an earlier run and were moved to ` +
        `failed_needs_review for you to check before re-approving.`,
    );
  }

  const globalSettings = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.id, 1))
    .get();
  const profile = db.select().from(schema.profile).where(eq(schema.profile.id, 1)).get();
  if (!globalSettings || !profile) throw new Error("Settings or profile row is missing.");

  const dryRun = globalSettings.dryRun;
  log(dryRun ? "dry run — nothing will be submitted" : "LIVE — applications will be submitted");

  const { assertActive, afterNavigation } = createNavigationGuard({
    site,
    page,
    control,
    runId,
    log,
  });
  const ctx: AdapterContext = { page, signal: control.signal, log, assertActive, afterNavigation };

  const counts: Record<string, number> = {
    applied: 0,
    dryRunApplied: 0,
    parked: 0,
    alreadyApplied: 0,
    manualApply: 0,
    failed: 0,
    capReached: 0,
  };
  const flush = () => setCounts(runId, counts);

  const jobs = loadApprovedJobs(site);
  log(`${jobs.length} approved job(s) queued for ${descriptor.displayName}`);

  let consecutiveFailures = 0;
  let totalCostUsd = 0;

  for (const [index, job] of jobs.entries()) {
    assertActive();

    const cap = checkDailyCap(site);
    if (!cap.ok) {
      log(`daily cap reached (${cap.used}/${cap.cap}) — stopping for the day`);
      counts.capReached = jobs.length - index;
      break;
    }

    log(`[${index + 1}/${jobs.length}] ${job.title} — ${job.company}`);

    // The one gate that makes "applying" a resumable, non-retryable-by-accident
    // state: from this line until the outcome is handled below, a crash leaves the
    // job here, not silently back in `approved` where a future run would retry it.
    db.update(schema.jobs)
      .set({ status: "applying", updatedAt: new Date() })
      .where(eq(schema.jobs.id, job.id))
      .run();

    const resolveAnswers = async (questions: ScreeningQuestion[]): Promise<QuestionResolution> => {
      const blurbField = questions.find(isBlurbField);
      const ordinary = questions.filter((q) => q !== blurbField);

      const bank: AnswerBankSnapshot = db
        .select({
          id: schema.answerBank.id,
          question: schema.answerBank.question,
          answer: schema.answerBank.answer,
          type: schema.answerBank.type,
        })
        .from(schema.answerBank)
        .all();

      const toMap: QuestionToMap[] = ordinary.map((q) => ({
        id: q.fieldId,
        questionText: q.questionText,
        fieldType: q.fieldType,
        options: q.options,
      }));
      const { results, costUsd } = await mapQuestionsToAnswers(toMap, bank);
      if (costUsd) totalCostUsd += costUsd;

      const unmapped = results.filter((r) => !r.matched);
      let blurb: string | null = null;

      if (blurbField) {
        const { blurb: text, usage } = await generateBlurb(profile, {
          title: job.title,
          company: job.company,
          jdText: job.jdText,
        });
        totalCostUsd += usage.costUsd ?? 0;
        blurb = text;
      }

      if (unmapped.length > 0) {
        return {
          ok: false,
          unmapped: unmapped.map(
            (u) => ordinary.find((q) => q.fieldId === u.id)!,
          ),
        };
      }

      const answers = results
        .filter((r): r is Extract<typeof r, { matched: true }> => r.matched)
        .map((r) => ({ fieldId: r.id, answer: r.answer }));

      return { ok: true, answers, blurb };
    };

    try {
      const outcome = await adapter.apply(ctx, { externalUrl: job.externalUrl }, {
        dryRun,
        resolveAnswers,
      });

      handleOutcome(job, outcome, dryRun, runId, counts, log);
      consecutiveFailures = 0;
    } catch (err) {
      if (err instanceof RunStoppedError) {
        // Leave the job at `applying` — recovered as failed_needs_review by the
        // next apply run's startup check, never silently retried by this one.
        throw err;
      }

      consecutiveFailures++;
      counts.failed++;
      const message = (err as Error).message;
      const shot = await captureFailureScreenshot(page, `${site}-apply-${job.id}`).catch(
        () => null,
      );

      const isSubmitAmbiguous = err instanceof SubmitVerificationError;
      if (isSubmitAmbiguous) {
        // A real click may have gone through. Record it exactly like a genuine
        // submission — unverified, but it counts toward today's cap and the audit
        // trail either way — and flag for manual review rather than ever retrying.
        db.insert(schema.applications)
          .values({ jobId: job.id, dryRun: false, answersUsed: [], blurb: null, runId })
          .run();
      }

      db.update(schema.jobs)
        .set({
          status: "failed_needs_review",
          failureReason: isSubmitAmbiguous
            ? `${message} A submit click was made — verify on ${descriptor.displayName} ` +
              `directly before re-approving, to avoid a duplicate application.`
            : message,
          failureScreenshotPath: shot,
          updatedAt: new Date(),
        })
        .where(eq(schema.jobs.id, job.id))
        .run();

      log(`failed: ${message}`);
      appendError(runId, `"${job.title}" at ${job.externalUrl}: ${message}`);

      if (
        err instanceof SelectorError &&
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
      ) {
        flush();
        throw new Error(
          `${consecutiveFailures} applies in a row failed the same way — ` +
            `${descriptor.displayName} has probably changed its apply flow, so the ` +
            `adapter needs updating. Stopping rather than failing every remaining job.`,
        );
      }
    }

    flush();

    if (index < jobs.length - 1) {
      await betweenApplicationsDelay(control.signal);
    }
  }

  log(
    `done — applied ${counts.applied}, dry-run ${counts.dryRunApplied}, parked ` +
      `${counts.parked}, already applied ${counts.alreadyApplied}, manual ` +
      `${counts.manualApply}, failed ${counts.failed}, Claude cost $${totalCostUsd.toFixed(4)}`,
  );
}

/** Exported for tests: the DB-writing logic for each ApplyOutcome kind, in isolation. */
export function handleOutcome(
  job: ApprovedJob,
  outcome: ApplyOutcome,
  expectedDryRun: boolean,
  runId: number,
  counts: Record<string, number>,
  log: (message: string) => void,
): void {
  const now = new Date();

  switch (outcome.kind) {
    case "already_applied": {
      db.update(schema.jobs)
        .set({ status: "applied", updatedAt: now })
        .where(eq(schema.jobs.id, job.id))
        .run();
      db.insert(schema.applications)
        .values({ jobId: job.id, dryRun: true, answersUsed: [], blurb: null, runId })
        .run();
      counts.alreadyApplied++;
      log("already applied on the site — recorded, nothing submitted");
      return;
    }

    case "external_redirect": {
      db.update(schema.jobs)
        .set({ status: "manual_apply", updatedAt: now })
        .where(eq(schema.jobs.id, job.id))
        .run();
      counts.manualApply++;
      log(`redirects off-site to ${outcome.url} — routed to manual apply`);
      return;
    }

    case "parked": {
      db.transaction((tx) => {
        tx.update(schema.jobs)
          .set({ status: "parked_needs_input", updatedAt: now })
          .where(eq(schema.jobs.id, job.id))
          .run();

        for (const question of outcome.questions) {
          const normalized = normalizeQuestion(question.questionText);
          tx.insert(schema.parkedQuestions)
            .values({
              jobId: job.id,
              questionText: question.questionText,
              questionNormalized: normalized,
            })
            .run();
        }
      });
      counts.parked++;
      log(`parked — ${outcome.questions.length} unanswered question(s)`);
      return;
    }

    case "submitted": {
      db.update(schema.jobs)
        .set({ status: "applied", updatedAt: now })
        .where(eq(schema.jobs.id, job.id))
        .run();
      db.insert(schema.applications)
        .values({
          jobId: job.id,
          dryRun: outcome.dryRun,
          answersUsed: outcome.answersUsed,
          blurb: outcome.blurb,
          runId,
        })
        .run();

      if (outcome.dryRun !== expectedDryRun) {
        // The adapter reported a real submission even though this run was
        // configured for dry run — see the "no confirmation step" branch in
        // naukri.mts's apply(). Surface it loudly; it is not something to hide.
        appendError(
          runId,
          `DRY RUN WAS ON, BUT "${job.title}" APPEARS TO HAVE BEEN SUBMITTED FOR ` +
            `REAL — this job had no confirmation step. Verify on the site directly.`,
        );
        log("*** unexpected real submission during a dry run — see run errors ***");
      }

      if (outcome.dryRun) {
        counts.dryRunApplied++;
        log("dry run — form validated, submit not clicked");
      } else {
        counts.applied++;
        log("applied");
      }
      return;
    }
  }
}

