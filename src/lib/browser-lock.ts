import fs from "node:fs";
import path from "node:path";

import { DATA_DIR } from "./config.ts";

/**
 * Chromium takes an exclusive lock on its user-data-dir, so exactly one worker
 * process may drive the browser at a time. This file is how the Next process and
 * the workers agree on who that is — it survives dev-server restarts, which an
 * in-memory map would not.
 *
 * Plain module: imported by the Next process AND by the worker (relative path),
 * so it must not import `server-only`.
 */

export const LOCK_PATH = path.join(DATA_DIR, "browser.lock");

export type LeaseKind = "login" | "scrape" | "apply";

export type BrowserLease = {
  pid: number;
  kind: LeaseKind;
  site: string;
  runId: number | null;
  startedAt: string;
};

export function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readRaw(): BrowserLease | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) as BrowserLease;
    return typeof parsed?.pid === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/** The current lease, or null when there is none or the holder has died. */
export function readLease(): BrowserLease | null {
  const lease = readRaw();
  if (!lease) return null;
  if (!isProcessAlive(lease.pid)) return null;
  return lease;
}

/** Removes a lock left behind by a crashed worker. Returns true if it cleared one. */
export function clearStaleLease(): boolean {
  const lease = readRaw();
  if (!lease || isProcessAlive(lease.pid)) return false;
  try {
    fs.rmSync(LOCK_PATH, { force: true });
    return true;
  } catch {
    return false;
  }
}

export class BrowserBusyError extends Error {
  readonly holder: BrowserLease;

  constructor(holder: BrowserLease) {
    super(
      `The browser is already in use by a ${holder.kind} session on ${holder.site} ` +
        `(pid ${holder.pid}). Finish or stop it first.`,
    );
    this.name = "BrowserBusyError";
    this.holder = holder;
  }
}

/**
 * Atomically claims the browser. Throws `BrowserBusyError` when a live worker
 * already holds it; silently reclaims a lock whose owner has died.
 */
export function acquireLease(lease: BrowserLease): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // "wx" fails if the file exists — this is the atomic part.
      const fd = fs.openSync(LOCK_PATH, "wx");
      fs.writeSync(fd, JSON.stringify(lease, null, 2));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      const holder = readLease();
      if (holder) throw new BrowserBusyError(holder);

      // Stale lock from a crashed worker — clear it and try once more.
      clearStaleLease();
    }
  }

  const holder = readLease();
  if (holder) throw new BrowserBusyError(holder);
  throw new Error("Could not acquire the browser lock.");
}

/** Releases the lease, but only if this process still owns it. */
export function releaseLease(pid: number): void {
  const lease = readRaw();
  if (lease && lease.pid !== pid) return;
  try {
    fs.rmSync(LOCK_PATH, { force: true });
  } catch {
    // Nothing useful to do — the next acquire will treat it as stale.
  }
}
