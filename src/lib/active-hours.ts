/**
 * Active-hours window arithmetic.
 *
 * Plain module — imported by the Next process (to refuse a start) and by the worker
 * (to stop mid-run when the window closes). No server-only, no DB.
 */

/** "09:00" -> 540. Returns null for anything that is not HH:MM. */
export function parseHhMm(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * True when `now` falls inside [start, end) in local time.
 *
 * A window whose end is before its start wraps midnight (22:00–06:00). A window
 * with identical start and end is treated as "always on" rather than "never".
 */
export function isWithinActiveHours(
  start: string,
  end: string,
  now: Date = new Date(),
): boolean {
  const from = parseHhMm(start);
  const to = parseHhMm(end);
  // An unparseable window must not silently block automation forever.
  if (from === null || to === null) return true;
  if (from === to) return true;

  const current = minutesOfDay(now);
  return from < to ? current >= from && current < to : current >= from || current < to;
}

/** Minutes until the window next opens; 0 when it is already open. */
export function minutesUntilOpen(
  start: string,
  end: string,
  now: Date = new Date(),
): number {
  if (isWithinActiveHours(start, end, now)) return 0;

  const from = parseHhMm(start);
  if (from === null) return 0;

  const current = minutesOfDay(now);
  return from > current ? from - current : 24 * 60 - current + from;
}

export function describeWindow(start: string, end: string): string {
  return `${start}–${end} local`;
}
