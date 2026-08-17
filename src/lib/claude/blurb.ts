/**
 * Claude touchpoint 4 of 4: a short tailored pitch for a free-text "cover letter" /
 * "why should we hire you" field, when a job's apply form has one.
 *
 * Grounded strictly in profile facts — this is prose, not a new source of claims
 * about the candidate, so the same "never invent content" rule from the answer-bank
 * mapping touchpoint applies here to every specific claim in the output.
 *
 * Called only from the worker (src/engine/apply.mts) — relative, extensioned
 * imports, no "server-only", matching score.ts and map-questions.ts.
 */

import type { Profile } from "../db/schema.ts";
import { callClaudeJson, type ClaudeUsage } from "./client.ts";
import { describeProfile } from "./profile-text.ts";

export type BlurbInput = {
  title: string;
  company: string;
  jdText: string | null;
  /** Field's own character limit, when the site states one. */
  maxLength?: number;
};

const SYSTEM_PROMPT = `You write a short pitch for a candidate applying to one specific
job, for a free-text field on a job application ("cover letter", "why should we hire
you", "message to recruiter", or similar).

Return ONLY a JSON object, no prose and no code fence:
{ "blurb": "<string>" }

Rules:
- Every specific claim (a skill, a number of years, a past role, a technology) must
  come directly from the candidate profile below. Do not invent experience,
  credentials, or enthusiasm you cannot ground in the profile.
- Reference the role and company by name, and connect 2-3 concrete points from the
  profile to what the job actually asks for. Generic filler that could apply to any
  job or any candidate is a failure, not a safe default.
- Plain prose, first person, no greeting ("Dear Hiring Manager") and no sign-off —
  this is dropped straight into a form field.
- 3-5 sentences unless a character limit below forces shorter.
- If the job description is thin, write a shorter, more general pitch rather than
  padding with invented specifics.`;

const MAX_JD_CHARS = 8_000;

function coerceBlurb(raw: unknown, maxLength?: number): string {
  const record = (raw ?? {}) as Record<string, unknown>;
  const blurb = typeof record.blurb === "string" ? record.blurb.trim() : "";
  if (!blurb) throw new Error("Claude returned an empty blurb.");
  return maxLength && blurb.length > maxLength ? blurb.slice(0, maxLength).trim() : blurb;
}

export async function generateBlurb(
  profile: Profile,
  job: BlurbInput,
): Promise<{ blurb: string; usage: ClaudeUsage }> {
  const jd = (job.jdText ?? "").trim();

  const { data, usage } = await callClaudeJson<unknown>({
    label: "apply-blurb",
    system: SYSTEM_PROMPT,
    thinking: false,
    effort: "medium",
    maxTokens: 1_500,
    user: [
      "CANDIDATE PROFILE",
      "=================",
      describeProfile(profile),
      "",
      "JOB",
      "===",
      `Title: ${job.title}`,
      `Company: ${job.company}`,
      job.maxLength ? `Field character limit: ${job.maxLength}` : "",
      "",
      "Job description:",
      jd ? jd.slice(0, MAX_JD_CHARS) : "(no description was captured)",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  return { blurb: coerceBlurb(data, job.maxLength), usage };
}
