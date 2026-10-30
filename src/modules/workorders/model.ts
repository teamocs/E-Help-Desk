// Work Orders on the desk: the full record the server sends (src/domain/types.ts WorkOrder plus the wave 2 fields of
// azalea-ehelpdesk/includes/Modules/WorkOrders.php), the transition table, hotel-time dates, and the actions.
//
// Actions go through runModuleCommand (the same outbox, a fresh opId) even for the built-in assessWo, startWo,
// holdWo, completeWo and reopenWo: the store's own actions cannot carry the new fields (hold reason, notes, targets,
// who). Their optimistic change lives in this module's own snapshot slice (`local`), merged over s.wos by useWos();
// the next snapshot replaces the slice and the list with the server's truth.
import { useMemo } from 'react';
import { myStaff, runModuleCommand, useApp, useUI } from '../../domain/store';
import type { ItemEvent, State, WorkOrder } from '../../domain/types';
import { MATRIX, kindOfStaffRole, levelOf, type Level } from '../access';
import { pad } from '../../domain/rules';

export type WoStatus = 'scheduled' | 'reported' | 'assessed' | 'in_progress' | 'on_hold' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export interface WoNote { at: number; by: string; text: string }

/** A work order with every field the server may send (dates are epoch ms of midnight, hotel time). */
export interface Wo extends Omit<WorkOrder, 'status' | 'priority'> {
  status: WoStatus;
  /** low, medium, high, urgent; 'normal' on rows from before wave 2 (reads as Medium). */
  priority: string;
  reporterDept?: string;
  requestedDate?: number;
  targetStart?: number;
  assignee?: string;
  assessedBy?: string;
  assessedAt?: number;
  actualStart?: number;
  actualEnd?: number;
  holdReason?: string;
  completionNotes?: string;
  schedDate?: number;
  updates?: WoNote[];
}

/** The optimistic changes not yet confirmed by a snapshot. */
export interface WoLocal { add: Wo[]; patch: Record<string, Partial<Wo>> }
export interface WoSlice { local?: WoLocal }

declare module '../../domain/store' {
  interface ModuleSlices {
    workorders: WoSlice;
  }
}

/**
 * The transition table, the same as Azl_Module_WorkOrders::TRANSITIONS (a test reads the PHP file and compares).
 * command => [from statuses, to status (null: unchanged)].
 */
export const TRANSITIONS: Record<string, [WoStatus[], WoStatus | null]> = {
  reportWo: [[], 'reported'],
  openWo: [['scheduled'], 'reported'],
  assessWo: [['reported'], 'assessed'],
  startWo: [['assessed', 'on_hold'], 'in_progress'],
  holdWo: [['in_progress'], 'on_hold'],
  updateWo: [['in_progress', 'on_hold'], null],
  completeWo: [['in_progress', 'on_hold', 'assessed'], 'done'],
  reopenWo: [['done'], 'assessed'],
  editWo: [['scheduled', 'reported', 'assessed', 'in_progress', 'on_hold', 'done'], null],
};
export const can = (cmd: keyof typeof TRANSITIONS, st: WoStatus) => TRANSITIONS[cmd][0].includes(st);

export const STATUS_LABEL: Record<WoStatus, string> = { scheduled: 'Scheduled', reported: 'Reported', assessed: 'Assessed', in_progress: 'In Progress', on_hold: 'On Hold', done: 'Done' };
export const STATUS_TONE: Record<WoStatus, '' | 'ok' | 'warn' | 'bad' | 'accent'> = { scheduled: '', reported: 'accent', assessed: 'accent', in_progress: 'warn', on_hold: 'warn', done: 'ok' };
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
const PRI_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', normal: 'Medium', high: 'High', urgent: 'Urgent' };
/** The priority as the prototype names it; our old 'normal' reads as Medium, the stored value is left alone. */
export const priorityLabel = (p: string) => PRI_LABEL[p] ?? p;
/** For filters: 'normal' counts as medium. */
export const priorityKey = (p: string): string => (p === 'normal' ? 'medium' : p);
export const priorityTone = (p: string): '' | 'ok' | 'warn' | 'bad' => (p === 'low' ? 'ok' : p === 'high' || p === 'urgent' ? 'bad' : 'warn');

/** The prototype's work-order areas: the factory list when the hotel's lists do not have it yet (older plugin). */
export const SEED_AREAS = ['Room', 'Public Area', 'Office', 'Staff House', 'Function Room', 'Basement Parking', 'Drivers Quarters', 'Other'];
export function areasOf(cat: State['catalog']): string[] {
  const list = (cat as unknown as Record<string, { label: string; active: boolean }[] | undefined>).woAreas;
  return Array.isArray(list) ? list.filter((a) => a.active).map((a) => a.label) : SEED_AREAS;
}

/* ---------- dates in the hotel's time (Asia/Manila, UTC+8 all year) ---------- */

export const TZ = 'Asia/Manila';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** 'YYYY-MM-DD' of an instant in hotel time. */
export const dayOf = (ms: number) => dayFmt.format(ms);
export const today = (now = Date.now()) => dayOf(now);
/** 'YYYY-MM-DD' some days after today, hotel time. */
export const dayPlus = (n: number, now = Date.now()) => dayOf(now + n * 86_400_000);
/** A date's midnight in hotel time as epoch ms (Manila has no daylight saving: UTC+8). */
export const dayMs = (d: string) => Date.parse(`${d}T00:00:00+08:00`);
const short = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
const stamp = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const clock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const fmtDay = (ms?: number) => (ms == null ? '—' : short.format(ms));
export const fmtStamp = (ms?: number) => (ms == null ? '—' : stamp.format(ms));
export const fmtClock = (ms?: number) => (ms == null ? '—' : clock.format(ms));

/** The deadline: the target end (moved by an extension) else the requested date. */
export const deadline = (w: Wo) => w.targetEnd ?? w.requestedDate;
/** Past its deadline day (hotel time) and not done. Not the prototype's rule, which ignores extensions (A.16 #4). */
export const overdue = (w: Wo, now = Date.now()) => w.status !== 'done' && w.status !== 'scheduled' && deadline(w) != null && dayOf(deadline(w)!) < today(now);

export const peso = (n?: number) => (n == null ? '₱—' : '₱' + n.toLocaleString('en-PH', { maximumFractionDigits: 2 }));

/* ---------- reading: the server's list with this desk's unconfirmed changes on top ---------- */

const EMPTY: WoLocal = { add: [], patch: {} };
const localOf = (s: State): WoLocal => (s.modules.workorders as WoSlice | undefined)?.local ?? EMPTY;

export function mergeWos(s: State): Wo[] {
  const l = localOf(s);
  const base = s.wos as unknown as Wo[];
  const known = new Set(base.map((w) => w.id));
  return [...l.add.filter((w) => !known.has(w.id)), ...base].map((w) => (l.patch[w.id] ? { ...w, ...l.patch[w.id] } : w));
}

/** Every work order, newest first, with unconfirmed changes applied. */
export function useWos(): Wo[] {
  const wos = useApp((s) => s.wos);
  const slice = useApp((s) => s.modules.workorders);
  return useMemo(() => mergeWos({ wos, modules: { workorders: slice } } as unknown as State), [wos, slice]);
}

/** This viewer's level on a module (the server's Azl_Access::level), without importing the registry. */
export function useLevel(module: string): Level {
  const role = useUI((s) => s.account.role);
  const accountModules = useUI((s) => s.account.modules);
  const access = useUI((s) => s.access);
  const me = useApp(myStaff);
  const catalog = useApp((s) => s.catalog);
  const repairs = (d: string) => catalog.departments.some((x) => x.key === d && x.active && x.repairs);
  const matrix = { ...MATRIX, ...access };
  if (role !== 'device') {
    if (accountModules && Object.keys(accountModules).length) return accountModules[module] ?? 'none';
    return levelOf(module, { kind: role }, matrix, repairs);
  }
  return levelOf(module, { kind: kindOfStaffRole(me?.role), dept: me?.dept }, matrix, repairs);
}

/* ---------- actions ---------- */

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `w${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const ev = (s: State, what: string): ItemEvent => ({ at: s.now, by: s.me ?? 'system', what });

/** Sends a work-order command and applies `patch` to the work order at once (or `add` for a new one). */
function send(type: string, fields: Record<string, unknown>, change: (w: Wo | undefined, s: State) => { patch?: Partial<Wo>; add?: Wo; audit?: string }, id: string) {
  runModuleCommand(
    'workorders',
    type,
    fields,
    (slice, s) => {
      const cur = (slice as WoSlice | undefined) ?? {};
      const local = cur.local ?? EMPTY;
      const w = mergeWos(s).find((x) => x.id === id);
      const c = change(w, s);
      if (c.add) return { ...cur, local: { ...local, add: [c.add, ...local.add] } };
      if (!w || !c.patch) return cur;
      const audit = c.audit ? [...w.audit, ev(s, c.audit)] : w.audit;
      return { ...cur, local: { ...local, patch: { ...local.patch, [id]: { ...local.patch[id], ...c.patch, audit } } } };
    },
    [id],
  );
}

const note = (w: Wo, s: State, text: string, by?: string): WoNote[] => [...(w.updates ?? []), { at: s.now, by: by ?? s.me ?? 'system', text }];

export interface ReportInput {
  area: string; loc: string; desc: string; priority: Priority; dept: string;
  reporterDept: string; reporterId?: string; encodedBy?: string; requestedDate: string; schedDate?: string;
}
/** Returns the new work order's provisional number (the server's snapshot has the real one). */
export function reportWo(i: ReportInput, s0: State): string {
  const woId = uuid();
  const n = s0.seq.wo + 1 + (localOf(s0).add.length);
  const no = `WO-${pad(n)}`;
  const fields: Record<string, unknown> = { woId, ...i };
  for (const k of Object.keys(fields)) if (fields[k] === undefined || fields[k] === '') delete fields[k];
  send('reportWo', fields, (_w, s) => ({
    add: {
      id: woId, no, area: i.area, loc: i.loc, desc: i.desc, priority: i.priority, dept: i.dept,
      status: i.schedDate ? 'scheduled' : 'reported', reportedBy: i.reporterId ?? '', encodedBy: i.encodedBy ?? s.me ?? '', createdAt: s.now,
      reporterDept: i.reporterDept, requestedDate: dayMs(i.requestedDate), schedDate: i.schedDate ? dayMs(i.schedDate) : undefined,
      audit: [ev(s, i.schedDate ? `Scheduled for ${i.schedDate}` : 'Reported')], updates: [],
    },
  }), woId);
  return no;
}

export interface EditInput { area?: string; loc?: string; desc?: string; priority?: Priority; dept?: string; assigneeId?: string; clearAssignee?: boolean; contractor?: string; requestedDate?: string }
export function editWo(id: string, changes: EditInput) {
  send('editWo', { woId: id, ...changes }, () => ({
    audit: 'Edited',
    patch: {
      ...(changes.area != null ? { area: changes.area } : {}),
      ...(changes.loc != null ? { loc: changes.loc } : {}),
      ...(changes.desc != null ? { desc: changes.desc } : {}),
      ...(changes.priority ? { priority: changes.priority } : {}),
      ...(changes.dept ? { dept: changes.dept } : {}),
      ...(changes.assigneeId ? { assignee: changes.assigneeId } : {}),
      ...(changes.clearAssignee ? { assignee: undefined } : {}),
      ...(changes.contractor != null ? { contractor: changes.contractor } : {}),
      ...(changes.requestedDate ? { requestedDate: dayMs(changes.requestedDate) } : {}),
    },
  }), id);
}

export interface AssessInput { assessment: string; assignType: 'inhouse' | 'outsource'; assigneeId?: string; contractor?: string; assessedById?: string; targetStart?: string; targetEnd?: string; estCost?: number }
export function assessWo(id: string, a: AssessInput) {
  const fields: Record<string, unknown> = { woId: id, ...a };
  for (const k of Object.keys(fields)) if (fields[k] === undefined || fields[k] === '') delete fields[k];
  send('assessWo', fields, (_w, s) => ({
    audit: 'Assessed',
    patch: {
      status: 'assessed', assessment: a.assessment, assignType: a.assignType, contractor: a.assignType === 'outsource' ? a.contractor : undefined,
      assignee: a.assignType === 'inhouse' ? a.assigneeId : undefined, assessedBy: a.assessedById ?? s.me ?? undefined, assessedAt: s.now,
      targetStart: a.targetStart ? dayMs(a.targetStart) : undefined, targetEnd: a.targetEnd ? dayMs(a.targetEnd) : undefined, estCost: a.estCost,
    },
  }), id);
}

export function startWo(id: string, resume: boolean) {
  send('startWo', { woId: id }, (w, s) => ({ audit: 'Work started', patch: { status: 'in_progress', holdReason: undefined, actualStart: w?.actualStart ?? (resume ? undefined : s.now) } }), id);
}

export function holdWo(id: string, reason: string) {
  send('holdWo', { woId: id, reason }, (w, s) => ({ audit: 'Put on hold', patch: { status: 'on_hold', holdReason: reason, updates: w ? note(w, s, `On hold: ${reason}`) : [] } }), id);
}

export interface UpdateInput { text: string; byId?: string; newDeadline?: string; extendReason?: string; contractor?: string; estCost?: number }
export function updateWo(id: string, u: UpdateInput) {
  const fields: Record<string, unknown> = { woId: id, ...u };
  for (const k of Object.keys(fields)) if (fields[k] === undefined || fields[k] === '') delete fields[k];
  send('updateWo', fields, (w, s) => {
    if (!w) return {};
    const lines = [u.text];
    if (u.newDeadline) {
      const old = deadline(w);
      lines.push(`Deadline: ${old == null ? 'none' : dayOf(old)} → ${u.newDeadline}${u.extendReason ? ` (${u.extendReason})` : ''}`);
    }
    if (u.contractor) lines.push(`Outsourced: ${u.contractor}`);
    return {
      audit: 'Progress update',
      patch: {
        updates: note(w, s, lines.join('\n'), u.byId),
        ...(u.newDeadline ? { targetEnd: dayMs(u.newDeadline) } : {}),
        ...(u.contractor ? { assignType: 'outsource' as const, contractor: u.contractor, assignee: undefined, ...(u.estCost != null ? { estCost: u.estCost } : {}) } : {}),
      },
    };
  }, id);
}

export function completeWo(id: string, c: { actualCost: number; notes?: string; byId?: string }) {
  const fields: Record<string, unknown> = { woId: id, actualCost: c.actualCost };
  if (c.notes) fields.notes = c.notes;
  if (c.byId) fields.byId = c.byId;
  send('completeWo', fields, (w, s) => ({
    audit: 'Completed',
    patch: { status: 'done', actualCost: c.actualCost, actualEnd: s.now, completionNotes: c.notes || undefined, holdReason: undefined, updates: w && c.notes ? note(w, s, `Completed: ${c.notes}`, c.byId) : w?.updates },
  }), id);
}

export function reopenWo(id: string) {
  send('reopenWo', { woId: id }, () => ({ audit: 'Reopened', patch: { status: 'assessed', actualCost: undefined, actualEnd: undefined, completionNotes: undefined } }), id);
}

export function openWo(id: string) {
  send('openWo', { woId: id }, () => ({ audit: 'Opened', patch: { status: 'reported' } }), id);
}

/* ---------- filters ---------- */

export type StatusFilter = 'all' | 'open' | WoStatus;
export interface Filters { status: StatusFilter; priority: string; dept: string; overdueOnly: boolean }
export const NO_FILTERS: Filters = { status: 'all', priority: '', dept: '', overdueOnly: false };
export function applyFilters(wos: Wo[], f: Filters, now = Date.now()): Wo[] {
  return wos.filter(
    (w) =>
      (f.status === 'all' || (f.status === 'open' ? w.status !== 'done' : w.status === f.status)) &&
      (!f.priority || priorityKey(w.priority) === f.priority) &&
      (!f.dept || w.dept === f.dept) &&
      (!f.overdueOnly || overdue(w, now)),
  );
}
