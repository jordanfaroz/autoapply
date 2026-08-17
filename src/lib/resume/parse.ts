import "server-only";

import { callClaudeJson, type ClaudeUsage } from "@/lib/claude/client";
import type {
  CertificationEntry,
  EducationEntry,
  ExperienceEntry,
} from "@/lib/db/schema";

/**
 * Claude touchpoint 1 of 4 — resume text to structured profile.
 *
 * Only the fields that genuinely appear on a resume are parsed here. Notice period,
 * CTC, preferred locations, work mode, relocation and total experience are entered
 * by hand in the profile editor; the model is never asked to guess them.
 */

export type ParsedResume = {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  summary: string | null;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: CertificationEntry[];
};

const SYSTEM_PROMPT = `You extract structured data from resumes.

You will be given the raw text of one resume. Return a single JSON object and nothing
else — no prose, no markdown fence, no explanation.

Schema:
{
  "name": string | null,
  "email": string | null,
  "phone": string | null,
  "location": string | null,          // city / city+country as written
  "summary": string | null,           // the candidate's own summary or objective;
                                      // if absent, null — do not compose one
  "skills": string[],                 // individual skills, deduplicated
  "experience": [
    {
      "company": string,
      "title": string,
      "from": string,                 // as written on the resume, e.g. "Mar 2021"
      "to": string,                   // as written, or "Present"
      "highlights": string[]          // bullet points, verbatim, lightly de-hyphenated
    }
  ],
  "education": [
    { "institution": string, "degree": string, "field": string | null,
      "from": string | null, "to": string | null }
  ],
  "certifications": [
    { "name": string, "issuer": string | null, "year": string | null }
  ]
}

Rules:
- Ground every value in the resume text. Never infer, embellish, or fill gaps from
  general knowledge. If something is not stated, use null (scalars) or [] (arrays).
- Keep the candidate's own wording for highlights and summary. Fix only line-break
  artefacts from PDF extraction (split words, stray hyphens).
- Order experience newest first.
- Do not compute totals, seniority levels, or years of experience.`;

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== "null" ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((v): v is string => v !== null);
}

function asExperience(value: unknown): ExperienceEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const entry = raw as Record<string, unknown>;
    const company = asString(entry.company);
    const title = asString(entry.title);
    if (!company && !title) return [];
    return [
      {
        company: company ?? "",
        title: title ?? "",
        from: asString(entry.from) ?? "",
        to: asString(entry.to) ?? "",
        highlights: asStringArray(entry.highlights),
      },
    ];
  });
}

function asEducation(value: unknown): EducationEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const entry = raw as Record<string, unknown>;
    const institution = asString(entry.institution);
    const degree = asString(entry.degree);
    if (!institution && !degree) return [];
    return [
      {
        institution: institution ?? "",
        degree: degree ?? "",
        field: asString(entry.field) ?? undefined,
        from: asString(entry.from) ?? undefined,
        to: asString(entry.to) ?? undefined,
      },
    ];
  });
}

function asCertifications(value: unknown): CertificationEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const entry = raw as Record<string, unknown>;
    const name = asString(entry.name);
    if (!name) return [];
    return [
      {
        name,
        issuer: asString(entry.issuer) ?? undefined,
        year: asString(entry.year) ?? undefined,
      },
    ];
  });
}

/**
 * Coerces whatever Claude returned into the exact shape the profile expects.
 * Anything unrecognised is dropped rather than allowed to reach the database.
 */
export function coerceParsedResume(raw: unknown): ParsedResume {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;

  return {
    name: asString(obj.name),
    email: asString(obj.email),
    phone: asString(obj.phone),
    location: asString(obj.location),
    summary: asString(obj.summary),
    skills: asStringArray(obj.skills),
    experience: asExperience(obj.experience),
    education: asEducation(obj.education),
    certifications: asCertifications(obj.certifications),
  };
}

export async function parseResume(
  resumeText: string,
): Promise<{ parsed: ParsedResume; usage: ClaudeUsage }> {
  const { data, usage } = await callClaudeJson<unknown>({
    label: "resume-parse",
    system: SYSTEM_PROMPT,
    user: `<resume>\n${resumeText}\n</resume>`,
    // Straight extraction — thinking adds latency without improving fidelity here.
    thinking: false,
    effort: "medium",
  });

  return { parsed: coerceParsedResume(data), usage };
}
