/**
 * Job identity: how we decide two listings are the same job.
 *
 * Shared by the Next app and the worker, so this file stays dependency-free and
 * site-agnostic. Normalisation here is deliberately *conservative* — a false merge
 * silently hides a real job you would have wanted to see, which is a worse failure
 * than showing you the same role twice.
 */

/** Legal-form suffixes only. Never strip words that distinguish two real companies. */
const LEGAL_SUFFIXES =
  /\b(private limited|pvt\s*ltd|pvt|p\s*ltd|limited|ltd|llp|llc|inc|incorporated|corp|corporation|gmbh|plc|co)\b/g;

function baseNormalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    // Punctuation becomes a space rather than vanishing, so "co.ltd" does not
    // collapse into the single token "coltd" and escape suffix stripping.
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompany(company: string): string {
  const stripped = baseNormalise(company).replace(LEGAL_SUFFIXES, " ").replace(/\s+/g, " ").trim();
  // If a company is *only* a legal suffix ("Limited"), keep the original tokens
  // rather than reducing it to an empty string that would match everything.
  return stripped || baseNormalise(company);
}

/**
 * Titles keep their qualifiers. "Engineer (Backend)" and "Engineer (Frontend)" are
 * different jobs, so parenthetical content is normalised, not discarded.
 */
export function normalizeTitle(title: string): string {
  return baseNormalise(title);
}

/** The cross-site identity of a job: normalised company + normalised title. */
export function dedupeKey(company: string, title: string): string {
  return `${normalizeCompany(company)}::${normalizeTitle(title)}`;
}

/**
 * Tracking parameters that job boards append to their own listing links. Leaving
 * these on would defeat the unique index on `jobs.external_url`: the same listing
 * reached from two different search pages would look like two different jobs.
 */
const TRACKING_PARAMS = [
  "src",
  "sid",
  "xp",
  "px",
  "qp",
  "srcpage",
  "trackingid",
  "refid",
  "position",
  "pageno",
  "fftid",
  "seo",
];

/**
 * Canonical URL used for storage and comparison. Adapters should already return a
 * clean URL; this is the generic backstop.
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.protocol = "https:";

    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || TRACKING_PARAMS.includes(lower)) {
        url.searchParams.delete(key);
      }
    }

    // Trailing slash on a path is never meaningful for a listing URL.
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    // Not a parseable URL — hand it back untouched rather than losing the job.
    return rawUrl.trim();
  }
}
