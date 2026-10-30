import { createStore, go, moduleData, runModuleCommand } from '../../domain/store';
import type { State } from '../../domain/types';
import { addDays, dayKey } from './hotelTime';

export type InquiryType = 'in_house' | 'external' | 'checked_out';
export type InquiryStatus = 'active' | 'noted' | 'done';

export interface Inquiry {
  id: string;
  /** "I-0001". Empty until the server has numbered a new one. */
  no: string;
  name: string;
  type: InquiryType;
  room?: string;
  desc: string;
  /** The help-desk officer's staff id. */
  hdo?: string;
  status: InquiryStatus;
  createdAt: number;
  closedAt?: number;
  /** Closed within 6 minutes of being logged. */
  quick?: boolean;
  history: { at: number; by: string; what: string }[];
}

export interface InquirySlice {
  list: Inquiry[];
  counts: { active: number; noted: number };
}

declare module '../../domain/store' {
  interface ModuleSlices {
    inquiries: InquirySlice;
  }
}

/** The prototype's words for the three kinds of caller. */
export const TYPE_LABEL: Record<InquiryType, string> = { in_house: 'In-house Guest', external: 'External', checked_out: 'Checked-out' };
/** The same, lower case, as the table's Type column writes them. */
export const TYPE_SHORT: Record<InquiryType, string> = { in_house: 'in house', external: 'external', checked_out: 'checked out' };

export const inquiriesOf = (s: State): Inquiry[] => moduleData(s, 'inquiries')?.list ?? [];

/** The sidebar badge: active plus noted (the prototype's count). */
export const inquiryBadge = (s: State): number => inquiriesOf(s).filter((i) => i.status !== 'done').length;

export type StatusFilter = 'all' | 'active' | 'done';
export interface InquiryFilter {
  status: StatusFilter;
  /** Hotel days "YYYY-MM-DD", both ends included; '' is open-ended. */
  from: string;
  to: string;
}
export const NO_FILTER: InquiryFilter = { status: 'all', from: '', to: '' };

/** "Active" is everything not done (noted too), as the prototype defines it. Days are the hotel's, never UTC's. */
export function filterInquiries(list: Inquiry[], f: InquiryFilter): Inquiry[] {
  return list.filter((i) => {
    if (f.status === 'active' && i.status === 'done') return false;
    if (f.status === 'done' && i.status !== 'done') return false;
    const day = dayKey(i.createdAt);
    return (!f.from || day >= f.from) && (!f.to || day <= f.to);
  });
}

/** The Today and Week shortcuts as a date range in the hotel's time ("Week" is today and the 6 days before). */
export function preset(p: 'today' | 'week' | 'all', now: number): Pick<InquiryFilter, 'from' | 'to'> {
  const today = dayKey(now);
  return p === 'all' ? { from: '', to: '' } : { from: p === 'today' ? today : addDays(today, -6), to: today };
}

/** Open ones first (newest first), then the done ones (newest first). */
export const sortInquiries = (list: Inquiry[]): Inquiry[] =>
  [...list].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.createdAt - a.createdAt);

/* ---------- commands ---------- */

const QUICK_MS = 360_000;
const labelOf = { noteInquiry: 'Noted', closeInquiry: 'Closed', reopenInquiry: 'Reopened' } as const;

function patch(id: string, type: keyof typeof labelOf, fn: (i: Inquiry, now: number) => Partial<Inquiry> | null) {
  runModuleCommand('inquiries', type, { inquiryId: id }, (slice, s) => {
    const cur = slice as InquirySlice | undefined;
    if (!cur) return slice;
    return { ...cur, list: cur.list.map((i) => {
      const p = i.id === id ? fn(i, s.now) : null;
      return p ? { ...i, ...p, history: [...i.history, { at: s.now, by: s.me ?? 'system', what: labelOf[type] }] } : i;
    }) };
  }, [id]);
}

export const noteInquiry = (id: string) => patch(id, 'noteInquiry', (i) => (i.status === 'active' ? { status: 'noted' } : null));
export const closeInquiry = (id: string) => patch(id, 'closeInquiry', (i, now) => (i.status !== 'done' ? { status: 'done', closedAt: now, quick: now - i.createdAt <= QUICK_MS } : null));
export const reopenInquiry = (id: string) => patch(id, 'reopenInquiry', (i) => (i.status !== 'active' ? { status: 'active', closedAt: undefined, quick: false } : null));

export interface NewInquiry { type: InquiryType; name: string; room: string; hdo: string; desc: string }

/** Logs an inquiry: shows it at once, and the server numbers it (the next snapshot brings I-0001). */
export function logInquiry(f: NewInquiry): string {
  const id = crypto.randomUUID();
  const room = f.room.trim();
  runModuleCommand(
    'inquiries',
    'logInquiry',
    { inquiryId: id, contactType: f.type, name: f.name.trim(), desc: f.desc.trim(), ...(room ? { room } : {}), ...(f.hdo ? { hdo: f.hdo } : {}) },
    (slice, s) => {
      const cur = (slice as InquirySlice | undefined) ?? { list: [], counts: { active: 0, noted: 0 } };
      const row: Inquiry = { id, no: '', name: f.name.trim(), type: f.type, room: room || undefined, desc: f.desc.trim(), hdo: f.hdo || undefined, status: 'active', createdAt: s.now, history: [{ at: s.now, by: s.me ?? 'system', what: 'Logged' }] };
      return { ...cur, list: [row, ...cur.list] };
    },
    [id],
  );
  return id;
}

/* ---------- the new-inquiry form: opened from this screen or from anywhere (the Dashboard's quick action) ---------- */

export const inquiryForm = createStore({ open: false });
/** Goes to Inquiries with the New Inquiry form open. */
export function openNewInquiry() {
  inquiryForm.set(() => ({ open: true }));
  go('inquiries');
}
