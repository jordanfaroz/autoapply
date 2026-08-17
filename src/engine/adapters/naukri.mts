import type { Page } from "playwright";

import { normalizeUrl } from "../../lib/dedupe.ts";
import {
  closeDialog,
  extractFormFields,
  fillField,
  findSubmitButton,
  verifySubmitSuccess,
} from "../apply-form.mts";
import { humanScroll } from "../humanize.mts";
import {
  SelectorError,
  SubmitVerificationError,
  type AdapterContext,
  type ApplyOptions,
  type ApplyOutcome,
  type JobDetail,
  type JobStub,
  type SearchBudget,
  type SearchCriteria,
  type SiteAdapter,
} from "./types.mts";

/**
 * Naukri adapter.
 *
 * Every selector below was read off the live site rather than guessed. Two classes
 * of selector are in play and they fail differently:
 *
 *   - Search results use stable, hand-written class names (`srp-jobtuple-wrapper`,
 *     `a.title`, `.expwdth`). These have been in place a long time.
 *   - The job detail page uses CSS-module class names with a build hash appended
 *     (`styles_job-desc-container__txpYf`). The hash changes on every Naukri
 *     deploy, so we match on the readable prefix with `[class*="..."]`. That
 *     survives a redeploy; it does not survive Naukri renaming the component.
 *
 * When a required selector misses we raise `SelectorError`, which the engine turns
 * into a screenshot plus a run failure. Silently scraping zero jobs would be worse
 * than stopping loudly.
 */

const ORIGIN = "https://www.naukri.com";

/** Verified: 20/20 cards on every search page probed. */
const CARD = ".srp-jobtuple-wrapper";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Naukri needs *both* an SEO path segment and the query parameters; the query alone
 * (`/jobs?k=...`) returns no results at all. Verified against the site's own search box.
 *
 * Locations do not combine: `l=bangalore,pune` is silently reduced to the first city,
 * so the engine runs one search per location instead.
 */
export function buildSearchUrl(
  keyword: string,
  location: string | null,
  criteria: Pick<SearchCriteria, "experienceMin">,
  pageNo: number,
): string {
  const slug = location
    ? `${slugify(keyword)}-jobs-in-${slugify(location)}`
    : `${slugify(keyword)}-jobs`;

  const params = new URLSearchParams({ k: keyword });
  if (location) params.set("l", location);

  // Naukri's experience filter takes a single integer "years of experience".
  if (criteria.experienceMin != null && Number.isFinite(criteria.experienceMin)) {
    params.set("experience", String(Math.max(0, Math.round(criteria.experienceMin))));
  }
  // Page 1 carries no pageNo, matching what the site itself produces.
  if (pageNo > 1) params.set("pageNo", String(pageNo));

  return `${ORIGIN}/${slug}?${params.toString()}`;
}

/** Job ids live in the path; everything in the query string is search tracking. */
function canonicalJobUrl(href: string): string {
  try {
    const url = new URL(href, ORIGIN);
    url.search = "";
    url.hash = "";
    return normalizeUrl(url.toString());
  } catch {
    return normalizeUrl(href);
  }
}

type RawCard = {
  id: string | null;
  href: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  snippet: string | null;
  tags: string[];
};

/** One pass over the DOM: cheaper and immune to the list re-rendering mid-read. */
async function readCards(page: Page): Promise<RawCard[]> {
  return page.evaluate((cardSelector) => {
    const text = (root: Element, selector: string): string | null => {
      const node = root.querySelector(selector);
      if (!node) return null;
      // The `title` attribute holds the untruncated value where the site clips text.
      const attr = node.getAttribute("title");
      const value = (attr ?? node.textContent ?? "").replace(/\s+/g, " ").trim();
      return value || null;
    };

    return [...document.querySelectorAll(cardSelector)].map((card) => ({
      id: card.getAttribute("data-job-id"),
      href: card.querySelector("a.title")?.getAttribute("href") ?? null,
      title: text(card, "a.title"),
      company: text(card, "a.comp-name"),
      location: text(card, ".locWdth"),
      // Most listings do not disclose salary; absence here is normal, not a failure.
      salary: text(card, ".sal-wrap"),
      snippet: text(card, ".job-desc"),
      tags: [...card.querySelectorAll(".tags-gt li")]
        .map((li) => (li.textContent ?? "").trim())
        .filter(Boolean),
    }));
  }, CARD);
}

function toStub(raw: RawCard): JobStub | null {
  // A card without a link, title or company is not something we can act on later.
  if (!raw.href || !raw.title || !raw.company) return null;

  const snippet = [raw.snippet, raw.tags.length ? `Skills: ${raw.tags.join(", ")}` : null]
    .filter(Boolean)
    .join("\n");

  return {
    externalUrl: canonicalJobUrl(raw.href),
    externalId: raw.id,
    company: raw.company,
    title: raw.title,
    location: raw.location,
    salaryText: raw.salary,
    snippet: snippet || null,
  };
}

export const naukriAdapter: SiteAdapter = {
  site: "naukri",

  async listJobs(
    ctx: AdapterContext,
    criteria: SearchCriteria,
    budget: SearchBudget,
  ): Promise<JobStub[]> {
    const stubs = new Map<string, JobStub>();

    // No location means one nationwide search rather than none at all.
    const locations = criteria.locations.length > 0 ? criteria.locations : [null];

    outer: for (const keyword of criteria.keywords) {
      for (const location of locations) {
        // Naukri collapses multi-location queries, so each city is its own search.
        const seenOnThisSearch = new Set<string>();

        for (let pageNo = 1; pageNo <= budget.maxPages; pageNo++) {
          ctx.assertActive();
          if (stubs.size >= budget.maxJobs) break outer;

          const url = buildSearchUrl(keyword, location, criteria, pageNo);
          ctx.log(`search "${keyword}"${location ? ` in ${location}` : ""} page ${pageNo}`);

          await ctx.page.goto(url, { waitUntil: "domcontentloaded" });
          await ctx.afterNavigation();

          const appeared = await ctx.page
            .waitForSelector(CARD, { timeout: 30_000 })
            .then(() => true)
            .catch(() => false);

          if (!appeared) {
            // Page 1 with no cards at all means either a broken selector or a search
            // with genuinely no results. Distinguish the two by asking the page.
            if (pageNo === 1) {
              const body = await ctx.page.locator("body").innerText().catch(() => "");
              if (/no jobs found|did not match|0 jobs/i.test(body)) {
                ctx.log(`no results for "${keyword}"${location ? ` in ${location}` : ""}`);
                break;
              }
              throw new SelectorError("any job card on the results page", CARD);
            }
            break;
          }

          // Cards past the fold are lazy-rendered; scrolling is both necessary and
          // the human-looking thing to do.
          await humanScroll(ctx.page, ctx.signal, { steps: 4 });

          const raw = await readCards(ctx.page);
          let added = 0;

          for (const card of raw) {
            const stub = toStub(card);
            if (!stub || stubs.has(stub.externalUrl)) continue;
            if (!seenOnThisSearch.has(stub.externalUrl)) {
              seenOnThisSearch.add(stub.externalUrl);
              added++;
            }
            stubs.set(stub.externalUrl, stub);
            if (stubs.size >= budget.maxJobs) break;
          }

          ctx.log(`page ${pageNo}: ${raw.length} cards, ${added} new (${stubs.size} total)`);

          // Naukri redirects an out-of-range page back to page 1 instead of 404ing.
          // Without this check the walk would re-scrape page 1 until the budget ran out.
          if (added === 0) {
            ctx.log("no new jobs on this page — end of results");
            break;
          }
        }
      }
    }

    return [...stubs.values()];
  },

  async fetchDetail(ctx: AdapterContext, stub: JobStub): Promise<JobDetail> {
    ctx.assertActive();

    await ctx.page.goto(stub.externalUrl, { waitUntil: "domcontentloaded" });
    await ctx.afterNavigation();

    // Hashed CSS-module names: match the readable prefix, not the whole class.
    const JD_BODY = '[class*="JDC__dang-inner-html"]';
    const OTHER_DETAILS = '[class*="other-details"]';

    const body = await ctx.page
      .waitForSelector(JD_BODY, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);

    if (!body) throw new SelectorError("the job description body", JD_BODY);

    await humanScroll(ctx.page, ctx.signal, { steps: 3 });

    const detail = await ctx.page.evaluate(
      ({ jdBody, otherDetails }) => {
        const read = (selector: string): string | null => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const value = ((node as HTMLElement).innerText ?? node.textContent ?? "").trim();
          return value || null;
        };
        return {
          jd: read(jdBody),
          extras: read(otherDetails),
          salary: read('[class*="jhc__salary"]'),
          location: read('[class*="jhc__location"]'),
        };
      },
      { jdBody: JD_BODY, otherDetails: OTHER_DETAILS },
    );

    const jdText = [detail.jd, detail.extras].filter(Boolean).join("\n\n") || null;

    return {
      jdText,
      // "Not Disclosed" is Naukri's placeholder, not a salary.
      salaryText:
        detail.salary && !/not disclosed/i.test(detail.salary) ? detail.salary : null,
      location: detail.location,
    };
  },

  /**
   * Apply to one job.
   *
   * Unlike every other selector in this file, none of the DOM below the initial
   * Apply button has been read off the live site — the build process for this
   * adapter deliberately avoided clicking Apply on a real job to observe it (see the
   * step-7 notes: doing that risks submitting a real application to a real company
   * with no way to undo it). Instead this was built from the operator's own
   * description of Naukri's flow (a confirmation/question step always follows a
   * click, never an instant silent submit) plus generic, site-agnostic form
   * handling in ../apply-form.mts that reads labels and input types rather than
   * guessing class names.
   *
   * The dry-run boundary below is the one place in this file where being wrong is
   * unacceptable, so it is deliberately simple and easy to audit: search this
   * function for `opts.dryRun` and every one of those branches returns *before* any
   * `findSubmitButton`/`.click()` call is reached.
   */
  async apply(
    ctx: AdapterContext,
    job: { externalUrl: string },
    opts: ApplyOptions,
  ): Promise<ApplyOutcome> {
    ctx.assertActive();

    await ctx.page.goto(job.externalUrl, { waitUntil: "domcontentloaded" });
    await ctx.afterNavigation();

    const APPLY_BUTTON = '#apply-button, [class*="apply-button" i]';

    const alreadyApplied = await ctx.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const text = (el?.textContent ?? "").trim().toLowerCase();
      return /already applied|you.?ve applied|^applied\b/.test(text);
    }, APPLY_BUTTON);
    if (alreadyApplied) return { kind: "already_applied" };

    const applyButton = ctx.page.locator(APPLY_BUTTON).first();
    if (!(await applyButton.count())) {
      throw new SelectorError("the Apply button", APPLY_BUTTON);
    }

    const originBefore = new URL(ctx.page.url()).origin;
    await applyButton.click();
    await ctx.afterNavigation();

    // Some listings hand off to the company's own site instead of applying through
    // Naukri. Automating an arbitrary third-party ATS is explicitly out of scope —
    // route it to a human instead of guessing at unfamiliar forms.
    const originAfter = new URL(ctx.page.url()).origin;
    if (originAfter !== originBefore) {
      return { kind: "external_redirect", url: ctx.page.url() };
    }

    const dialog = ctx.page.locator('[role="dialog"], [class*="modal" i], [class*="drawer" i]').first();
    const modalAppeared = await dialog
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!modalAppeared) {
      // No modal and no redirect. The operator described every no-question apply as
      // going through a confirmation step, so this means either the click landed on
      // something unexpected, or — the case that matters — this specific job broke
      // that pattern and the click may have already submitted. Check honestly rather
      // than assume either way.
      const looksApplied = await ctx.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return /applied/i.test((el?.textContent ?? "").trim());
      }, APPLY_BUTTON);

      if (looksApplied) {
        // A submission may have just happened with nothing this tool could have
        // done to stop it once the click landed. Report it plainly; the pipeline
        // logs this loudly and records it exactly like a verified live submission
        // so it is never silently retried.
        return { kind: "submitted", dryRun: false, answersUsed: [], blurb: null };
      }

      throw new SelectorError(
        "a confirmation dialog or screening form after clicking Apply",
        '[role="dialog"]',
      );
    }

    const questions = await extractFormFields(dialog);

    if (questions.length === 0) {
      // A confirmation with nothing to answer. Dry run must not click through it —
      // there is no separate "fill" stage here, the confirm click *is* the submit.
      if (opts.dryRun) {
        await closeDialog(dialog);
        return { kind: "submitted", dryRun: true, answersUsed: [], blurb: null };
      }

      const submit = await findSubmitButton(dialog);
      await submit.click();
      await ctx.afterNavigation();
      if (!(await verifySubmitSuccess(dialog))) {
        throw new SubmitVerificationError(`applying to ${job.externalUrl}`);
      }
      return { kind: "submitted", dryRun: false, answersUsed: [], blurb: null };
    }

    const resolution = await opts.resolveAnswers(questions);
    if (!resolution.ok) {
      await closeDialog(dialog);
      return { kind: "parked", questions: resolution.unmapped };
    }

    for (const question of questions) {
      const answer = resolution.answers.find((a) => a.fieldId === question.fieldId);
      // resolveAnswers returning ok:true is a contract that every question has an
      // answer; if it does not, that is a bug in the caller, not a site-shape issue.
      if (!answer) throw new Error(`No resolved answer for "${question.questionText}".`);
      await fillField(dialog, question, answer.answer);
    }

    const answersUsed = resolution.answers.map((a) => ({
      question: questions.find((q) => q.fieldId === a.fieldId)!.questionText,
      answer: a.answer,
    }));

    if (opts.dryRun) {
      await closeDialog(dialog);
      return { kind: "submitted", dryRun: true, answersUsed, blurb: resolution.blurb };
    }

    const submit = await findSubmitButton(dialog);
    await submit.click();
    await ctx.afterNavigation();
    if (!(await verifySubmitSuccess(dialog))) {
      throw new SubmitVerificationError(`applying to ${job.externalUrl}`);
    }
    return { kind: "submitted", dryRun: false, answersUsed, blurb: resolution.blurb };
  },
};
