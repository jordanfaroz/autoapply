/**
 * Renders a profile row as plain text for a Claude prompt. Shared by every
 * touchpoint that needs to describe the candidate (job scoring, tailored blurb).
 */

import type { Profile } from "../db/schema.ts";

export function describeProfile(profile: Profile): string {
  const lines: string[] = [];

  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };

  push("Name", profile.name);
  push("Current location", profile.location);
  push("Summary", profile.summary);

  if (profile.totalExperienceYears != null) {
    lines.push(`Total experience: ${profile.totalExperienceYears} years`);
  }
  if (profile.skills.length) lines.push(`Skills: ${profile.skills.join(", ")}`);

  if (profile.experience.length) {
    lines.push("Experience:");
    for (const entry of profile.experience) {
      lines.push(`  - ${entry.title} at ${entry.company} (${entry.from} to ${entry.to})`);
      for (const highlight of entry.highlights.slice(0, 4)) {
        lines.push(`      ${highlight}`);
      }
    }
  }

  if (profile.education.length) {
    lines.push("Education:");
    for (const entry of profile.education) {
      const field = entry.field ? `, ${entry.field}` : "";
      lines.push(`  - ${entry.degree}${field} — ${entry.institution}`);
    }
  }

  if (profile.certifications.length) {
    lines.push(`Certifications: ${profile.certifications.map((c) => c.name).join(", ")}`);
  }

  push("Notice period", profile.noticePeriod);
  push("Current CTC", profile.currentCtc);
  push("Expected CTC", profile.expectedCtc);
  if (profile.preferredLocations.length) {
    lines.push(`Preferred locations: ${profile.preferredLocations.join(", ")}`);
  }
  push("Preferred work mode", profile.workMode);
  lines.push(`Willing to relocate: ${profile.willingToRelocate ? "yes" : "no"}`);

  return lines.join("\n");
}
