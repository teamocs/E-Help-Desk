// The Requests list as the prototype shows it (docs/MODULES-SPEC.md A.4.1): one row per item, the All / Active / Done
// filter, a date range on the ticket's day, type-to-search, counters and the Relay / Resp / Res timers. Pure
// functions, tested in logic.test.ts. Days are the hotel's local days (Asia/Manila), never UTC dates (A.16 #7).
import { deptLabel, type Catalog } from '../../domain/catalog';
import { isBlocked, sla } from '../../domain/rules';
import type { Item, ItemStatus, Request, Staff } from '../../domain/types';

export const HOTEL_TZ = 'Asia/Manila';
/** The prototype's relay target: acknowledge within 2 minutes. */
export const RELAY_MS = 2 * 60000;

const dayFmt = new Map<string, Intl.DateTimeFormat>();
/** The hotel-local calendar day of a moment, as YYYY-MM-DD (sorts and compares as text). */
export function dayKey(ms: number, tz = HOTEL_TZ): string {
  let f = dayFmt.get(tz);
  if (!f) dayFmt.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })));
  return f.format(ms);
}

/** Today in the hotel, as a from/to range. */
export const todayRange = (now: number, tz = HOTEL_TZ) => ({ from: dayKey(now, tz), to: dayKey(now, tz) });

/** Monday of this week to today, in the hotel's days (the prototype's Week button). */
export function weekRange(now: number, tz = HOTEL_TZ) {
  const to = dayKey(now, tz);
  const [y, m, d] = to.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return { from: new Date(t - back * 86400000).toISOString().slice(0, 10), to };
}

export type StatusFilter = 'all' | 'active' | 'done';
export type Quick = 'overdue' | 'hold' | 'mine';

/** Active as the prototype counts it (also the sidebar badge). */
export const ACTIVE: ItemStatus[] = ['new', 'relayed', 'on_site', 'on_hold'];
/** Done: the prototype's done and transferred, plus our other closes. An escalated item shows under All only, as in the prototype. */
export const DONE: ItemStatus[] = ['done', 'transferred', 'cant_do', 'duplicate', 'cancelled'];

/** One list row: an item of a ticket, or a ticket logged for later that has no items yet. */
export interface Line {
  key: string;
  req: Request;
  it?: Item;
  /** T-0001-1: the ticket and the item's position, as the prototype numbers them. */
  code: string;
}

/** Every row, newest ticket first, items in their order. */
export function lines(requests: Request[], items: Record<string, Item>): Line[] {
  const out: Line[] = [];
  for (const req of [...requests].sort((a, b) => b.createdAt - a.createdAt)) {
    const its = req.itemIds.map((id) => items[id]).filter(Boolean);
    if (!its.length) out.push({ key: req.id, req, code: req.ticket });
    its.forEach((it, i) => out.push({ key: it.id, req, it, code: `${req.ticket}-${i + 1}` }));
  }
  return out;
}

export const isActive = (l: Line) => (l.it ? ACTIVE.includes(l.it.status) : !!l.req.incomplete);
export const isDone = (l: Line) => !!l.it && DONE.includes(l.it.status);
export function overdue(l: Line, items: Record<string, Item>, now: number): boolean {
  return !!l.it && ACTIVE.includes(l.it.status) && sla(l.it, items, now).overdue;
}

export interface Filters {
  status: StatusFilter;
  quick?: Quick | null;
  /** Hotel days, YYYY-MM-DD, inclusive. Empty: open-ended. */
  from?: string;
  to?: string;
  q?: string;
  /** The reader's department, for "My department". */
  myDept?: string;
}

/** The words a row can be found by: code, room, item, department, people, who asked, remarks, status. */
export function haystack(l: Line, cat: Catalog, staff: Staff[]): string {
  const name = (id?: string) => (id ? staff.find((p) => p.id === id)?.name ?? '' : '');
  const it = l.it;
  return [
    l.code, l.req.room, l.req.staffName, l.req.remarks, name(l.req.hdo), l.req.vip ? 'vip' : '',
    it?.name, it && deptLabel(it.dept, cat), it?.dept, name(it?.assignee), it?.remarks, it?.xNote, it?.status.replace('_', ' '),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function matches(l: Line, q: string, cat: Catalog, staff: Staff[]): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = haystack(l, cat, staff);
  return words.every((w) => h.includes(w));
}

export function inRange(at: number, from?: string, to?: string, tz = HOTEL_TZ): boolean {
  if (!from && !to) return true;
  const k = dayKey(at, tz);
  return (!from || k >= from) && (!to || k <= to);
}

export interface Ctx { items: Record<string, Item>; now: number; cat: Catalog; staff: Staff[]; tz?: string }

/** The rows the list shows. The date range applies to the ticket's day; search across every row. */
export function apply(all: Line[], f: Filters, c: Ctx): Line[] {
  return all.filter((l) => {
    if (f.status === 'active' && !isActive(l)) return false;
    if (f.status === 'done' && !isDone(l)) return false;
    if (f.quick === 'overdue' && !overdue(l, c.items, c.now)) return false;
    if (f.quick === 'hold' && l.it?.status !== 'on_hold') return false;
    if (f.quick === 'mine' && f.myDept && l.it && l.it.dept !== f.myDept) return false;
    if (!inRange(l.req.createdAt, f.from, f.to, c.tz)) return false;
    return !f.q || matches(l, f.q, c.cat, c.staff);
  });
}

/** Counters over the rows in range (before the status filter): the tab numbers and the status line. */
export function counts(rows: Line[], items: Record<string, Item>, now: number) {
  const n = { all: rows.length, active: 0, done: 0, new: 0, relayed: 0, on_site: 0, on_hold: 0, overdue: 0 };
  for (const l of rows) {
    if (isActive(l)) n.active++;
    if (isDone(l)) n.done++;
    const st = l.it?.status;
    if (st === 'new' || st === 'relayed' || st === 'on_site' || st === 'on_hold') n[st]++;
    if (overdue(l, items, now)) n.overdue++;
  }
  return n;
}

/* ---------- timers ---------- */

export type Tone = 'ok' | 'warn' | 'bad' | '';
/** A timer cell: the time, whether it is still running, and its colour against the target. */
export interface Timer { ms: number; live: boolean; tone: Tone }

/**
 * The prototype's three columns, from our times:
 * - Relay: logging to acknowledgement (target 2 minutes);
 * - Resp: acknowledgement to on site;
 * - Res: acknowledgement to done with the hold time taken out (our completion clock; the item type's target).
 * A running clock is live: Relay while new, Resp while relayed, Res while open after acknowledgement.
 */
export function timers(it: Item, items: Record<string, Item>, now: number): { relay?: Timer; resp?: Timer; res?: Timer } {
  const out: { relay?: Timer; resp?: Timer; res?: Timer } = {};
  const relayTone = (ms: number): Tone => (ms > RELAY_MS ? 'bad' : ms > RELAY_MS * 0.75 ? 'warn' : 'ok');
  if (it.ackAt != null) out.relay = { ms: it.ackAt - it.createdAt, live: false, tone: relayTone(it.ackAt - it.createdAt) };
  else if (it.status === 'new' && !isBlocked(it, items)) out.relay = { ms: now - it.createdAt, live: true, tone: relayTone(now - it.createdAt) };
  if (it.onSiteAt != null && it.ackAt != null) out.resp = { ms: Math.max(0, it.onSiteAt - it.ackAt), live: false, tone: '' };
  else if (it.status === 'relayed' && it.ackAt != null) out.resp = { ms: now - it.ackAt, live: true, tone: '' };
  const target = it.slaMin * 60000;
  const resTone = (ms: number): Tone => (ms > target ? 'bad' : ms > target * 0.75 ? 'warn' : 'ok');
  if (it.status === 'done' && it.doneAt != null) {
    const ms = Math.max(0, it.doneAt - (it.ackAt ?? it.createdAt) - it.heldMs);
    out.res = { ms, live: false, tone: resTone(ms) };
  } else if (ACTIVE.includes(it.status) && it.ackAt != null) {
    const held = it.heldMs + (it.status === 'on_hold' ? now - (it.holdSince ?? now) : 0);
    const ms = Math.max(0, now - it.ackAt - held);
    out.res = { ms, live: it.status !== 'on_hold', tone: resTone(ms) };
  }
  return out;
}

/** "1m 12s" as the prototype prints times; hours as "2h 05m". */
export function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const m = Math.floor(s / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Spoken form for screen readers: "1 minute 12 seconds". */
export function durWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n: number, w: string) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');
  return [p(h, 'hour'), p(m, 'minute'), h ? '' : p(r, 'second')].filter(Boolean).join(' ') || '0 seconds';
}

/** Table on a list at least this wide; cards below (phones at 375 px get cards, never an 11 px table). */
export const TABLE_MIN = 720;
export const layoutFor = (width: number): 'table' | 'cards' => (width >= TABLE_MIN ? 'table' : 'cards');

/** The prototype's row actions by item status (A.4.1), as our step names. */
export function rowActions(it: Item, items: Record<string, Item>): ('relay' | 'onSite' | 'done' | 'hold' | 'resume' | 'undo')[] {
  if (isBlocked(it, items)) return [];
  switch (it.status) {
    case 'new': return ['relay'];
    case 'relayed': return ['onSite', 'done'];
    case 'on_site': return ['hold', 'done'];
    case 'on_hold': return ['undo', 'resume'];
    case 'cancelled': return it.events.some((e) => e.what === 'Cancelled') ? ['undo'] : [];
    case 'done': case 'transferred': case 'cant_do': case 'duplicate': return it.woId ? [] : ['undo'];
    default: return [];
  }
}

/** Ticket status as the drawer shows it (A.4.5): transferred items ignored; all done: done; all new: new; else in progress. */
export function ticketStatus(its: Item[]): 'new' | 'in_progress' | 'done' {
  const live = its.filter((i) => i.status !== 'transferred' && i.status !== 'cancelled');
  if (!live.length || live.every((i) => DONE.includes(i.status))) return 'done';
  if (live.every((i) => i.status === 'new')) return 'new';
  return 'in_progress';
}
