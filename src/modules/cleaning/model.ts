// Cleaning on the desk: the task as the server sends it (wave 2 fields of azalea-ehelpdesk/includes/Modules/Cleaning.php),
// the cleaning types list, and the actions. New commands go through runModuleCommand; their optimistic change lives in
// this module's own snapshot slice (`local`), merged over s.cleaning by useTasks(). "Mark ready" is the built-in
// cleanSet and uses the store's own action.
import { useMemo } from 'react';
import { runModuleCommand, useApp } from '../../domain/store';
import type { CleanStatus, CleanTask, State } from '../../domain/types';
import { dayMs } from '../workorders/model';

export interface Task extends Omit<CleanTask, 'type'> {
  /** A cleaningTypes key; rows from before wave 2 hold a label such as "Deep clean" (shown as written). */
  type: string;
  role?: 'lead' | 'backup';
  schedDate?: number;
  checkoutAt?: number;
  clockIn?: number;
  clockOut?: number;
  createdAt?: number;
}
export interface CleanLocal { add: Task[]; patch: Record<string, Partial<Task>> }
export interface CleanSlice { local?: CleanLocal }

declare module '../../domain/store' {
  interface ModuleSlices {
    cleaning: CleanSlice;
  }
}

/** Azl_Module_Cleaning::TRANSITIONS, command => [from statuses, to status (null: unchanged)]. */
export const CLEAN_TRANSITIONS: Record<string, [CleanStatus[], CleanStatus | null]> = {
  logClean: [[], 'in_progress'],
  scheduleClean: [[], 'scheduled'],
  clockIn: [['ready', 'queued'], 'in_progress'],
  clockOut: [['in_progress'], 'done'],
  editClean: [['scheduled', 'queued', 'ready', 'in_progress', 'done'], null],
};

export const CLEAN_LABEL: Record<CleanStatus, string> = { scheduled: 'Scheduled', queued: 'Queued', ready: 'Ready', in_progress: 'In Progress', done: 'Done' };
export const CLEAN_TONE: Record<CleanStatus, '' | 'ok' | 'warn' | 'accent'> = { scheduled: '', queued: 'accent', ready: 'warn', in_progress: 'warn', done: 'ok' };
export const ROLE_LABEL = { lead: 'Lead', backup: 'Backup' } as const;

/** The prototype's cleaning types, as the server seeds cleaningTypes (used until the hotel's lists carry it). */
export const SEED_TYPES = [
  { key: 'regular', label: 'Regular' }, { key: 'checkout', label: 'Checkout' }, { key: 'deep_clean', label: 'Deep Clean' }, { key: 'touch_up', label: 'Touch-up' },
  { key: 'pre_arrival', label: 'Pre-arrival' }, { key: 'vip_setup', label: 'VIP Setup' }, { key: 'turndown', label: 'Turndown' },
];
type Entry = { key: string; label: string; active: boolean };
const listOf = (cat: State['catalog']): Entry[] | null => {
  const l = (cat as unknown as Record<string, Entry[] | undefined>).cleaningTypes;
  return Array.isArray(l) ? l : null;
};
export const cleaningTypes = (cat: State['catalog']) => listOf(cat)?.filter((t) => t.active) ?? SEED_TYPES;
/** A type key's label (archived ones included); an old row's label shows as written. */
export const typeLabel = (key: string, cat: State['catalog']) => (listOf(cat) ?? SEED_TYPES).find((t) => t.key === key)?.label ?? key;

/** Whole minutes between clock in and clock out (or now while cleaning). */
export function minutes(t: Task, now: number): number | null {
  if (t.clockIn == null) return null;
  return Math.max(0, Math.floor(((t.clockOut ?? now) - t.clockIn) / 60_000));
}
export const fmtMinutes = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

/* ---------- reading ---------- */

const EMPTY: CleanLocal = { add: [], patch: {} };
const localOf = (s: State): CleanLocal => (s.modules.cleaning as CleanSlice | undefined)?.local ?? EMPTY;
export function mergeTasks(s: State): Task[] {
  const l = localOf(s);
  const base = s.cleaning as unknown as Task[];
  const known = new Set(base.map((t) => t.id));
  return [...base, ...l.add.filter((t) => !known.has(t.id))].map((t) => (l.patch[t.id] ? { ...t, ...l.patch[t.id] } : t));
}
export function useTasks(): Task[] {
  const cleaning = useApp((s) => s.cleaning);
  const slice = useApp((s) => s.modules.cleaning);
  return useMemo(() => mergeTasks({ cleaning, modules: { cleaning: slice } } as unknown as State), [cleaning, slice]);
}

/* ---------- actions ---------- */

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

function send(type: string, fields: Record<string, unknown>, change: (s: State) => { add?: Task[]; id?: string; patch?: Partial<Task> }, refs: string[]) {
  runModuleCommand('cleaning', type, fields, (slice, s) => {
    const cur = (slice as CleanSlice | undefined) ?? {};
    const local = cur.local ?? EMPTY;
    const c = change(s);
    if (c.add) return { ...cur, local: { ...local, add: [...local.add, ...c.add] } };
    if (!c.id || !c.patch) return cur;
    return { ...cur, local: { ...local, patch: { ...local.patch, [c.id]: { ...local.patch[c.id], ...c.patch } } } };
  }, refs);
}

export function logClean(i: { room: string; cleanType: string; attendantId?: string; role: 'lead' | 'backup'; clockIn: boolean }) {
  const taskId = uuid();
  const fields: Record<string, unknown> = { taskId, ...i };
  if (!i.attendantId) delete fields.attendantId;
  send('logClean', fields, (s) => ({ add: [{ id: taskId, room: i.room, type: i.cleanType, status: i.clockIn ? 'in_progress' : 'queued', assignee: i.attendantId, role: i.role, clockIn: i.clockIn ? s.now : undefined, createdAt: s.now }] }), [taskId]);
}

export function scheduleClean(i: { rooms: string[]; date: string; cleanType: string }) {
  const taskIds = i.rooms.map(() => uuid());
  send('scheduleClean', { taskIds, ...i }, (s) => ({ add: i.rooms.map((room, n) => ({ id: taskIds[n], room, type: i.cleanType, status: 'scheduled' as const, role: 'lead' as const, schedDate: dayMs(i.date), createdAt: s.now })) }), taskIds);
}

export function clockIn(id: string, attendantId?: string, role?: 'lead' | 'backup') {
  const fields: Record<string, unknown> = { taskId: id };
  if (attendantId) fields.attendantId = attendantId;
  if (role) fields.role = role;
  send('clockIn', fields, (s) => ({ id, patch: { status: 'in_progress', clockIn: s.now, clockOut: undefined, ...(attendantId ? { assignee: attendantId } : {}), ...(role ? { role } : {}) } }), [id]);
}

export function clockOut(id: string) {
  send('clockOut', { taskId: id }, (s) => ({ id, patch: { status: 'done', clockOut: s.now } }), [id]);
}

export interface CleanEdit { room?: string; cleanType?: string; attendantId?: string; clearAttendant?: boolean; role?: 'lead' | 'backup'; schedDate?: string }
export function editClean(id: string, e: CleanEdit) {
  send('editClean', { taskId: id, ...e }, () => ({
    id,
    patch: {
      ...(e.room ? { room: e.room } : {}),
      ...(e.cleanType ? { type: e.cleanType } : {}),
      ...(e.attendantId ? { assignee: e.attendantId } : {}),
      ...(e.clearAttendant ? { assignee: undefined } : {}),
      ...(e.role ? { role: e.role } : {}),
      ...(e.schedDate ? { schedDate: dayMs(e.schedDate) } : {}),
    },
  }), [id]);
}

/* ---------- filters ---------- */
export type CleanFilter = 'all' | CleanStatus;
export const CLEAN_TABS: { value: CleanFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'ready', label: 'Ready' }, { value: 'in_progress', label: 'In Progress' }, { value: 'done', label: 'Done' },
  { value: 'queued', label: 'Queued' }, { value: 'scheduled', label: 'Scheduled' },
];
export const filterTasks = (ts: Task[], f: CleanFilter) => (f === 'all' ? ts : ts.filter((t) => t.status === f));
