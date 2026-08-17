import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";

import { RESUMES_DIR } from "@/lib/config";
import { db } from "@/lib/db";
import { profile } from "@/lib/db/schema";
import type {
  CertificationEntry,
  EducationEntry,
  ExperienceEntry,
  Profile,
  WorkMode,
} from "@/lib/db/schema";

/** The single profile row. Seeded on first boot, so this never returns undefined. */
export function getProfile(): Profile {
  const row = db.select().from(profile).where(eq(profile.id, 1)).get();
  if (!row) throw new Error("Profile row is missing — database was not seeded.");
  return row;
}

export type ProfileInput = {
  // Parsed
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  summary: string | null;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: CertificationEntry[];
  resumeFilePath: string | null;
  resumeFileName: string | null;
  // Manual
  noticePeriod: string | null;
  currentCtc: string | null;
  expectedCtc: string | null;
  preferredLocations: string[];
  workMode: WorkMode | null;
  willingToRelocate: boolean;
  totalExperienceYears: number | null;
};

export function saveProfile(input: ProfileInput) {
  db.update(profile)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(profile.id, 1))
    .run();
}

/**
 * Persists the uploaded PDF next to the database. The file is kept because later
 * steps upload it to job sites — the parsed text alone is not enough.
 *
 * Returns an absolute path; `resumeFileName` keeps the original name for display.
 */
export async function storeResumeFile(
  originalName: string,
  bytes: Uint8Array,
): Promise<{ filePath: string; fileName: string }> {
  await fs.mkdir(RESUMES_DIR, { recursive: true });

  // Keep only the basename, and strip anything that is awkward on disk.
  const safeBase = path
    .basename(originalName)
    .replace(/[^\w.\- ]+/g, "_")
    .slice(-120);
  const fileName = safeBase || "resume.pdf";
  const stamped = `${Date.now()}-${fileName}`;
  const filePath = path.join(RESUMES_DIR, stamped);

  await fs.writeFile(filePath, bytes);
  return { filePath, fileName };
}

/** True when the stored resume is still on disk. Surfaced in the profile UI. */
export async function resumeFileExists(filePath: string | null): Promise<boolean> {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
