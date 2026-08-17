"use server";

import { revalidatePath } from "next/cache";

import {
  updateGlobalSettings,
  updateSiteSettings,
  type SiteSettingsPatch,
} from "@/lib/settings";
import { isSiteId } from "@/lib/sites";

export type ActionResult = { ok: boolean; message: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** "a, b,  c" -> ["a", "b", "c"]; blank entries dropped. */
function csv(formData: FormData, key: string): string[] {
  return str(formData, key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function optionalNumber(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function optionalTime(formData: FormData, key: string): string | null {
  const raw = str(formData, key);
  return raw && TIME_RE.test(raw) ? raw : null;
}

export async function saveGlobalSettings(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const scoreThreshold = Number(str(formData, "scoreThreshold"));
  if (!Number.isFinite(scoreThreshold) || scoreThreshold < 0 || scoreThreshold > 100) {
    return { ok: false, message: "Score threshold must be between 0 and 100." };
  }

  const activeHoursStart = str(formData, "activeHoursStart");
  const activeHoursEnd = str(formData, "activeHoursEnd");
  if (!TIME_RE.test(activeHoursStart) || !TIME_RE.test(activeHoursEnd)) {
    return { ok: false, message: "Active hours must be HH:MM (24-hour)." };
  }

  updateGlobalSettings({
    scoreThreshold: Math.round(scoreThreshold),
    // Absent checkbox === off. Dry-run can only be disabled by an explicit tick.
    dryRun: formData.get("dryRun") === "on",
    activeHoursStart,
    activeHoursEnd,
  });

  revalidatePath("/settings");
  return { ok: true, message: "Global settings saved." };
}

export async function saveSiteSettings(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const site = str(formData, "site");
  if (!isSiteId(site)) {
    return { ok: false, message: `Unknown site "${site}".` };
  }

  const dailyApplyCap = Number(str(formData, "dailyApplyCap"));
  if (!Number.isFinite(dailyApplyCap) || dailyApplyCap < 0) {
    return { ok: false, message: "Daily cap must be a non-negative number." };
  }

  const experienceMin = optionalNumber(formData, "experienceMin");
  const experienceMax = optionalNumber(formData, "experienceMax");
  if (experienceMin !== null && experienceMax !== null && experienceMin > experienceMax) {
    return { ok: false, message: "Minimum experience cannot exceed maximum." };
  }

  const patch: SiteSettingsPatch = {
    enabled: formData.get("enabled") === "on",
    keywords: csv(formData, "keywords"),
    locations: csv(formData, "locations"),
    experienceMin,
    experienceMax,
    salaryFloor: str(formData, "salaryFloor") || null,
    dailyApplyCap: Math.round(dailyApplyCap),
    activeHoursStart: optionalTime(formData, "activeHoursStart"),
    activeHoursEnd: optionalTime(formData, "activeHoursEnd"),
  };

  updateSiteSettings(site, patch);

  revalidatePath("/settings");
  return { ok: true, message: `${site} settings saved.` };
}
