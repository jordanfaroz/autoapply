import { and, eq, gte, sql } from "drizzle-orm";
import type { Page } from "playwright";

import { isWithinActiveHours } from "../lib/active-hours.ts";
import { SITES, type SiteId } from "../lib/sites.ts";
import { db, schema } from "./db.mts";

/**
 * Every check that can stop a run. Kept in the engine, not in adapters, so a new
 * site cannot accidentally opt out of a guardrail.
 */

// ---------------------------------------------------------------------------
// Active hours
// ---------------------------------------------------------------------------

export type WindowCheck =
  | { ok: true; window: { start: string; end: string } }
  | { ok: false; window: { start: string; end: string }; reason: string };

/** Site override wins; otherwise the global window. */
export function resolveWindow(site: SiteId): { start: string; end: string } {
  const global = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.id, 1))
    .get();
  const row = db
    .select()
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.site, site))
    .get();

  return {
    start: row?.activeHoursStart ?? global?.activeHoursStart ?? "09:00",
    end: row?.activeHoursEnd ?? global?.activeHoursEnd ?? "21:00",
  };
}

export function checkActiveHours(site: SiteId, now: Date = new Date()): WindowCheck {
  const window = resolveWindow(site);
  if (isWithinActiveHours(window.start, window.end, now)) return { ok: true, window };

  return {
    ok: false,
    window,
    reason:
      `Outside the active-hours window for ${SITES[site].displayName} ` +
      `(${window.start}–${window.end} local).`,
  };
}

// ---------------------------------------------------------------------------
// Daily apply cap
// ---------------------------------------------------------------------------

function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Applications submitted on this site today. Dry-run applications count too —
 * the cap models "how much did we touch this site", which is the thing that gets
 * an account flagged.
 */
export function appliedToday(site: SiteId, now: Date = new Date()): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.applications)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.applications.jobId))
    .where(
      and(
        eq(schema.jobs.site, site),
        gte(schema.applications.appliedAt, startOfToday(now)),
      ),
    )
    .get();

  return row?.n ?? 0;
}

export function dailyCap(site: SiteId): number {
  const row = db
    .select()
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.site, site))
    .get();
  return row?.dailyApplyCap ?? SITES[site].rateLimits.dailyApplyCap;
}

export type CapCheck = { ok: boolean; used: number; cap: number; remaining: number };

export function checkDailyCap(site: SiteId, now: Date = new Date()): CapCheck {
  const used = appliedToday(site, now);
  const cap = dailyCap(site);
  return { ok: used < cap, used, cap, remaining: Math.max(0, cap - used) };
}

// ---------------------------------------------------------------------------
// CAPTCHA / verification / unusual-activity detection
// ---------------------------------------------------------------------------

export type Interstitial = {
  kind: "captcha" | "verification" | "unusual_activity";
  detail: string;
};

/**
 * Signals that we have been challenged. Deliberately broad and text-based: a false
 * positive costs one paused run that you resume by hand, a false negative risks the
 * account. Erring toward pausing is the right trade.
 */
const SIGNATURES: Array<{ kind: Interstitial["kind"]; pattern: RegExp }> = [
  { kind: "captcha", pattern: /\brecaptcha\b/i },
  { kind: "captcha", pattern: /\bhcaptcha\b/i },
  { kind: "captcha", pattern: /\bcaptcha\b/i },
  { kind: "captcha", pattern: /are you a (human|robot)/i },
  { kind: "captcha", pattern: /i'?m not a robot/i },
  { kind: "captcha", pattern: /press (and|&) hold/i },
  { kind: "verification", pattern: /verify (your|it'?s you|your identity)/i },
  { kind: "verification", pattern: /security check/i },
  { kind: "verification", pattern: /confirm your identity/i },
  { kind: "verification", pattern: /enter the (code|otp) (we )?sent/i },
  { kind: "verification", pattern: /two[- ]step verification/i },
  { kind: "unusual_activity", pattern: /unusual activity/i },
  { kind: "unusual_activity", pattern: /suspicious activity/i },
  { kind: "unusual_activity", pattern: /automated (queries|traffic|behaviou?r)/i },
  { kind: "unusual_activity", pattern: /your account has been (temporarily )?restricted/i },
  { kind: "unusual_activity", pattern: /you'?ve been (rate[- ]?limited|blocked)/i },
  { kind: "unusual_activity", pattern: /too many requests/i },
];

/**
 * Vendors whose presence in an iframe means a challenge is on screen. The bare
 * `captcha` alternative is deliberate — DataDome, for one, serves from
 * captcha-delivery.com with no vendor name in the URL, and an iframe whose src
 * mentions captcha at all is not something a job board loads by accident.
 */
const CHALLENGE_FRAME =
  /recaptcha|hcaptcha|turnstile|arkoselabs|funcaptcha|geetest|datadome|captcha/i;

/** Frames whose URL alone is enough to conclude we hit a challenge. */
const URL_SIGNATURES: Array<{ kind: Interstitial["kind"]; pattern: RegExp }> = [
  { kind: "captcha", pattern: /\/(recaptcha|hcaptcha|challenge)\b/i },
  { kind: "verification", pattern: /\/checkpoint\b/i },
  { kind: "unusual_activity", pattern: /\/(blocked|denied|sorry)\b/i },
];

export async function detectInterstitial(page: Page): Promise<Interstitial | null> {
  try {
    const url = page.url();
    for (const { kind, pattern } of URL_SIGNATURES) {
      if (pattern.test(url)) return { kind, detail: `URL matched ${pattern} (${url})` };
    }

    // A CAPTCHA almost always lives in a cross-origin iframe. Check both the attached
    // frames and the raw src attributes: a frame that has not navigated yet still
    // reports "about:blank", and we may look the instant the challenge is injected.
    const frameUrls = page.frames().map((frame) => frame.url());
    const srcAttributes = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("iframe,frame")).map(
          (el) => el.getAttribute("src") ?? "",
        ),
      )
      .catch(() => [] as string[]);

    for (const candidate of [...frameUrls, ...srcAttributes]) {
      if (CHALLENGE_FRAME.test(candidate)) {
        return { kind: "captcha", detail: `Challenge iframe: ${candidate}` };
      }
    }

    // Only the visible text — matching raw HTML produces constant false positives,
    // because analytics bundles mention "captcha" on pages that have none.
    const text = await page
      .locator("body")
      .innerText({ timeout: 3_000 })
      .catch(() => "");
    const haystack = text.slice(0, 20_000);

    for (const { kind, pattern } of SIGNATURES) {
      const match = pattern.exec(haystack);
      if (match) {
        const start = Math.max(0, match.index - 60);
        return {
          kind,
          detail: haystack.slice(start, match.index + match[0].length + 60).trim(),
        };
      }
    }

    return null;
  } catch {
    // A detached page or navigation mid-check is not a challenge.
    return null;
  }
}

/** LinkedIn's unusual-activity page means stop for the day, not just pause. */
export function isHardStop(site: SiteId, interstitial: Interstitial): boolean {
  return (
    SITES[site].rateLimits.hardStopOnUnusualActivity &&
    interstitial.kind === "unusual_activity"
  );
}
