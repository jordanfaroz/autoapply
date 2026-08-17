import { SITES, type SiteId } from "../../lib/sites.ts";
import { hiristAdapter } from "./hirist.mts";
import { iimjobsAdapter } from "./iimjobs.mts";
import { instahyreAdapter } from "./instahyre.mts";
import { linkedinAdapter } from "./linkedin.mts";
import { naukriAdapter } from "./naukri.mts";
import type { SiteAdapter } from "./types.mts";

/**
 * Adapter registry — the only place that maps a site id to its implementation.
 * Total by construction: the `Record<SiteId, SiteAdapter>` type means every site
 * listed in src/lib/sites.ts must resolve to something here, so `getAdapter` can
 * never return undefined and this file cannot silently fall behind that list.
 */

const ADAPTERS: Record<SiteId, SiteAdapter> = {
  naukri: naukriAdapter,
  hirist: hiristAdapter,
  iimjobs: iimjobsAdapter,
  instahyre: instahyreAdapter,
  linkedin: linkedinAdapter,
};

export function getAdapter(site: SiteId): SiteAdapter {
  return ADAPTERS[site];
}

/**
 * Whether a site has a *working* adapter — not just a registered (possibly stub)
 * one. Backed by `SITES[site].implemented`, the same flag Settings and the run
 * panel use, so this stays the single source of truth for "can this site run."
 */
export function hasAdapter(site: SiteId): boolean {
  return SITES[site].implemented;
}
