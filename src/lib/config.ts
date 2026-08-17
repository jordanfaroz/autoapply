import path from "node:path";

/**
 * Single source of truth for filesystem layout and tunable constants.
 * Everything here is local-machine only — no cloud, no multi-user.
 */

// ---------------------------------------------------------------------------
// Claude API
// ---------------------------------------------------------------------------

/**
 * Model used for every Claude call (resume parsing, job scoring, screening-question
 * mapping, tailored blurb). Change in one place.
 *
 * Newer options if you want to upgrade later: "claude-sonnet-5", "claude-opus-5".
 */
export const CLAUDE_MODEL = "claude-sonnet-4-6";

/** Max output tokens per Claude call. Non-streaming, so kept under SDK HTTP timeouts. */
export const CLAUDE_MAX_TOKENS = 16_000;

/** Retry policy for 429 / 5xx responses from the Anthropic API. */
export const CLAUDE_RETRY = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
} as const;

// ---------------------------------------------------------------------------
// Filesystem layout
// ---------------------------------------------------------------------------

/** Root for all runtime state. Gitignored. */
export const DATA_DIR = path.join(process.cwd(), "data");

export const DB_PATH = path.join(DATA_DIR, "autoapply.db");

/** Drizzle migration output — committed, not gitignored. */
export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

/** Uploaded resume PDFs. */
export const RESUMES_DIR = path.join(DATA_DIR, "resumes");

/** Screenshots captured when an apply run fails mid-form. */
export const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");

/**
 * Playwright `launchPersistentContext` user-data-dir. Real logged-in sessions
 * live here, which is exactly why it must never be committed.
 */
export const BROWSER_PROFILE_DIR = path.join(DATA_DIR, "browser-profile");

// ---------------------------------------------------------------------------
// Automation guardrails (defaults — overridable per-site in Settings)
// ---------------------------------------------------------------------------

/** Randomised pause between individual page actions. */
export const ACTION_DELAY_MS = { min: 3_000, max: 8_000 } as const;

/** Randomised pause between two applications on the same site. */
export const BETWEEN_APPLICATIONS_DELAY_MS = { min: 30_000, max: 90_000 } as const;

/** Global active-hours window, local time, 24h clock. */
export const DEFAULT_ACTIVE_HOURS = { start: "09:00", end: "21:00" } as const;

/** Jobs scoring below this are archived rather than queued. */
export const DEFAULT_SCORE_THRESHOLD = 70;

/**
 * Scrape budget per run. Deliberately modest: every new job costs a detail-page
 * load plus a Claude scoring call, and a long scrape is exactly the traffic pattern
 * that gets an account flagged. Run again to go deeper.
 */
export const SCRAPE_MAX_PAGES = 3;
export const SCRAPE_MAX_JOBS = 40;

/** Dry-run is ON until explicitly disabled in Settings. Nothing is ever submitted. */
export const DEFAULT_DRY_RUN = true;
