// The hotel's clock. Both hotels are in the Philippines (Asia/Manila, UTC+8, no daylight saving), so every day, "today"
// and time shown by Inquiries and Reminders is the hotel's, never the device's or UTC's: before 8 a.m. local time the
// UTC date is still yesterday (the prototype's bug, docs/MODULES-SPEC.md A.16 item 7).

export const HOTEL_TZ = 'Asia/Manila';
const OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: HOTEL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: HOTEL_TZ, hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: HOTEL_TZ, month: 'short', day: 'numeric' });
const dateYearFmt = new Intl.DateTimeFormat('en-US', { timeZone: HOTEL_TZ, month: 'short', day: 'numeric', year: 'numeric' });

/** The hotel's calendar day of an instant, "2026-10-31". */
export const dayKey = (ms: number): string => dayFmt.format(ms);

/** The first instant (epoch ms) of a hotel day, or NaN for something that is not "YYYY-MM-DD". */
export const dayStart = (key: string): number => (/^\d{4}-\d{2}-\d{2}$/.test(key) ? Date.parse(`${key}T00:00:00Z`) - OFFSET_MS : NaN);

/** The day key n days before (or after, when negative) another one. */
export const addDays = (key: string, n: number): string => dayKey(dayStart(key) + n * DAY_MS);

/** "10:42 AM", in the hotel's time. */
export const clock = (ms: number): string => timeFmt.format(ms);

/** "10:42 AM" for today, "Oct 29, 4:10 PM" for another day (with the year when it is not this year). */
export function when(ms: number, now: number): string {
  if (dayKey(ms) === dayKey(now)) return clock(ms);
  const sameYear = dayKey(ms).slice(0, 4) === dayKey(now).slice(0, 4);
  return `${(sameYear ? dateFmt : dateYearFmt).format(ms)}, ${clock(ms)}`;
}

/** The value of a datetime-local input ("2026-10-31T09:00") for an instant, in the hotel's time. */
export const toInput = (ms: number): string => `${dayKey(ms)}T${new Date(ms + OFFSET_MS).toISOString().slice(11, 16)}`;

/** The instant a datetime-local value means in the hotel's time, or null when it is empty or not a date and time. */
export function fromInput(v: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const ms = Date.parse(`${v}:00Z`) - OFFSET_MS;
  return Number.isFinite(ms) ? ms : null;
}
