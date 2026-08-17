"use server";

import { revalidatePath } from "next/cache";

import { ClaudeCallError } from "@/lib/claude/client";
import { ClaudeJsonError } from "@/lib/claude/json";
import { WORK_MODES, type WorkMode } from "@/lib/db/schema";
import { getAnthropicKey } from "@/lib/env";
import { saveProfile, storeResumeFile, type ProfileInput } from "@/lib/profile";
import { PdfExtractionError, extractResumeText } from "@/lib/resume/extract";
import { parseResume, type ParsedResume } from "@/lib/resume/parse";

const MAX_RESUME_BYTES = 15 * 1024 * 1024;

export type ParseResumeResult =
  | {
      ok: true;
      parsed: ParsedResume;
      resumeFilePath: string;
      resumeFileName: string;
      stats: { pages: number; charCount: number; costUsd: number | null };
    }
  | { ok: false; message: string };

/**
 * Extracts text from the uploaded PDF and asks Claude to structure it.
 *
 * Deliberately does NOT write to the profile — the result goes back to the editor
 * for review, and only an explicit Save persists it. The PDF itself IS written to
 * disk, because later steps need the actual file to attach to applications.
 */
export async function parseResumeAction(formData: FormData): Promise<ParseResumeResult> {
  if (!getAnthropicKey()) {
    return {
      ok: false,
      message:
        "ANTHROPIC_API_KEY is not set. Add it to .env and restart the dev server.",
    };
  }

  const file = formData.get("resume");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a PDF file first." };
  }
  if (file.size > MAX_RESUME_BYTES) {
    return {
      ok: false,
      message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 15 MB.`,
    };
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: "Only PDF resumes are supported." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // extractResumeText hands these bytes to pdf.js, which transfers the underlying
  // ArrayBuffer to a worker and detaches it. Keep an independent copy for the write
  // to disk below — reusing `bytes` after extraction throws on a detached buffer.
  const bytesForStorage = bytes.slice();

  let extracted;
  try {
    extracted = await extractResumeText(bytes);
  } catch (err) {
    if (err instanceof PdfExtractionError) return { ok: false, message: err.message };
    throw err;
  }

  let parsed: ParsedResume;
  let costUsd: number | null = null;
  try {
    const result = await parseResume(extracted.text);
    parsed = result.parsed;
    costUsd = result.usage.costUsd;
  } catch (err) {
    if (err instanceof ClaudeJsonError) {
      return {
        ok: false,
        message:
          "Claude's reply was not valid JSON, so nothing was parsed. Try again — " +
          "if it keeps happening the resume text may be unusually formatted.",
      };
    }
    if (err instanceof ClaudeCallError) return { ok: false, message: err.message };
    throw err;
  }

  // Only store the file once we know we got something usable out of it.
  const { filePath, fileName } = await storeResumeFile(file.name, bytesForStorage);

  return {
    ok: true,
    parsed,
    resumeFilePath: filePath,
    resumeFileName: fileName,
    stats: { pages: extracted.pages, charCount: extracted.charCount, costUsd },
  };
}

export type SaveProfileResult = { ok: boolean; message: string };

function isWorkMode(value: unknown): value is WorkMode {
  return typeof value === "string" && (WORK_MODES as readonly string[]).includes(value);
}

export async function saveProfileAction(input: ProfileInput): Promise<SaveProfileResult> {
  if (input.email && !input.email.includes("@")) {
    return { ok: false, message: "That email address does not look right." };
  }
  if (
    input.totalExperienceYears !== null &&
    (!Number.isFinite(input.totalExperienceYears) || input.totalExperienceYears < 0)
  ) {
    return { ok: false, message: "Total experience must be a non-negative number." };
  }

  saveProfile({
    ...input,
    workMode: isWorkMode(input.workMode) ? input.workMode : null,
  });

  revalidatePath("/profile");
  return { ok: true, message: "Profile saved." };
}
