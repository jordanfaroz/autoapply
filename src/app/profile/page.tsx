import { getApiKeyStatus } from "@/lib/env";
import { getProfile, resumeFileExists, type ProfileInput } from "@/lib/profile";

import { ProfileEditor } from "./profile-editor";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const row = getProfile();
  const apiKey = getApiKeyStatus();
  const resumeOnDisk = await resumeFileExists(row.resumeFilePath);

  // Narrow the DB row to just what the editor owns, so the client bundle never
  // carries ids or timestamps it has no business writing.
  const initial: ProfileInput = {
    name: row.name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    summary: row.summary,
    skills: row.skills,
    experience: row.experience,
    education: row.education,
    certifications: row.certifications,
    resumeFilePath: row.resumeFilePath,
    resumeFileName: row.resumeFileName,
    noticePeriod: row.noticePeriod,
    currentCtc: row.currentCtc,
    expectedCtc: row.expectedCtc,
    preferredLocations: row.preferredLocations,
    workMode: row.workMode,
    willingToRelocate: row.willingToRelocate,
    totalExperienceYears: row.totalExperienceYears,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">
          The single source of truth for job scoring and screening answers.
        </p>
      </div>

      <ProfileEditor
        initial={initial}
        resumeOnDisk={resumeOnDisk}
        apiKeyPresent={apiKey.present}
      />
    </div>
  );
}
