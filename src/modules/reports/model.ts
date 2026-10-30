// Reports: the six report tiles of the client's prototype, the hotel-day date range, number formatting, chart data and
// the REST calls (GET /reports/<id>, the CSV export). The figures are made by the server (Azl_Module_Reports); this
// file only asks for them and shows them. Days are the hotel's calendar days (Asia/Manila), never UTC.
import { readConfig } from '../../wp/config';
import { routeUrl, storageActor } from '../../wp/api';
import { addDays, hotelDate, stamp } from '../housestatus/time';

/* ---------- the six reports ---------- */

export type ReportId = 'response' | 'kpi' | 'turnaround' | 'workorders' | 'inquiries' | 'crisis';
export interface ReportMeta { id: ReportId; title: string; category: string; line: string; icon: string; filters: FilterKey[] }
export type FilterKey = 'dept' | 'type' | 'priority' | 'status' | 'contact' | 'code';

/** The prototype's tiles, in its order, with its titles and categories; the one-line descriptions say what our version measures. */
export const REPORTS: ReportMeta[] = [
  { id: 'response', title: 'Response Time', category: 'Service', line: 'Time to relay and to complete, by department and request type.', icon: 'clock', filters: ['dept', 'type'] },
  { id: 'kpi', title: 'KPI Dashboard', category: 'Service', line: 'The key figures, against the period before.', icon: 'gauge', filters: [] },
  { id: 'turnaround', title: 'Room Turnaround', category: 'Cleaning', line: 'From checkout to a clean room, by cleaning type.', icon: 'broom', filters: ['type'] },
  { id: 'workorders', title: 'WO Summary', category: 'Work order', line: 'By status, priority and department, with cost.', icon: 'wrench', filters: ['dept', 'priority', 'status'] },
  { id: 'inquiries', title: 'Inquiry Volume', category: 'Inquiry', line: 'Inquiries per day and hour, by who is asking.', icon: 'chat', filters: ['contact'] },
  { id: 'crisis', title: 'Crisis Log', category: 'Operations', line: 'Cases by code and place, and time to close.', icon: 'siren', filters: ['code', 'status'] },
];
export const reportMeta = (id: string) => REPORTS.find((r) => r.id === id);

export const FILTER_LABEL: Record<FilterKey, string> = { dept: 'Department', type: 'Type', priority: 'Priority', status: 'Status', contact: 'Who is asking', code: 'Code' };
/** The type filter means a request type on Response Time and a cleaning type on Room Turnaround. */
export const filterLabel = (k: FilterKey, id: ReportId) => (k === 'type' ? (id === 'turnaround' ? 'Cleaning type' : 'Request type') : FILTER_LABEL[k]);

/* ---------- what the server sends ---------- */

export type Unit = 'count' | 'pct' | 'min' | 'h' | 'php' | 'date' | 'time' | '';
export interface Figure { key: string; label: string; value: number | null; unit: Unit }
export interface Column { key: string; label: string; unit: Unit }
export type Cell = string | number | null;
export interface Table { columns: Column[]; rows: Record<string, Cell>[] }
export interface Bucket { label: string; count: number }
export interface Option { value: string; label: string }
export interface Report {
  ok: true;
  report: ReportId;
  title: string;
  range: { from: string; to: string; days: number };
  summary: Figure[];
  table: Table;
  options: Partial<Record<FilterKey, Option[]>>;
  empty: boolean;
  capped?: boolean;
  previous?: { from: string; to: string };
  trend?: { date: string; count: number }[];
  byHour?: { hour: number; count: number }[];
  byDept?: Record<string, Cell>[];
  [chart: string]: unknown;
}
export interface Overview { ok: true; range: { from: string; to: string; days: number }; headlines: Record<ReportId, Figure> }

/* ---------- the date range ---------- */

export type Preset = 'today' | '7' | '30' | 'month' | 'custom';
export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'month', label: 'This month' },
];
export const MAX_DAYS = 366;
export interface Range { from: string; to: string }

/** A preset's dates, ending today in the hotel (so before 8 AM Manila "today" is still today, not the UTC yesterday). */
export function presetRange(p: Exclude<Preset, 'custom'>, now: number): Range {
  const today = hotelDate(now);
  if (p === 'today') return { from: today, to: today };
  if (p === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: addDays(today, -(Number(p) - 1)), to: today };
}

/** Which preset these dates are, or custom. */
export function presetOf(r: Range, now: number): Preset {
  for (const p of PRESETS) {
    const x = presetRange(p.value as Exclude<Preset, 'custom'>, now);
    if (x.from === r.from && x.to === r.to) return p.value;
  }
  return 'custom';
}

/** Days from `from` to `to`, both counted. */
export const daysIn = (r: Range) => Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86400_000) + 1;

/** Why these dates cannot be asked for, or null. The server checks the same. */
export function rangeProblem(r: Range): string | null {
  const real = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (!real(r.from) || !real(r.to)) return 'Choose both dates.';
  if (r.from > r.to) return 'The start date is after the end date.';
  if (daysIn(r) > MAX_DAYS) return `Choose at most ${MAX_DAYS} days.`;
  return null;
}

/* ---------- formatting: no number without its unit ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const int = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 });
const peso = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Oct 5" from "2026-10-05"; with the year when asked. */
export function dayLabel(date: string, year = false): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ''}`;
}

/** "Oct 1 to 30, 2026", "Sep 28 to Oct 4, 2026", "Oct 30, 2026". */
export function rangeLabel(r: Range): string {
  if (r.from === r.to) return dayLabel(r.from, true);
  const [fy, fm] = r.from.split('-'), [ty, tm] = r.to.split('-');
  if (fy !== ty) return `${dayLabel(r.from, true)} to ${dayLabel(r.to, true)}`;
  return `${dayLabel(r.from)} to ${fm === tm ? Number(r.to.slice(8)) : dayLabel(r.to)}, ${ty}`;
}

/** A value with its unit, for the screen: "67%", "1.8 min", "4 h", "₱1,250.50", "12". A missing value is a dash. */
export function fmt(v: Cell | undefined, unit: Unit): string {
  if (v == null || v === '') return '–';
  if (typeof v === 'string') return unit === 'date' ? dayLabel(v) : v;
  switch (unit) {
    case 'pct': return `${int.format(v)}%`;
    case 'min': {
      if (v < 60) return `${one.format(v)} min`;
      const m = Math.round(v);
      return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
    }
    case 'h': return v >= 48 ? `${one.format(v / 24)} days` : `${one.format(v)} h`;
    case 'php': return `₱${peso.format(v)}`;
    case 'time': return stamp(v);
    default: return one.format(v);
  }
}

/** A headline's noun for one: "1 case", "1 inquiry". */
export const nounFor = (label: string, v: number | null) => (v === 1 ? label.replace(/inquiries/, 'inquiry').replace(/cases/, 'case').replace(/items/, 'item') : label);

/** The same value read aloud: "67 percent", "1.8 minutes", "no data". */
export function spoken(v: Cell | undefined, unit: Unit): string {
  if (v == null || v === '') return 'no data';
  const s = fmt(v, unit);
  return s.replace(/%$/, ' percent').replace(/ min$/, ' minutes').replace(/ h$/, ' hours').replace(/ h /, ' hours ').replace(/^1 hours/, '1 hour').replace(/^₱/, '') + (unit === 'php' ? ' pesos' : '');
}

/** The change against the previous period: "+3 pts", "−1.2 min", "+12", "no change"; null when one side is missing. */
export function change(now: number | null, prev: number | null, unit: Unit): { text: string; dir: 'up' | 'down' | 'same' } | null {
  if (now == null || prev == null) return null;
  const d = Math.round((now - prev) * 10) / 10;
  if (d === 0) return { text: 'no change', dir: 'same' };
  const sign = d > 0 ? '+' : '−';
  const abs = Math.abs(d);
  const body = unit === 'pct' ? `${one.format(abs)} ${abs === 1 ? 'pt' : 'pts'}` : unit === 'min' ? `${one.format(abs)} min` : unit === 'h' ? `${one.format(abs)} h` : unit === 'php' ? `₱${peso.format(abs)}` : `${one.format(abs)}${prev > 0 ? ` (${int.format((100 * abs) / prev)}%)` : ''}`;
  return { text: sign + body, dir: d > 0 ? 'up' : 'down' };
}

/* ---------- tables and charts ---------- */

export type Sort = { key: string; dir: 'asc' | 'desc' } | null;
/** Rows sorted by one column; empty cells always last. */
export function sortRows(rows: Record<string, Cell>[], sort: Sort): Record<string, Cell>[] {
  if (!sort) return rows;
  const m = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (x == null || x === '') return y == null || y === '' ? 0 : 1;
    if (y == null || y === '') return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })) * m;
  });
}
/** The next sort after a header click: descending first for numbers, ascending for text, then the other way. */
export function nextSort(sort: Sort, key: string, numeric: boolean): Sort {
  if (sort?.key !== key) return { key, dir: numeric ? 'desc' : 'asc' };
  return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
}

/** A round top for a chart's scale: 7 -> 8, 23 -> 25, 140 -> 150. Never below 1. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const s of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * p >= max) return s * p;
  return 10 * p;
}

export interface Bar { label: string; value: number | null; share: number }
/** Bars as shares of the scale (0..1), for CSS widths and SVG heights. */
export function bars(points: { label: string; value: number | null }[], top?: number): { top: number; bars: Bar[] } {
  const scale = top ?? niceMax(Math.max(0, ...points.map((p) => p.value ?? 0)));
  return { top: scale, bars: points.map((p) => ({ ...p, share: p.value == null ? 0 : Math.min(1, Math.max(0, p.value / scale)) })) };
}

/** One sentence for a screen reader about a series: total, highest and when. */
export function describe(points: { label: string; value: number | null }[], noun: string): string {
  const vals = points.filter((p) => p.value != null) as { label: string; value: number }[];
  if (!vals.length) return `No ${noun} in these dates.`;
  const total = vals.reduce((a, p) => a + p.value, 0);
  const hi = vals.reduce((a, p) => (p.value > a.value ? p : a));
  return `${int.format(total)} ${noun} in total; the most, ${int.format(hi.value)}, on ${hi.label}.`;
}

/** "09:00" style labels for the hour chart. */
export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/* ---------- the server ---------- */

export interface Conn { restUrl: string; nonce: string; actor: () => string | null; hotel: string }
/** The plugin's REST address and nonce from window.AZL; null outside WordPress (the demo desk). */
export function connection(w: { AZL?: unknown } = globalThis as unknown as { AZL?: unknown }): Conn | null {
  try {
    const cfg = readConfig(w);
    const store = storageActor(`azl-ehd:actor:${cfg.property.id}`, typeof localStorage === 'undefined' ? undefined : localStorage);
    return { restUrl: cfg.restUrl, nonce: cfg.nonce, actor: () => store.get()?.token ?? null, hotel: cfg.theme.name || cfg.property.name };
  } catch {
    return null;
  }
}

export interface Query extends Range { filters: Partial<Record<FilterKey, string>> }
/** The query string: dates, then only the filters that are set. */
export function queryOf(q: Query, format?: 'csv'): Record<string, string> {
  const out: Record<string, string> = { from: q.from, to: q.to };
  for (const [k, v] of Object.entries(q.filters)) if (v) out[k] = v;
  if (format) out.format = format;
  return out;
}

export type Fetch = typeof fetch;
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const OFFLINE = 'Could not reach the server. Check the connection and try again.';
const NOT_HERE = 'Reports are made on the hotel’s server. Open the desk from the hotel website to see them.';

function headers(c: Conn, accept: string): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, 'X-WP-Nonce': c.nonce };
  const token = c.actor();
  if (token) h['X-Azl-Actor'] = token;
  return h;
}

async function errorOf(res: Response): Promise<string> {
  if (res.status === 401 || res.status === 403) return 'Your role cannot open reports, or your sign-in has ended. Sign in again.';
  if (res.status >= 500) return 'The server could not make this report. Try again in a moment.';
  const data = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  return typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : 'The server refused this report.';
}

/** GET /reports/<id>. Never throws: every failure is a sentence for the screen. */
export async function fetchReport<T = Report>(c: Conn | null, id: ReportId | 'overview', q: Query, f: Fetch = fetch): Promise<Result<T>> {
  if (!c) return { ok: false, error: NOT_HERE };
  try {
    const res = await f(routeUrl(c.restUrl, `/reports/${id}`, queryOf(q)), { credentials: 'same-origin', cache: 'no-store', headers: headers(c, 'application/json') });
    if (!res.ok) return { ok: false, error: await errorOf(res) };
    const data = (await res.json()) as T & { ok?: boolean };
    return data && data.ok ? { ok: true, data } : { ok: false, error: 'The server sent an unreadable report.' };
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

/** The file name the server gave (Content-Disposition), else one made from the report and dates. */
export function fileName(disposition: string | null, id: ReportId, q: Range): string {
  const m = /filename="?([^";]+)"?/i.exec(disposition ?? '');
  const safe = m?.[1]?.replace(/[^A-Za-z0-9._-]/g, '-');
  return safe && safe.endsWith('.csv') ? safe : `${id}-${q.from}-to-${q.to}.csv`;
}

/** Hands a file to the browser's download. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** GET /reports/<id>?format=csv with the nonce (a plain link would carry no nonce), then saves it. */
export async function downloadCsv(c: Conn | null, id: ReportId, q: Query, f: Fetch = fetch, save: (b: Blob, name: string) => void = saveBlob): Promise<Result<string>> {
  if (!c) return { ok: false, error: NOT_HERE };
  try {
    const res = await f(routeUrl(c.restUrl, `/reports/${id}`, queryOf(q, 'csv')), { credentials: 'same-origin', cache: 'no-store', headers: headers(c, 'text/csv') });
    if (!res.ok) return { ok: false, error: await errorOf(res) };
    const name = fileName(res.headers.get('Content-Disposition'), id, q);
    save(new Blob([await res.arrayBuffer()], { type: 'text/csv;charset=utf-8' }), name);
    return { ok: true, data: name };
  } catch {
    return { ok: false, error: OFFLINE };
  }
}
