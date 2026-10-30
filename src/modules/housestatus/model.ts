// House Status: the data the server sends (snapshot.modules.housestatus), the checks a form runs before it sends, and the
// commands with their optimistic change. Pure functions: the screen only draws them.
import { moduleData, runModuleCommand } from '../../domain/store';
import type { State } from '../../domain/types';

export type HsStatus = 'monitoring' | 'pending' | 'closed';
export interface HsUpdate { at: number; by: string; text: string }
export interface HsLog {
  id: string;
  /** "HS-0001"; empty until the server has numbered a log made on this device. */
  no: string;
  narration: string;
  status: HsStatus;
  /** The staff id who logged it; empty for a manager's own account. */
  loggedBy: string;
  createdAt: number;
  closedAt?: number;
  updates: HsUpdate[];
}
export interface HsSlice { logs: HsLog[]; open?: number }

declare module '../../domain/store' {
  interface ModuleSlices { housestatus: HsSlice }
}

export const STATUS_LABEL: Record<HsStatus, string> = { monitoring: 'Monitoring', pending: 'Pending', closed: 'Closed' };
export const TEXT_MAX = 2000;

export const logsOf = (s: State): HsLog[] => moduleData(s, 'housestatus')?.logs ?? [];
export const isNotClosed = (l: HsLog) => l.status !== 'closed';
/** The sidebar badge: logs not closed. */
export const badge = (s: State): number => logsOf(s).filter(isNotClosed).length;

export type Filter = 'all' | 'open' | 'closed';
export const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'open', label: 'Not closed' }, { value: 'closed', label: 'Closed' }];
export const visible = (logs: HsLog[], f: Filter): HsLog[] => (f === 'all' ? logs : logs.filter((l) => isNotClosed(l) === (f === 'open')));

/* ---------- the checks a form runs (the server runs the same ones) ---------- */

export interface Problems { narration?: string; text?: string; note?: string; status?: string }
const long = (v: string, what: string, max = TEXT_MAX) => (v.trim().length > max ? `Keep the ${what} under ${max} characters.` : undefined);

export function checkLog(v: { narration: string }): Problems {
  return { narration: v.narration.trim() ? long(v.narration, 'narration') : 'Incident narration is required.' };
}
export function checkUpdate(v: { text: string }): Problems {
  return { text: v.text.trim() ? long(v.text, 'update') : 'Update is required.' };
}
export const checkClose = (v: { note: string }): Problems => ({ note: long(v.note, 'closing note', TEXT_MAX - 2) });
export const clean = (p: Problems): boolean => Object.values(p).every((x) => !x);

/* ---------- the optimistic changes (the next snapshot replaces them with the server's) ---------- */

const put = (slice: HsSlice | undefined, fn: (logs: HsLog[]) => HsLog[]): HsSlice => {
  const logs = fn(slice?.logs ?? []);
  return { logs, open: logs.filter(isNotClosed).length };
};
const patch = (id: string, fn: (l: HsLog) => HsLog) => (slice: HsSlice | undefined) => put(slice, (logs) => logs.map((l) => (l.id === id ? fn(l) : l)));
const note = (by: string, at: number, text: string): HsUpdate => ({ at, by, text });

export function withLog(slice: HsSlice | undefined, log: HsLog): HsSlice {
  return put(slice, (logs) => [log, ...logs]);
}
export const withUpdate = (id: string, u: HsUpdate) => patch(id, (l) => ({ ...l, updates: [...l.updates, u] }));
export const withClose = (id: string, u: HsUpdate) => patch(id, (l) => ({ ...l, status: 'closed', closedAt: u.at, updates: [...l.updates, u] }));
export const withReopen = (id: string, u: HsUpdate) => patch(id, (l) => ({ ...l, status: 'monitoring', closedAt: undefined, updates: [...l.updates, u] }));
export function withEdit(id: string, v: { narration: string; status: HsStatus }, at: number, by: string) {
  return patch(id, (l) => {
    const what = [l.narration !== v.narration.trim() && 'narration changed', l.status !== v.status && `status ${l.status} to ${v.status}`].filter(Boolean).join(', ');
    return { ...l, narration: v.narration.trim(), status: v.status, closedAt: v.status === 'closed' ? (l.closedAt ?? at) : undefined, updates: what ? [...l.updates, note(by, at, `Edited: ${what}`)] : l.updates };
  });
}

/* ---------- the commands ---------- */

const MOD = 'housestatus';
const me = (s: State) => s.me ?? 'system';

export function logHouse(v: { narration: string; status: 'monitoring' | 'pending' }) {
  const houseId = crypto.randomUUID();
  const narration = v.narration.trim();
  runModuleCommand(MOD, 'logHouse', { houseId, narration, status: v.status }, (sl, s) => withLog(sl as HsSlice | undefined, { id: houseId, no: '', narration, status: v.status, loggedBy: s.me ?? '', createdAt: s.now, updates: [] }), [houseId]);
}
export function updateHouse(id: string, text: string) {
  runModuleCommand(MOD, 'updateHouse', { houseId: id, text: text.trim() }, (sl, s) => withUpdate(id, note(me(s), s.now, text.trim()))(sl as HsSlice | undefined), [id]);
}
export function closeHouse(id: string, text: string) {
  const t = text.trim();
  runModuleCommand(MOD, 'closeHouse', { houseId: id, note: t }, (sl, s) => withClose(id, note(me(s), s.now, t ? `Closed: ${t}` : 'Closed'))(sl as HsSlice | undefined), [id]);
}
export function reopenHouse(id: string) {
  runModuleCommand(MOD, 'reopenHouse', { houseId: id }, (sl, s) => withReopen(id, note(me(s), s.now, 'Reopened'))(sl as HsSlice | undefined), [id]);
}
export function editHouse(id: string, v: { narration: string; status: HsStatus }) {
  runModuleCommand(MOD, 'editHouse', { houseId: id, narration: v.narration.trim(), status: v.status }, (sl, s) => withEdit(id, v, s.now, me(s))(sl as HsSlice | undefined), [id]);
}
