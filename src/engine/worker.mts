import { eq } from "drizzle-orm";
import type { Page } from "playwright";

import { acquireLease, releaseLease, type LeaseKind } from "../lib/browser-lock.ts";
import { SITES, isSiteId, type SiteId } from "../lib/sites.ts";
import { hasAdapter } from "./adapters/index.mts";
import { precheckApply, runApply } from "./apply.mts";
import { closeBrowser, firstPage, openBrowser } from "./browser.mts";
import { closeDb, db, schema } from "./db.mts";
import { checkActiveHours, checkDailyCap } from "./guards.mts";
import { humanScroll } from "./humanize.mts";
import { RunStoppedError, createNavigationGuard } from "./navigation-guard.mts";
import { RunControl, appendError, setStatus, setWorkerPid } from "./runs.mts";
import { precheckScrape, runScrape } from "./scrape.mts";

/**
 * Worker entrypoint. One process per browser session; the Next app never imports
 * Playwright.
 *
 *   node src/engine/worker.mts --kind=login  --site=naukri
 *   node src/engine/worker.mts --kind=scrape --site=naukri --run-id=12
 */

type Args = { kind: LeaseKind; site: SiteId; runId: number | null };

function parseArgs(): Args {
  const map = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([\w-]+)=(.*)$/.exec(arg);
    if (match) map.set(match[1], match[2]);
  }

  const kind = map.get("kind");
  const site = map.get("site");
  const runId = map.get("run-id");

  if (kind !== "login" && kind !== "scrape" && kind !== "apply") {
    throw new Error(`--kind must be login|scrape|apply (got "${kind ?? ""}")`);
  }
  if (!site || !isSiteId(site)) {
    throw new Error(`--site must be a known site id (got "${site ?? ""}")`);
  }
  if (kind !== "login" && !runId) {
    throw new Error(`--run-id is required for a ${kind} run`);
  }

  return { kind, site, runId: runId ? Number(runId) : null };
}

const log = (message: string) =>
  console.log(`[worker ${process.pid}] ${new Date().toISOString()} ${message}`);

// ---------------------------------------------------------------------------
// Login session — open the site, let the user sign in, exit when they close it.
// ---------------------------------------------------------------------------

async function runLogin(site: SiteId): Promise<void> {
  const descriptor = SITES[site];
  log(`opening ${descriptor.displayName} login page`);

  const ctx = await openBrowser();
  const page = await firstPage(ctx);

  await page.goto(descriptor.loginUrl, { waitUntil: "domcontentloaded" }).catch((err) => {
    log(`navigation warning: ${(err as Error).message}`);
  });

  log("browser is open — sign in, then close the window to finish");

  // Resolve when the user closes the last tab or the whole window.
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    ctx.on("close", finish);
    ctx.on("page", (opened) => opened.on("close", () => {
      if (ctx.pages().length === 0) finish();
    }));
    page.on("close", () => {
      if (ctx.pages().length === 0) finish();
    });
  });

  log("login window closed");
}

// ---------------------------------------------------------------------------
// Scrape / apply run
// ---------------------------------------------------------------------------

async function runAutomation(kind: "scrape" | "apply", site: SiteId, runId: number) {
  const control = new RunControl(runId);
  control.start();
  setWorkerPid(runId, process.pid);
  setStatus(runId, "running");

  const descriptor = SITES[site];

  try {
    // --- Guardrails, before the browser is even opened --------------------
    const siteRow = db
      .select()
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.site, site))
      .get();

    if (!siteRow?.enabled) {
      throw new Error(
        `${descriptor.displayName} is not enabled in Settings. Nothing was opened.`,
      );
    }

    const hours = checkActiveHours(site);
    if (!hours.ok) throw new Error(hours.reason);

    if (kind === "apply") {
      const cap = checkDailyCap(site);
      if (!cap.ok) {
        throw new Error(
          `Daily cap reached for ${descriptor.displayName}: ${cap.used}/${cap.cap} today.`,
        );
      }
      log(`daily cap ${cap.used}/${cap.cap}, ${cap.remaining} remaining`);
    }

    // Configuration problems (no keywords, empty profile, missing API key) are worth
    // catching before a browser window opens and the site sees any traffic.
    if (kind === "scrape") precheckScrape(site);
    if (kind === "apply") precheckApply(site);

    // --- Browser ----------------------------------------------------------
    const ctx = await openBrowser();
    const page = await firstPage(ctx);
    if (control.aborted) throw new RunStoppedError();

    const { assertActive, afterNavigation } = createNavigationGuard({
      site,
      page,
      control,
      runId,
      log,
    });

    log(`navigating to ${descriptor.displayName}`);
    await page
      .goto(descriptor.loginUrl, { waitUntil: "domcontentloaded" })
      .catch((err) => appendError(runId, `Navigation warning: ${(err as Error).message}`));

    await humanScroll(page, control.signal);
    assertActive();

    // --- Challenge detection ---------------------------------------------
    await afterNavigation();

    // --- The actual work --------------------------------------------------
    await performWork(kind, site, page, control, runId);

    setStatus(runId, "completed");
    log("completed");
  } catch (err) {
    if (err instanceof RunStoppedError || control.aborted) {
      log("stopped on request");
      // The stopper already set the terminal status; do not overwrite it.
      if (control.reason !== "stopped") setStatus(runId, "stopped");
      return;
    }

    const message = (err as Error).message;
    log(`failed: ${message}`);
    appendError(runId, message);
    setStatus(runId, "failed");
    return;
  } finally {
    control.dispose();
    await closeBrowser();
  }
}

/**
 * The adapter seam: dispatches to the pipeline for this run type. Sites without an
 * adapter refuse loudly rather than reporting a successful run that did nothing.
 */
async function performWork(
  kind: "scrape" | "apply",
  site: SiteId,
  page: Page,
  control: RunControl,
  runId: number,
): Promise<void> {
  const descriptor = SITES[site];

  if (!hasAdapter(site)) {
    throw new Error(
      `No adapter for ${descriptor.displayName} yet. Everything up to this point ` +
        `worked — browser session, guardrails and run plumbing. This site lands in a ` +
        `later build step.`,
    );
  }

  if (kind === "scrape") {
    await runScrape(site, page, control, runId, log);
    return;
  }

  await runApply(site, page, control, runId, log);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  // Next loads .env for its own process and the spawned worker inherits it, but a
  // worker started straight from the command line would not have the key. Loading it
  // here makes both paths behave the same.
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file — Settings surfaces the missing key, and precheckScrape refuses.
  }

  const { kind, site, runId } = parseArgs();

  acquireLease({
    pid: process.pid,
    kind,
    site,
    runId,
    startedAt: new Date().toISOString(),
  });

  // Whatever happens, the lock must not outlive the process.
  const release = () => releaseLease(process.pid);
  process.on("exit", release);
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));

  try {
    if (kind === "login") await runLogin(site);
    else await runAutomation(kind, site, runId!);
  } finally {
    await closeBrowser();
    closeDb();
    release();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    log(`fatal: ${(err as Error).message}`);
    // A run row that exists should not be left looking alive.
    try {
      const { runId } = parseArgs();
      if (runId) {
        appendError(runId, `Worker crashed: ${(err as Error).message}`);
        setStatus(runId, "failed");
      }
    } catch {
      // Argument parsing itself failed — nothing to record against.
    }
    releaseLease(process.pid);
    process.exit(1);
  },
);
