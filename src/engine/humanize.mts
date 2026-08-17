import type { Page } from "playwright";

import { ACTION_DELAY_MS, BETWEEN_APPLICATIONS_DELAY_MS } from "../lib/config.ts";

/**
 * Timing and movement helpers. Every adapter routes its waits through here so the
 * pacing guardrails cannot be bypassed by forgetting them in one site's code.
 */

export function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Abortable sleep. Long pauses must not keep the process alive after a stop
 * request, so every wait in a run should go through this.
 */
export function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** 3–8s pause between individual page actions. */
export function actionDelay(signal: AbortSignal): Promise<void> {
  return sleepUnlessAborted(
    randomInt(ACTION_DELAY_MS.min, ACTION_DELAY_MS.max),
    signal,
  );
}

/** 30–90s pause between two applications on the same site. */
export function betweenApplicationsDelay(signal: AbortSignal): Promise<void> {
  return sleepUnlessAborted(
    randomInt(BETWEEN_APPLICATIONS_DELAY_MS.min, BETWEEN_APPLICATIONS_DELAY_MS.max),
    signal,
  );
}

/**
 * Scrolls the page in irregular steps with short pauses, the way a person skims
 * before deciding to click. Also has the useful side effect of triggering lazy-loaded
 * job cards.
 */
export async function humanScroll(
  page: Page,
  signal: AbortSignal,
  options: { steps?: number } = {},
): Promise<void> {
  const steps = options.steps ?? randomInt(3, 6);

  for (let i = 0; i < steps; i++) {
    if (signal.aborted) return;
    const distance = randomInt(220, 620);
    await page.mouse.wheel(0, distance);
    await sleepUnlessAborted(randomInt(300, 1_100), signal);
  }

  // A small scroll back up is very common and cheap to imitate.
  if (!signal.aborted && Math.random() < 0.4) {
    await page.mouse.wheel(0, -randomInt(120, 320));
    await sleepUnlessAborted(randomInt(250, 700), signal);
  }
}

/** Types with per-character jitter instead of setting the value instantly. */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const locator = page.locator(selector);
  await locator.click();
  for (const char of text) {
    if (signal.aborted) return;
    await locator.type(char, { delay: randomInt(40, 130) });
  }
}
