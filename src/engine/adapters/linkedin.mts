import { createStubAdapter } from "./stub.mts";

/**
 * Not built yet — see stub.mts for why, and naukri.mts for what a real one looks like.
 *
 * LinkedIn Easy Apply carries the strictest rate limits of the five sites (see
 * src/lib/sites.ts: 10/day, a narrower active-hours window, and a hard stop on any
 * unusual-activity page) — that policy is already live and enforced by the engine
 * regardless of whether this adapter exists, so it is ready the day this stub is
 * replaced with a real implementation.
 */
export const linkedinAdapter = createStubAdapter("linkedin");
