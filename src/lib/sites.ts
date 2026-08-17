/**
 * Site registry — the only place that knows which sites exist.
 *
 * This is *configuration*, not logic. Selectors, navigation and form handling all
 * live in the per-site adapters (added from step 5 onward). The engine, the DB
 * schema and the UI only ever deal with a `SiteId` string.
 */

export const SITE_IDS = [
  "naukri",
  "hirist",
  "iimjobs",
  "instahyre",
  "linkedin",
] as const;

export type SiteId = (typeof SITE_IDS)[number];

export type SiteRateConfig = {
  /** Max applications submitted per calendar day. */
  dailyApplyCap: number;
  /** Active-hours window (local time, 24h). Overrides the global window. */
  activeHours: { start: string; end: string };
  /** Treat any "unusual activity" interstitial as a hard stop for the rest of the day. */
  hardStopOnUnusualActivity: boolean;
};

export type SiteDescriptor = {
  id: SiteId;
  displayName: string;
  /** Page opened in the visible browser for the one-time manual login. */
  loginUrl: string;
  rateLimits: SiteRateConfig;
  /** False until the adapter is actually implemented; the UI surfaces this. */
  implemented: boolean;
};

const STANDARD_HOURS = { start: "09:00", end: "21:00" };

export const SITES: Record<SiteId, SiteDescriptor> = {
  naukri: {
    id: "naukri",
    displayName: "Naukri",
    loginUrl: "https://www.naukri.com/nlogin/login",
    rateLimits: {
      dailyApplyCap: 30,
      activeHours: STANDARD_HOURS,
      hardStopOnUnusualActivity: false,
    },
    implemented: true,
  },
  hirist: {
    id: "hirist",
    displayName: "Hirist",
    loginUrl: "https://www.hirist.tech/login",
    rateLimits: {
      dailyApplyCap: 30,
      activeHours: STANDARD_HOURS,
      hardStopOnUnusualActivity: false,
    },
    implemented: false,
  },
  iimjobs: {
    id: "iimjobs",
    displayName: "IIMJobs",
    loginUrl: "https://www.iimjobs.com/login",
    rateLimits: {
      dailyApplyCap: 30,
      activeHours: STANDARD_HOURS,
      hardStopOnUnusualActivity: false,
    },
    implemented: false,
  },
  instahyre: {
    id: "instahyre",
    displayName: "Instahyre",
    loginUrl: "https://www.instahyre.com/login/",
    rateLimits: {
      dailyApplyCap: 30,
      activeHours: STANDARD_HOURS,
      hardStopOnUnusualActivity: false,
    },
    implemented: false,
  },
  linkedin: {
    id: "linkedin",
    displayName: "LinkedIn (Easy Apply)",
    loginUrl: "https://www.linkedin.com/login",
    rateLimits: {
      // Deliberately the strictest profile of the five.
      dailyApplyCap: 10,
      activeHours: { start: "10:00", end: "19:00" },
      hardStopOnUnusualActivity: true,
    },
    implemented: false,
  },
};

export const SITE_LIST: SiteDescriptor[] = SITE_IDS.map((id) => SITES[id]);

export function isSiteId(value: string): value is SiteId {
  return (SITE_IDS as readonly string[]).includes(value);
}
