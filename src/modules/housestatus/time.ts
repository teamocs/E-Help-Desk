// The hotel's clock for House Status and Transport. Every moment is stored as epoch milliseconds; what a person reads,
// and what "today" means, is the hotel's local time (Asia/Manila, UTC+8 all year, no daylight saving), never the UTC
// date and never the device's own zone. The server (Azl_Module_Transport) uses the same zone for a scheduled time.

export const HOTEL_TZ = 'Asia/Manila';
const OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86400_000;

/** "2026-10-31": the hotel's calendar date at this moment. */
export const hotelDate = (ms: number): string => new Date(ms + OFFSET_MS).toISOString().slice(0, 10);

/** "14:00": the hotel's clock time at this moment (24 hours, for time inputs). */
export const hotelTime = (ms: number): string => new Date(ms + OFFSET_MS).toISOString().slice(11, 16);

/** The date n days after (or before) a "YYYY-MM-DD" date. */
export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The moment a hotel-local date ("2026-10-31") and time ("14:00") name, in epoch ms; null when either is not real. */
export function hotelMoment(date: string, time: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], t[1], t[2]].map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi) - OFFSET_MS;
  return hotelDate(ms) === date && hotelTime(ms) === time ? ms : null;
}

// Intl gives the narrow no-break space before AM/PM in newer engines; plain spaces read the same and wrap properly.
const fmt = (o: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: HOTEL_TZ, ...o });
  return (ms: number) => f.format(ms).replace(/[  ]/g, ' ');
};
const clockFmt = fmt({ hour: '2-digit', minute: '2-digit', hour12: true });
const dayFmt = fmt({ month: 'short', day: 'numeric' });
const dayLongFmt = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
const stampFmt = fmt({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

/** "09:50 PM" */
export const clock = (ms: number): string => clockFmt(ms);
/** "Oct 30, 09:50 PM" */
export const stamp = (ms: number): string => stampFmt(ms);
/** "06:00 AM" for today, "Oct 29, 06:00 AM" for another day (relative to `now`). */
export const when = (ms: number, now: number): string => (hotelDate(ms) === hotelDate(now) ? clock(ms) : stamp(ms));
/** "Today", "Tomorrow", "Yesterday" or "Sat, Nov 2". */
export function dayName(ms: number, now: number): string {
  const d = hotelDate(ms), today = hotelDate(now);
  if (d === today) return 'Today';
  if (d === addDays(today, 1)) return 'Tomorrow';
  if (d === addDays(today, -1)) return 'Yesterday';
  return dayLongFmt(ms);
}
/** "Oct 31" */
export const dayShort = (ms: number): string => dayFmt(ms);
