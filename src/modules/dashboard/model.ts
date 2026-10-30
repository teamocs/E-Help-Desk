// The Dashboard's numbers, as pure functions of the live snapshot. Nothing here reads the clock: "now" is the
// snapshot's, and a "day" is the hotel's calendar day (Asia/Manila), never UTC's (docs/MODULES-SPEC.md A.16 item 7).
// Our service levels are not the prototype's single 2/6-minute targets (B.5 risk 2): every item has its own target,
// measured from acknowledgement with hold time taken out, so the response cards show those numbers.
import { isOpen, sla } from '../../domain/rules';
import { go, openComposer } from '../../domain/store';
import type { Item, State } from '../../domain/types';
import { inquiryBadge, openNewInquiry } from '../inquiries/data';
import { openNewReminder, remindersOf, isOverdue as reminderOverdue } from '../reminders/data';
import { badge as houseBadge } from '../housestatus/model';
import { casesOf, unresolvedCount } from '../crisis/model';
import { tripsOf } from '../transport/model';
import { mergeWos, overdue as woOverdue } from '../workorders/model';
import { mergeTasks } from '../cleaning/model';
import { dayKey, rowActions, RELAY_MS } from '../requests/logic';

/** The prototype's compliance goal for the "within target" card. */
export const GOAL_PCT = 80;

export interface Stats {
  requests: { open: number; fresh: number; relayed: number; onSite: number; hold: number; overdue: number };
  inquiries: number;
  houseLogs: number;
  reminders: { pending: number; overdue: number };
  roomsReady: number;
  crisis: { unresolved: number; today: number };
  trips: { today: number; enRoute: number };
  wos: { notDone: number; overdue: number };
  response: { n: number; avgRelayMs: number | null; avgCompleteMs: number | null; withinPct: number | null };
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Time from acknowledgement to done with the hold time taken out (the Requests "Res" column). */
export const completionMs = (it: Item): number | null => (it.doneAt == null ? null : Math.max(0, it.doneAt - (it.ackAt ?? it.createdAt) - it.heldMs));

export function computeStats(s: State): Stats {
  const today = dayKey(s.now);
  const all = Object.values(s.items);
  const open = all.filter(isOpen);
  const by = (st: Item['status']) => open.filter((i) => i.status === st).length;

  const done = all.filter((i) => i.status === 'done' && i.doneAt != null);
  const relay = done.flatMap((i) => (i.ackAt != null ? [Math.max(0, i.ackAt - i.createdAt)] : []));
  const complete = done.map((i) => completionMs(i)!);
  const within = done.filter((i) => completionMs(i)! <= i.slaMin * 60_000).length;

  const wos = mergeWos(s);
  // A trip is "today" when it is on the road now, or it left, or is scheduled to leave, on the hotel's day.
  const trips = tripsOf(s).filter((t) => t.status !== 'cancelled');
  const isToday = (t: (typeof trips)[number]) => t.status === 'en_route' || dayKey(t.depAt ?? t.schedAt ?? t.createdAt) === today;

  const pending = remindersOf(s).filter((r) => r.status === 'pending');

  return {
    requests: { open: open.length, fresh: by('new'), relayed: by('relayed'), onSite: by('on_site'), hold: by('on_hold'), overdue: open.filter((i) => sla(i, s.items, s.now).overdue).length },
    inquiries: inquiryBadge(s),
    houseLogs: houseBadge(s),
    reminders: { pending: pending.length, overdue: pending.filter((r) => reminderOverdue(r, s.now)).length },
    roomsReady: mergeTasks(s).filter((c) => c.status === 'ready').length,
    crisis: { unresolved: unresolvedCount(s), today: casesOf(s).filter((c) => dayKey(c.createdAt) === today).length },
    trips: { today: trips.filter(isToday).length, enRoute: trips.filter((t) => t.status === 'en_route').length },
    wos: { notDone: wos.filter((w) => w.status !== 'done').length, overdue: wos.filter((w) => woOverdue(w, s.now)).length },
    response: { n: done.length, avgRelayMs: mean(relay), avgCompleteMs: mean(complete), withinPct: done.length ? Math.round((100 * within) / done.length) : null },
  };
}

/* ---------- cards ---------- */

export type Tone = '' | 'ok' | 'warn' | 'bad';
export interface Card {
  key: string;
  /** The module the card opens; it is left out when the viewer may not see that module. */
  module: string;
  label: string;
  value: number;
  sub: string;
  tone: Tone;
  icon?: string;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The count cards, then the three tiles (Crisis, Transport, Work Orders), each only for a module the viewer can see. */
export function buildCards(st: Stats, can: (module: string) => boolean): { stats: Card[]; tiles: Card[] } {
  const r = st.requests;
  const stats: Card[] = [
    { key: 'open', module: 'requests', label: 'Open requests', value: r.open, sub: r.open ? `${r.fresh} new, ${r.relayed} relayed, ${r.onSite} on site` : 'Nothing waiting', tone: '' },
    { key: 'overdue', module: 'requests', label: 'Overdue', value: r.overdue, sub: r.overdue ? 'Past their own target' : 'All within target', tone: r.overdue ? 'bad' : '' },
    { key: 'hold', module: 'requests', label: 'On hold', value: r.hold, sub: r.hold ? 'Waiting on something' : 'None on hold', tone: r.hold ? 'warn' : '' },
    { key: 'inquiries', module: 'inquiries', label: 'Inquiries active', value: st.inquiries, sub: 'Active or noted', tone: '' },
    { key: 'house', module: 'housestatus', label: 'House logs open', value: st.houseLogs, sub: 'Not closed', tone: '' },
    { key: 'reminders', module: 'reminders', label: 'Reminders pending', value: st.reminders.pending, sub: st.reminders.overdue ? `${st.reminders.overdue} overdue` : 'None overdue', tone: st.reminders.overdue ? 'bad' : '' },
    { key: 'rooms', module: 'cleaning', label: 'Rooms ready', value: st.roomsReady, sub: 'Ready to clean', tone: '' },
  ];
  const tiles: Card[] = [
    { key: 'crisis', module: 'crisis', label: 'Crisis Mgmt', icon: 'siren', value: st.crisis.unresolved, sub: `Unresolved, ${st.crisis.today} logged today`, tone: st.crisis.unresolved ? 'bad' : '' },
    { key: 'transport', module: 'transport', label: 'Trips today', icon: 'van', value: st.trips.today, sub: `${st.trips.enRoute} en route`, tone: '' },
    { key: 'wos', module: 'workorders', label: 'Work orders open', icon: 'wrench', value: st.wos.notDone, sub: st.wos.overdue ? `Not done, ${st.wos.overdue} overdue` : 'Not done', tone: st.wos.overdue ? 'bad' : '' },
  ];
  const keep = (c: Card) => can(c.module);
  return { stats: stats.filter(keep), tiles: tiles.filter(keep) };
}

/** "0.9 min", "12.5 min", "1h 05m". Null (nothing finished yet) is an em dash. */
export function fmtMinutes(ms: number | null): string {
  if (ms == null) return '—';
  const min = ms / 60_000;
  if (min < 60) return `${(Math.round(min * 10) / 10).toFixed(1)} min`;
  const m = Math.round(min);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export interface ResponseCard { key: string; label: string; value: string; sub: string; tone: Tone }

/** The three response cards. Quiet until something is done, rather than a red 0%. */
export function responseCards(r: Stats['response']): ResponseCard[] {
  const none = r.n === 0;
  return [
    { key: 'relay', label: 'Average time to relay', value: fmtMinutes(r.avgRelayMs), sub: none ? 'No finished items yet' : r.avgRelayMs! <= RELAY_MS ? 'Within the 2 minute target' : 'Above the 2 minute target', tone: none ? '' : r.avgRelayMs! <= RELAY_MS ? 'ok' : 'bad' },
    { key: 'complete', label: 'Average time to complete', value: fmtMinutes(r.avgCompleteMs), sub: none ? 'No finished items yet' : 'From acknowledgement, hold time removed', tone: '' },
    { key: 'within', label: 'Done within their own target', value: r.withinPct == null ? '—' : `${r.withinPct}%`, sub: none ? 'No finished items yet' : `Goal ${GOAL_PCT}% of ${plural(r.n, 'finished item')}`, tone: r.withinPct == null ? '' : r.withinPct >= GOAL_PCT ? 'ok' : 'bad' },
  ];
}

/* ---------- quick actions ---------- */

/** Goes to Cleaning and presses its own "Log Cleaning" button once the screen is there (Cleaning has no open-form function yet). */
export function openLogCleaning() {
  go('cleaning');
  if (typeof document === 'undefined') return;
  let tries = 0;
  const timer = setInterval(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('.mx-actions button')].find((x) => x.textContent?.trim() === 'Log Cleaning');
    if (b) { clearInterval(timer); b.click(); } else if (++tries > 40) clearInterval(timer);
  }, 50);
}

export interface QuickAction { key: string; module: string; label: string; keys: string; run: () => void }
/** Each opens the real form of its module; the Alt shortcuts are the prototype's. */
export const QUICK_ACTIONS: QuickAction[] = [
  { key: 'request', module: 'requests', label: 'New Request', keys: 'R', run: () => openComposer() },
  { key: 'inquiry', module: 'inquiries', label: 'New Inquiry', keys: 'I', run: openNewInquiry },
  { key: 'reminder', module: 'reminders', label: 'New Reminder', keys: 'M', run: openNewReminder },
  { key: 'cleaning', module: 'cleaning', label: 'Log Cleaning', keys: 'C', run: openLogCleaning },
];

/** A Recent Tickets row action: the prototype offers Relay, On Site and Done only (the Requests module offers more). */
export const dashActions = (it: Item, items: Record<string, Item>) => rowActions(it, items).filter((a): a is 'relay' | 'onSite' | 'done' => a === 'relay' || a === 'onSite' || a === 'done');
