import { createStore, go, moduleData, runModuleCommand } from '../../domain/store';
import type { State, Staff } from '../../domain/types';
import { inquiriesOf } from '../inquiries/data';

export type LinkType = 'request' | 'workorder' | 'inquiry' | 'housestatus' | 'crisis';
export interface Reminder {
  id: string;
  desc: string;
  /** A staff id; missing means All HD Staff (every help-desk officer). */
  assignee?: string;
  dueAt?: number;
  notes?: string;
  status: 'pending' | 'completed';
  link?: { type: LinkType; id: string; label: string };
  completedAt?: number;
  completedBy?: string;
  createdBy?: string;
  createdAt: number;
}
export interface ReminderSlice {
  list: Reminder[];
  counts: { pending: number };
}

declare module '../../domain/store' {
  interface ModuleSlices {
    reminders: ReminderSlice;
  }
}

export const ALL_HD = 'All HD Staff';
export const LINK_NAME: Record<LinkType, string> = { request: 'Request', workorder: 'Work order', inquiry: 'Inquiry', housestatus: 'House status', crisis: 'Crisis case' };

export const remindersOf = (s: State): Reminder[] => moduleData(s, 'reminders')?.list ?? [];
/** The sidebar badge: pending reminders. */
export const reminderBadge = (s: State): number => remindersOf(s).filter((r) => r.status === 'pending').length;
/** Pending and past its time. Compared as instants, so the hotel's clock does not matter here. */
export const isOverdue = (r: Reminder, now: number): boolean => r.status === 'pending' && r.dueAt != null && r.dueAt < now;

export type ReminderFilter = 'all' | 'pending' | 'completed';
export const filterReminders = (list: Reminder[], f: ReminderFilter): Reminder[] => (f === 'all' ? list : list.filter((r) => r.status === f));

/** Who can be given a reminder: the roles that can open the module (Azl_Module_Reminders::ASSIGNEES). */
export const assignable = (staff: Staff[]): Staff[] => staff.filter((p) => p.id !== 'member' && ['hdo', 'supervisor', 'manager', 'owner'].includes(p.role));

/* ---------- what a reminder can link to: records the desk already holds ---------- */

export interface LinkOption { key: string; type: LinkType; id: string; label: string; text: string }

/** Any other module's records, when it has sent a list of { id, no } (House Status, Crisis cases). Anything else is skipped. */
function others(s: State, id: string, type: LinkType): LinkOption[] {
  const list = (moduleData<{ list?: unknown }>(s, id)?.list ?? []) as unknown;
  if (!Array.isArray(list)) return [];
  return list.flatMap((r: { id?: unknown; no?: unknown; case?: unknown }) => {
    const no = typeof r?.no === 'string' ? r.no : typeof r?.case === 'string' ? r.case : '';
    return typeof r?.id === 'string' && no ? [{ key: `${type}:${r.id}`, type, id: r.id, label: no, text: `${no}` }] : [];
  });
}

export function linkOptions(s: State): LinkOption[] {
  const req = s.requests.map((r) => ({ key: `request:${r.id}`, type: 'request' as const, id: r.id, label: r.ticket, text: `${r.ticket} Room ${r.room}` }));
  const wos = s.wos.map((w) => ({ key: `workorder:${w.id}`, type: 'workorder' as const, id: w.id, label: w.no, text: `${w.no} ${w.desc.slice(0, 25)}` }));
  const inq = inquiriesOf(s).filter((i) => i.no).map((i) => ({ key: `inquiry:${i.id}`, type: 'inquiry' as const, id: i.id, label: i.no, text: `${i.no} ${i.name}` }));
  return [...req, ...wos, ...inq, ...others(s, 'housestatus', 'housestatus'), ...others(s, 'crisis', 'crisis')];
}

/* ---------- commands ---------- */

export interface NewReminder { desc: string; assignee: string; dueAt: number | null; link: LinkOption | null; notes: string }

export function addReminder(f: NewReminder): string {
  const id = crypto.randomUUID();
  const notes = f.notes.trim();
  runModuleCommand(
    'reminders',
    'addReminder',
    {
      reminderId: id,
      desc: f.desc.trim(),
      ...(f.assignee ? { assignee: f.assignee } : {}),
      ...(f.dueAt != null ? { dueAt: f.dueAt } : {}),
      ...(notes ? { notes } : {}),
      // linkId is left out, never null, when there is no link (the server checks every *Id field is a uuid).
      ...(f.link ? { linkType: f.link.type, linkId: f.link.id, linkLabel: f.link.label } : {}),
    },
    (slice, s) => {
      const cur = (slice as ReminderSlice | undefined) ?? { list: [], counts: { pending: 0 } };
      const row: Reminder = {
        id, desc: f.desc.trim(), assignee: f.assignee || undefined, dueAt: f.dueAt ?? undefined, notes: notes || undefined, status: 'pending', createdAt: s.now, createdBy: s.me ?? undefined,
        link: f.link ? { type: f.link.type, id: f.link.id, label: f.link.label } : undefined,
      };
      // Pending ones first, soonest due first, undated last (as the server lists them).
      const pending = [...cur.list.filter((r) => r.status === 'pending'), row].sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.createdAt - b.createdAt);
      return { ...cur, list: [...pending, ...cur.list.filter((r) => r.status !== 'pending')] };
    },
    [id],
  );
  return id;
}

export function doneReminder(id: string) {
  runModuleCommand('reminders', 'doneReminder', { reminderId: id }, (slice, s) => {
    const cur = slice as ReminderSlice | undefined;
    if (!cur) return slice;
    return { ...cur, list: cur.list.map((r) => (r.id === id && r.status === 'pending' ? { ...r, status: 'completed', completedAt: s.now, completedBy: s.me ?? undefined } : r)) };
  }, [id]);
}

export const reminderForm = createStore({ open: false });
/** Goes to Reminders with the New Reminder form open (the Dashboard's quick action). */
export function openNewReminder() {
  reminderForm.set(() => ({ open: true }));
  go('reminders');
}
