import type { Page } from "playwright";

import { SITES, type SiteId } from "../lib/sites.ts";
import { detectInterstitial, isHardStop } from "./guards.mts";
import { actionDelay } from "./humanize.mts";
import { bumpCount, type RunControl } from "./runs.mts";

/**
 * Thrown by `assertActive`/`afterNavigation` when the run has been stopped mid-flight.
 * Shared by every run type (scrape, apply) so the worker only needs to catch one type
 * to recognise a clean stop versus a real failure.
 */
export class RunStoppedError extends Error {
  constructor() {
    super("stopped");
    this.name = "RunStoppedError";
  }
}

export type NavigationGuard = {
  assertActive: () => void;
  afterNavigation: () => Promise<void>;
};

/**
 * Shared by every run type: paced delay + CAPTCHA/unusual-activity detection after
 * each navigation. Policy (hard stop vs. pause-and-wait) lives here once, so scrape
 * and apply pipelines behave identically and neither can accidentally skip it.
 */
export function createNavigationGuard(opts: {
  site: SiteId;
  page: Page;
  control: RunControl;
  runId: number;
  log: (message: string) => void;
}): NavigationGuard {
  const { site, page, control, runId, log } = opts;
  const descriptor = SITES[site];

  const assertActive = () => {
    if (control.aborted) throw new RunStoppedError();
  };

  const afterNavigation = async () => {
    assertActive();
    await actionDelay(control.signal);
    assertActive();

    const interstitial = await detectInterstitial(page);
    if (!interstitial) return;

    bumpCount(runId, "interstitials");

    if (isHardStop(site, interstitial)) {
      throw new Error(
        `${descriptor.displayName} showed an unusual-activity page — stopping for the ` +
          `day on this site. Detail: ${interstitial.detail}`,
      );
    }

    log(`interstitial detected (${interstitial.kind}) — pausing for you`);
    const resumed = await control.pauseAndAwaitResume(
      `${interstitial.kind.replace("_", " ")} detected on ${descriptor.displayName}. ` +
        `Solve it in the open browser window, then press Resume. ` +
        `Detail: ${interstitial.detail}`,
    );
    if (!resumed) throw new RunStoppedError();
    log("resumed by user");
  };

  return { assertActive, afterNavigation };
}
