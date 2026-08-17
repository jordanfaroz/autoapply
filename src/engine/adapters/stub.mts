import { SITES, type SiteId } from "../../lib/sites.ts";
import { NotImplementedError, type SiteAdapter } from "./types.mts";

/**
 * A placeholder adapter for a site nobody has built real automation for yet.
 *
 * This exists as a real, registered `SiteAdapter` — not just an absent registry
 * entry — so `getAdapter()` is total (every `SiteId` resolves to something) and the
 * failure mode for calling one directly is a clear, site-named error rather than a
 * missing-adapter crash. In normal use this code never runs: `SITES[site].implemented`
 * is `false` for every stub site, which keeps it disabled in Settings and stops
 * `hasAdapter()` short before a run ever opens a browser for it — see worker.mts.
 *
 * Turning a stub into a real adapter means writing a new file like naukri.mts: read
 * the site's live, authenticated DOM and write selectors against what is actually
 * there. Nothing here is a guess at what that site looks like — see the Naukri
 * adapter's own notes for why that discipline matters.
 */
export function createStubAdapter(site: SiteId): SiteAdapter {
  const displayName = SITES[site].displayName;

  const notImplemented = (what: string): never => {
    throw new NotImplementedError(displayName, what);
  };

  return {
    site,
    async listJobs() {
      return notImplemented("Scraping");
    },
    async fetchDetail() {
      return notImplemented("Reading job details");
    },
    async apply() {
      return notImplemented("Applying");
    },
  };
}
