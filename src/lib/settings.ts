import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings, siteSettings } from "@/lib/db/schema";
import type { Settings, SiteSettings } from "@/lib/db/schema";
import { SITE_LIST, type SiteDescriptor, type SiteId } from "@/lib/sites";

/** The global settings row. Seeded on first boot, so this never returns undefined. */
export function getGlobalSettings(): Settings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) {
    throw new Error("Global settings row is missing — database was not seeded.");
  }
  return row;
}

export type SiteSettingsView = SiteSettings & { descriptor: SiteDescriptor };

/** Per-site settings joined with the static site descriptor, in registry order. */
export function getSiteSettings(): SiteSettingsView[] {
  const rows = db.select().from(siteSettings).all();
  const bySite = new Map(rows.map((r) => [r.site, r]));

  return SITE_LIST.flatMap((descriptor) => {
    const row = bySite.get(descriptor.id);
    return row ? [{ ...row, descriptor }] : [];
  });
}

export type GlobalSettingsPatch = {
  scoreThreshold: number;
  dryRun: boolean;
  activeHoursStart: string;
  activeHoursEnd: string;
};

export function updateGlobalSettings(patch: GlobalSettingsPatch) {
  db.update(settings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(settings.id, 1))
    .run();
}

export type SiteSettingsPatch = {
  enabled: boolean;
  keywords: string[];
  locations: string[];
  experienceMin: number | null;
  experienceMax: number | null;
  salaryFloor: string | null;
  dailyApplyCap: number;
  activeHoursStart: string | null;
  activeHoursEnd: string | null;
};

export function updateSiteSettings(site: SiteId, patch: SiteSettingsPatch) {
  db.update(siteSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(siteSettings.site, site))
    .run();
}

/**
 * Resolves the active-hours window for a site: its own override if set,
 * otherwise the global window. Used by the engine before every action.
 */
export function resolveActiveHours(site: SiteId): { start: string; end: string } {
  const global = getGlobalSettings();
  const row = db.select().from(siteSettings).where(eq(siteSettings.site, site)).get();

  return {
    start: row?.activeHoursStart ?? global.activeHoursStart,
    end: row?.activeHoursEnd ?? global.activeHoursEnd,
  };
}
