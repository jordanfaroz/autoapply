import type { Page } from "playwright";

import type { SiteId } from "../../lib/sites.ts";

/**
 * The contract every job site implements.
 *
 * Adapters know about URLs, selectors and page flow. They know nothing about the
 * database, Claude, scoring, dedupe or the run log — the engine owns all of that.
 * The traffic is one-way: an adapter receives plain values and returns plain values.
 */

/** What a search-results card gives us, before we open the job itself. */
export type JobStub = {
  /** Canonical listing URL: no tracking parameters, no fragment. */
  externalUrl: string;
  /** The site's own id for this job, when it exposes one. Diagnostics only. */
  externalId: string | null;
  company: string;
  title: string;
  location: string | null;
  salaryText: string | null;
  /** Truncated description from the card. Used as a fallback if the detail page fails. */
  snippet: string | null;
};

/** What the job's own page adds. */
export type JobDetail = {
  jdText: string | null;
  /** Only when the detail page states these more precisely than the card did. */
  salaryText?: string | null;
  location?: string | null;
};

export type SearchCriteria = {
  keywords: string[];
  locations: string[];
  experienceMin: number | null;
  experienceMax: number | null;
};

export type SearchBudget = {
  /** Result pages to walk per keyword/location combination. */
  maxPages: number;
  /** Hard stop on stubs collected, across all combinations. */
  maxJobs: number;
};

export type AdapterContext = {
  page: Page;
  signal: AbortSignal;
  log: (message: string) => void;
  /**
   * Throws if the run has been stopped. Call between page actions so a stop takes
   * effect promptly instead of at the end of a long pagination walk.
   */
  assertActive: () => void;
  /**
   * Call after every navigation. The engine applies the human-pacing delay and runs
   * CAPTCHA / unusual-activity detection, pausing or hard-stopping the run as policy
   * dictates. Keeping the call here but the policy in the engine means a new adapter
   * cannot accidentally skip a guardrail — it can only forget to yield, which shows
   * up immediately as a run that never pauses.
   */
  afterNavigation: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/** One field read from a live screening-question form. */
export type ScreeningQuestion = {
  /** Adapter-internal id used to write the resolved answer back to the right field. */
  fieldId: string;
  /** Visible label/question text, read from the DOM. */
  questionText: string;
  fieldType: "text" | "textarea" | "number" | "choice";
  /** Present only for "choice" fields — the exact option labels the site offers. */
  options?: string[];
};

export type ResolvedAnswer = { fieldId: string; answer: string };

/**
 * What the pipeline hands back once it has tried to resolve every question against
 * the answer bank (and generated a blurb for any free-text pitch field). `ok: false`
 * means at least one question has no confident answer — the adapter must not fill or
 * submit anything and should park the job instead. This is the one rule that keeps
 * "never half-submit a form" true: partial answers never reach the page.
 */
export type QuestionResolution =
  | { ok: true; answers: ResolvedAnswer[]; blurb: string | null }
  | { ok: false; unmapped: ScreeningQuestion[] };

export type ApplyOutcome =
  | { kind: "already_applied" }
  | { kind: "external_redirect"; url: string }
  | { kind: "parked"; questions: ScreeningQuestion[] }
  | {
      kind: "submitted";
      dryRun: boolean;
      answersUsed: Array<{ question: string; answer: string }>;
      blurb: string | null;
    };

export type ApplyOptions = {
  /**
   * When true, the adapter must fill fields (safe — nothing is transmitted by typing
   * into a form) but must never click whatever control actually submits the
   * application. Enforced inside the adapter, right at the click, so the boundary is
   * visible in the diff for every site rather than trusted to a caller.
   */
  dryRun: boolean;
  /**
   * Called once with every question read from a live form. Resolves them against the
   * answer bank and generates a blurb for any free-text pitch field. Returns
   * `ok: false` if anything is left unanswered — the adapter must treat that exactly
   * like a `parked` outcome.
   */
  resolveAnswers: (questions: ScreeningQuestion[]) => Promise<QuestionResolution>;
};

export interface SiteAdapter {
  readonly site: SiteId;

  /** Walks search results and returns candidate jobs. Must not open job pages. */
  listJobs(
    ctx: AdapterContext,
    criteria: SearchCriteria,
    budget: SearchBudget,
  ): Promise<JobStub[]>;

  /** Opens one job page and extracts its full description. */
  fetchDetail(ctx: AdapterContext, stub: JobStub): Promise<JobDetail>;

  /** Opens one job page and applies to it, or reports why it could not. */
  apply(
    ctx: AdapterContext,
    job: { externalUrl: string },
    opts: ApplyOptions,
  ): Promise<ApplyOutcome>;
}

/**
 * Thrown when a selector that must match finds nothing — meaning the site changed
 * shape under us. Distinct from an ordinary error so the engine can attach a
 * screenshot and tell you the layout moved rather than blaming the network.
 */
export class SelectorError extends Error {
  readonly selector: string;

  constructor(what: string, selector: string) {
    super(
      `Could not find ${what} using "${selector}". The site's markup has probably ` +
        `changed — the selector needs updating in the adapter.`,
    );
    this.name = "SelectorError";
    this.selector = selector;
  }
}

/** Raised by adapters that exist only as stubs. Surfaced to the UI verbatim. */
export class NotImplementedError extends Error {
  constructor(site: string, what: string) {
    super(`${what} is not implemented for ${site} yet.`);
    this.name = "NotImplementedError";
  }
}

/**
 * Raised when the adapter clicked the real submit control (live mode only — this
 * can never happen in dry run) but could not confirm the site accepted it. Distinct
 * from `SelectorError` because a submit click already happened: the caller must not
 * treat this as safe to silently retry, since the site may well have accepted it and
 * a retry would double-apply.
 */
export class SubmitVerificationError extends Error {
  constructor(detail: string) {
    super(`Clicked submit but could not confirm the application went through: ${detail}`);
    this.name = "SubmitVerificationError";
  }
}
