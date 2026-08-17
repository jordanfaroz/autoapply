import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

import { BROWSER_PROFILE_DIR, SCREENSHOTS_DIR } from "../lib/config.ts";

/**
 * The one place a browser is launched.
 *
 * Always headed. `launchPersistentContext` against a dedicated user-data-dir means
 * real logged-in sessions survive between runs, which is the entire point — nothing
 * here ever handles credentials.
 */

let context: BrowserContext | null = null;

export async function openBrowser(): Promise<BrowserContext> {
  if (context) return context;

  fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });

  context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    // Non-negotiable: you must be able to see and take over what the tool is doing.
    headless: false,
    viewport: null,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
    // Give slow job boards room before Playwright gives up.
    timeout: 60_000,
  });

  context.setDefaultTimeout(30_000);
  context.setDefaultNavigationTimeout(60_000);

  return context;
}

/** The first tab, creating one if the profile opened with none. */
export async function firstPage(ctx: BrowserContext): Promise<Page> {
  const [existing] = ctx.pages();
  return existing ?? (await ctx.newPage());
}

export async function closeBrowser(): Promise<void> {
  if (!context) return;
  const ctx = context;
  context = null;
  try {
    await ctx.close();
  } catch {
    // Already gone — the user may have closed the window by hand.
  }
}

export function isBrowserOpen(): boolean {
  return context !== null;
}

/**
 * Saves a screenshot for a job that failed mid-form. Returns the path, or null if
 * even the screenshot failed — a failed screenshot must never mask the real error.
 */
export async function captureFailureScreenshot(
  page: Page,
  label: string,
): Promise<string | null> {
  try {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const safe = label.replace(/[^\w.-]+/g, "_").slice(0, 80);
    const file = path.join(SCREENSHOTS_DIR, `${Date.now()}-${safe}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return null;
  }
}
