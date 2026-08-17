import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { DB_PATH } from "../lib/config.ts";
import * as schema from "../lib/db/schema.ts";

/**
 * The worker's own SQLite handle. Deliberately separate from the Next process's
 * connection — these are different processes, so sharing a Drizzle singleton is
 * neither possible nor desirable. WAL mode lets the UI keep reading while a run writes.
 */
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
// A run may briefly contend with a UI write; wait rather than fail.
sqlite.pragma("busy_timeout = 10000");

export const db = drizzle(sqlite, { schema });
export { schema };

export function closeDb() {
  try {
    sqlite.close();
  } catch {
    // Already closed, or closed by process teardown.
  }
}
