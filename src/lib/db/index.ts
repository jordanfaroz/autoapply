import "server-only";

import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  BROWSER_PROFILE_DIR,
  DATA_DIR,
  DB_PATH,
  DEFAULT_ACTIVE_HOURS,
  DEFAULT_DRY_RUN,
  DEFAULT_SCORE_THRESHOLD,
  MIGRATIONS_DIR,
  RESUMES_DIR,
  SCREENSHOTS_DIR,
} from "@/lib/config";
import { SITE_LIST } from "@/lib/sites";
import * as schema from "./schema";

export { schema };

function ensureDirs() {
  for (const dir of [DATA_DIR, RESUMES_DIR, SCREENSHOTS_DIR, BROWSER_PROFILE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createDb() {
  ensureDirs();

  const sqlite = new Database(DB_PATH);
  // WAL keeps the UI readable while a long apply/scrape run holds a write txn.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });

  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  seedDefaults(db);

  return db;
}

type Db = ReturnType<typeof createDb>;

/**
 * Seeds the singleton settings row and one row per known site. Idempotent — safe
 * to run on every boot, and it back-fills rows for sites added in later steps.
 */
function seedDefaults(db: Db) {
  db.insert(schema.settings)
    .values({
      id: 1,
      scoreThreshold: DEFAULT_SCORE_THRESHOLD,
      dryRun: DEFAULT_DRY_RUN,
      activeHoursStart: DEFAULT_ACTIVE_HOURS.start,
      activeHoursEnd: DEFAULT_ACTIVE_HOURS.end,
    })
    .onConflictDoNothing()
    .run();

  db.insert(schema.profile).values({ id: 1 }).onConflictDoNothing().run();

  for (const site of SITE_LIST) {
    db.insert(schema.siteSettings)
      .values({
        site: site.id,
        enabled: false,
        dailyApplyCap: site.rateLimits.dailyApplyCap,
        activeHoursStart: site.rateLimits.activeHours.start,
        activeHoursEnd: site.rateLimits.activeHours.end,
      })
      .onConflictDoNothing()
      .run();
  }
}

/**
 * Cached across dev-server hot reloads — otherwise every edit opens a new
 * SQLite handle and re-runs migrations.
 */
const globalForDb = globalThis as unknown as { __autoapplyDb?: Db };

export const db: Db = globalForDb.__autoapplyDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__autoapplyDb = db;
}
