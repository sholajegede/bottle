/**
 * When a bottle goes out.
 *   --in 90s | 10m | 2h | 3d | 1w   a time from now
 *   --at 2026-10-16T09:00            a date and time (local time unless it has a zone)
 *   --at 09:00                       today at that time, or tomorrow if it has passed
 */
const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

export function parseIn(text: string, now = new Date()): Date {
  const parts = [...text.trim().toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*([smhdw])/g)];
  const joined = parts.map((p) => p[0].replace(/\s+/g, "")).join("");
  if (parts.length === 0 || joined !== text.trim().toLowerCase().replace(/\s+/g, "")) {
    throw new Error(`"${text}" is not a time from now. Use a number and a unit, for example 90s, 10m, 2h, 3d or 1h30m.`);
  }
  const seconds = parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNITS[unit], 0);
  return new Date(+now + seconds * 1000);
}

export function parseAt(text: string, now = new Date()): Date {
  const clock = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (clock) {
    const date = new Date(now);
    date.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    if (+date <= +now) date.setDate(date.getDate() + 1);
    return date;
  }
  const date = new Date(text.trim());
  if (Number.isNaN(+date)) throw new Error(`"${text}" is not a date. Use 2026-10-16T09:00 or 09:00.`);
  return date;
}

export function fromNow(date: Date, now = new Date()): string {
  const seconds = Math.round((+date - +now) / 1000);
  if (seconds <= 0) return "now";
  if (seconds < 90) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}
