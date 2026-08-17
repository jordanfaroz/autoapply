/**
 * Claude touchpoint 2 of 4: score one job against the profile.
 *
 * Imported by the worker as well as by Next, so it uses relative, extensioned
 * imports and keeps its inputs as plain values rather than DB rows.
 */

import type { Profile } from "../db/schema.ts";
import { callClaudeJson, type ClaudeUsage } from "./client.ts";
import { describeProfile } from "./profile-text.ts";

export type ScoreInput = {
  title: string;
  company: string;
  location: string | null;
  salaryText: string | null;
  /** Full JD when we have it, otherwise the search-result snippet. */
  jdText: string | null;
};

export type JobScore = {
  /** 0–100. Higher is a better fit for this specific person. */
  score: number;
  /** Two or three sentences, grounded in the profile and the JD. */
  reasoning: string;
};

const SYSTEM_PROMPT = `You score how well a single job matches one candidate's profile.

Return ONLY a JSON object, no prose and no code fence:
{
  "score": <integer 0-100>,
  "reasoning": "<2-3 sentences>"
}

How to score:
- 85-100  Strong match. Core skills and seniority line up; the candidate would be a
          credible applicant with no stretch.
- 70-84   Good match. Most requirements met, one or two gaps that experience covers.
- 50-69   Partial match. Real overlap, but a significant gap in skills, seniority,
          domain, or location.
- 25-49   Weak match. Mostly mismatched, some transferable overlap.
- 0-24    Not a match. Wrong field, wrong seniority, or a hard requirement the
          candidate plainly does not meet.

Rules:
- Judge only against the profile given. Do not assume skills, tenure, or willingness
  that the profile does not state.
- If the job description is thin or truncated, score on what is actually there and
  say in the reasoning that the description was limited. Do not invent requirements.
- Weigh a hard mismatch (required years of experience the candidate lacks, a location
  they have not listed and will not relocate to, a different profession) heavily.
- The reasoning must cite concrete specifics from both sides — name the skill, the
  years, the location. Never write generic filler.
- Be decisive. A middling score for everything is useless; most jobs should not
  land between 65 and 75.`;

/** Keeps a single long JD from dominating the request. */
const MAX_JD_CHARS = 12_000;

function describeJob(job: ScoreInput): string {
  const jd = (job.jdText ?? "").trim();
  const truncated = jd.length > MAX_JD_CHARS;

  return [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location ?? "not stated"}`,
    `Salary: ${job.salaryText ?? "not stated"}`,
    "",
    "Job description:",
    jd ? jd.slice(0, MAX_JD_CHARS) : "(no description was captured)",
    truncated ? "\n[description truncated]" : "",
  ].join("\n");
}

function coerceScore(raw: unknown): JobScore {
  const record = (raw ?? {}) as Record<string, unknown>;

  const rawScore = record.score;
  const parsed = typeof rawScore === "number" ? rawScore : Number(rawScore);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Claude returned a non-numeric score: ${JSON.stringify(rawScore)}`);
  }

  const reasoning =
    typeof record.reasoning === "string" && record.reasoning.trim()
      ? record.reasoning.trim()
      : "No reasoning returned.";

  return { score: Math.max(0, Math.min(100, Math.round(parsed))), reasoning };
}

export async function scoreJob(
  profile: Profile,
  job: ScoreInput,
): Promise<{ score: JobScore; usage: ClaudeUsage }> {
  const { data, usage } = await callClaudeJson<unknown>({
    label: "job-score",
    system: SYSTEM_PROMPT,
    // Scoring is a judgement call, not extraction — thinking earns its keep here.
    // Thinking tokens count against max_tokens, so leave real headroom: hitting the
    // cap is a hard error, and the answer itself is only a few hundred tokens.
    thinking: true,
    effort: "low",
    maxTokens: 8_000,
    user: [
      "CANDIDATE PROFILE",
      "=================",
      describeProfile(profile),
      "",
      "JOB",
      "===",
      describeJob(job),
    ].join("\n"),
  });

  return { score: coerceScore(data), usage };
}
