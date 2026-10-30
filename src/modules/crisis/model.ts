// Crisis Mgmt: the crisis case log (the client prototype's radio-code cases) behind the safety lane.
// The server is azalea-ehelpdesk/includes/Modules/Crisis.php; this file holds the slice's types, the lists, the
// commands with their optimistic changes, and the small rules the screen shares with the badge.
import { HAZARDS } from '../../domain/rules';
import { app, createStore, moduleData, myStaff, runModuleCommand, setUI, toast } from '../../domain/store';
import type { Hazard, Incident, State } from '../../domain/types';

export type CaseStatus = 'active' | 'monitoring' | 'resolved';
export interface CaseUpdate { at: number; by: string; text: string }
export interface Call911 { by: string; at: string }
export interface LinkedAlert { id: string; no: string; hazard: Hazard; rooms: string[]; status: Incident['status']; createdAt: number; called911: Call911 | null }
export interface CrisisCase {
  id: string;
  no: string;
  code: string | null;
  category: string | null;
  reportedBy: string | null;
  whoType: string | null;
  who: string | null;
  location: string | null;
  place: string | null;
  what: string | null;
  occurredAt: number;
  status: CaseStatus;
  resolution: string | null;
  resolvedAt: number | null;
  incidentId: string | null;
  incident: LinkedAlert | null;
  called911: Call911 | null;
  loggedBy: string;
  createdAt: number;
  updates: CaseUpdate[];
}
export interface CrisisSlice { cases: CrisisCase[]; counts?: Record<string, number> }

declare module '../../domain/store' {
  interface ModuleSlices { crisis: CrisisSlice }
}

export const casesOf = (s: State): CrisisCase[] => moduleData(s, 'crisis')?.cases ?? [];
export const isOpenCase = (c: Pick<CrisisCase, 'status'>) => c.status !== 'resolved';

/**
 * The sidebar count: unresolved cases plus active safety alerts that no unresolved case covers yet. An alert and the
 * case opened from it are one crisis, counted once; an alert nobody has opened a case for still counts.
 */
export function unresolvedCount(s: State): number {
  const cases = casesOf(s).filter(isOpenCase);
  const covered = new Set(cases.map((c) => c.incidentId).filter(Boolean));
  return cases.length + s.incidents.filter((i) => i.status === 'active' && !covered.has(i.id)).length;
}

/* ---------- the hotel's lists (Configuration), with the prototype's values until the server sends them ---------- */

export interface ListEntry { key: string; label: string; active: boolean; code?: string; complaint?: boolean; detail?: string }
export type ListKey = 'crisisCodes' | 'complaintCategories' | 'crisisLocations' | 'involvedTypes';
const plain = (labels: string[]): ListEntry[] => labels.map((label) => ({ key: keyOf(label), label, active: true }));
/** The same keys the server makes from the labels (Azl_Catalog::make_key). */
export const keyOf = (label: string) => label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
const CODES: [string, string, boolean?][] = [['10-9', 'Medical Emergency'], ['10-28', 'Guest Complaint', true], ['10-1', 'Fire'], ['10-2', 'Earthquake'], ['10-3', 'Typhoon'], ['10-4', 'Bomb Threat'], ['10-5', 'Power Outage'], ['10-6', 'Water Interruption'], ['10-7', 'Security Threat'], ['10-8', 'Civil Disturbance'], ['10-0', 'Other']];
export const SEED_LISTS: Record<ListKey, ListEntry[]> = {
  crisisCodes: CODES.map(([code, label, complaint]) => ({ key: keyOf(label), label, code, complaint: !!complaint, active: true })),
  complaintCategories: plain(['Room Condition', 'Noise', 'Cleanliness', 'Food Quality', 'Service Attitude', 'Billing', 'Amenities', 'AC / Temperature', 'WiFi / Internet', 'Wait Time', 'Other']),
  crisisLocations: plain(['Room', 'Lobby', 'Restaurant', 'Pool Area', 'Gym / Fitness Center', 'Parking Area', 'Elevator', 'Hallway / Corridor', 'Reception / Front Desk', 'Back Office', 'Kitchen', 'Laundry', 'Staff Area', 'Function Room', 'Garden / Outdoor', 'Other'])
    .map((e) => ({ ...e, detail: e.key === 'room' ? 'Room No.' : e.key === 'other' ? 'Specify' : '' })),
  involvedTypes: plain(['In-house Guest', 'Non-guest', 'Restaurant Guest', 'Supplier', 'Staff']),
};

/** One of the crisis lists from the hotel's lists, or the prototype's values when the server sent none. */
export function listOf(s: State, key: ListKey): ListEntry[] {
  const fromServer = (s.catalog as unknown as Record<string, unknown>)[key];
  return Array.isArray(fromServer) ? (fromServer as ListEntry[]) : SEED_LISTS[key];
}
export const entryOf = (list: ListEntry[], key: string | null | undefined) => (key ? list.find((e) => e.key === key) : undefined);
/** "10-9 Medical Emergency"; an unknown key shows as itself. */
export const codeLabel = (list: ListEntry[], key: string | null | undefined): string => {
  const e = entryOf(list, key);
  return e ? (e.code ? `${e.code} ${e.label}` : e.label) : key ?? '';
};
export const labelOf = (list: ListEntry[], key: string | null | undefined): string => entryOf(list, key)?.label ?? key ?? '';

/** Where, as one line: "Room 405", "Lobby", "Other: rooftop". */
export function whereText(locations: ListEntry[], c: Pick<CrisisCase, 'location' | 'place'>): string {
  const e = entryOf(locations, c.location);
  if (!e) return c.place ?? '';
  if (!c.place) return e.label;
  return e.key === 'room' ? `Room ${c.place}` : `${e.label}: ${c.place}`;
}

/** Hazard of a safety alert => the radio code a case opened from it starts with (same map as the server). */
export const HAZARD_CODE: Record<Hazard, string> = { smoke: 'fire', medical: 'medical_emergency', threat: 'security_threat', gas: 'other', flood: 'other', lift: 'other' };

/* ---------- time: the hotel's local time ---------- */

const TZ = 'Asia/Manila';
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
/** "Oct 30, 9:50 PM" in Manila time, whatever the device's zone. */
export const when = (ms: number) => fmt.format(new Date(ms));
export const clock = (ms: number) => fmtTime.format(new Date(ms));
/** A 911 record's time: the server sends ISO, the alert screen may still hold the "9:50 PM" it showed. */
export const callTime = (at: string) => (Number.isNaN(Date.parse(at)) ? at : when(Date.parse(at)));
/** Epoch ms as the value of a datetime-local input, in Manila time (UTC+8, no daylight saving). */
export const toLocalInput = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 16);
/** A datetime-local value (Manila) as ISO with its offset, for the server; null when empty or not a date. */
export const fromLocalInput = (v: string): string | null => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}:00+08:00`)) ? `${v}:00+08:00` : null);

/* ---------- the open case (the screen's own selection; App's detail pane is for requests and work orders) ---------- */

export const crisisUI = createStore<{ open?: string }>({});
export const openCase = (id: string | undefined) => crisisUI.set(() => ({ open: id }));

/* ---------- commands: optimistic change, then the outbox (runModuleCommand) ---------- */

export interface CaseFields {
  code: string; category: string; reportedBy: string; whoType: string; who: string; location: string; place: string; what: string;
  /** datetime-local value in Manila time */
  occurred: string;
}
export const emptyFields = (now: number): CaseFields => ({ code: '', category: '', reportedBy: '', whoType: '', who: '', location: '', place: '', what: '', occurred: toLocalInput(now) });
export const fieldsOf = (c: CrisisCase): CaseFields => ({ code: c.code ?? '', category: c.category ?? '', reportedBy: c.reportedBy ?? '', whoType: c.whoType ?? '', who: c.who ?? '', location: c.location ?? '', place: c.place ?? '', what: c.what ?? '', occurred: toLocalInput(c.occurredAt) });

/** What the form may not send, in plain words, or null. A code alone (or a category) is enough. */
export function problemOf(f: CaseFields, codes: ListEntry[], hasAlert = false): string | null {
  if (!f.code && !f.category && !hasAlert) return 'Choose a radio code or a complaint category';
  if (f.category && f.code && !entryOf(codes, f.code)?.complaint) return 'A complaint category goes with a guest complaint code';
  if (!fromLocalInput(f.occurred)) return 'Enter the date and time';
  if (Date.parse(fromLocalInput(f.occurred)!) > Date.now() + 5 * 60_000) return 'The time cannot be in the future';
  return null;
}

/** The command fields: empty texts are left out, so the server stores nothing for them. */
function wire(f: CaseFields) {
  const out: Record<string, string> = {};
  for (const k of ['code', 'category', 'reportedBy', 'whoType', 'who', 'location', 'place', 'what'] as const) if (f[k].trim()) out[k] = f[k].trim();
  const at = fromLocalInput(f.occurred);
  if (at) out.occurredAt = at;
  return out;
}
const columns = (f: CaseFields) => {
  const w = wire(f);
  const v = (k: keyof typeof w) => w[k] ?? null;
  return { code: v('code'), category: v('category'), reportedBy: v('reportedBy'), whoType: v('whoType'), who: v('who'), location: v('location'), place: v('place'), what: v('what'), occurredAt: w.occurredAt ? Date.parse(w.occurredAt) : Date.now() };
};

const meName = (s: State) => (s.me === 'member' ? 'a manager' : myStaff(s)?.name ?? 'a manager');
const slice = (x: unknown): CrisisSlice => (x as CrisisSlice | undefined) ?? { cases: [] };
const nextNo = (cases: CrisisCase[]) => `CR-${String(cases.reduce((m, c) => Math.max(m, Number(c.no.slice(3)) || 0), 0) + 1).padStart(4, '0')}`;
/** Changes one case in the slice and adds a line to its updates, as the server will. */
function patch(id: string, type: string, fields: Record<string, unknown>, change: Partial<CrisisCase>, line?: string) {
  runModuleCommand('crisis', type, { caseId: id, ...fields }, (x, s) => {
    const sl = slice(x);
    return { ...sl, cases: sl.cases.map((c) => (c.id === id ? { ...c, ...change, updates: line ? [...c.updates, { at: Date.now(), by: meName(s), text: line }] : c.updates } : c)) };
  }, [id]);
}

/** Logs a case and opens it. With an alert, the case is linked to it. Returns the new case id. */
export function logCase(f: CaseFields, alert?: Incident): string {
  const id = crypto.randomUUID();
  runModuleCommand('crisis', 'logCrisis', { caseId: id, ...wire(f), ...(alert ? { incidentId: alert.id } : {}) }, (x, s) => {
    const sl = slice(x);
    const c: CrisisCase = {
      id, no: nextNo(sl.cases), ...columns(f), status: 'active', resolution: null, resolvedAt: null,
      incidentId: alert?.id ?? null,
      incident: alert ? { id: alert.id, no: alert.no, hazard: alert.hazard, rooms: alert.rooms, status: alert.status, createdAt: alert.createdAt, called911: alert.called911 ?? null } : null,
      called911: null, loggedBy: meName(s), createdAt: Date.now(),
      updates: alert ? [{ at: Date.now(), by: meName(s), text: `Opened from safety alert ${alert.no}` }] : [],
    };
    return { ...sl, cases: [c, ...sl.cases] };
  }, [id]);
  return id;
}

/**
 * "Open a case" on a safety alert: one tap, no typing. The case starts with the hazard's code, the rooms, the time
 * the alert started and what was said, and is linked to the alert. A case already opened for it is shown instead.
 */
export function openCaseFromAlert(alert: Incident): string {
  const s = app.get();
  const existing = casesOf(s).find((c) => c.incidentId === alert.id);
  let id = existing?.id;
  if (!id) {
    const codes = listOf(s, 'crisisCodes');
    const code = entryOf(codes, HAZARD_CODE[alert.hazard])?.active ? HAZARD_CODE[alert.hazard] : '';
    const room = entryOf(listOf(s, 'crisisLocations'), 'room')?.active ? 'room' : '';
    const f: CaseFields = { ...emptyFields(alert.createdAt), code, location: room, place: alert.rooms.join(', ').slice(0, 80), what: `${HAZARDS[alert.hazard].label}: “${alert.text}”`.slice(0, 2000) };
    id = logCase(f, alert);
    toast(`Case opened from ${alert.no}. Keep using the radio; add details when you can.`, 'success');
  }
  openCase(id);
  setUI({ tab: 'crisis', sheet: null });
  return id;
}

export const updateCase = (id: string, text: string) => patch(id, 'updateCrisis', { text }, {}, text.trim());
export const monitorCase = (id: string, text: string) => patch(id, 'monitorCrisis', { text }, { status: 'monitoring' }, `Monitoring: ${text.trim()}`);
export const closeCase = (id: string, resolution: string) => patch(id, 'closeCrisis', { resolution }, { status: 'resolved', resolution: resolution.trim(), resolvedAt: Date.now() }, `Closed: ${resolution.trim()}`);
export const reopenCase = (id: string) => patch(id, 'reopenCrisis', {}, { status: 'monitoring', resolution: null, resolvedAt: null }, 'Reopened');
export const editCase = (id: string, f: CaseFields) => {
  const w = wire(f);
  // The server compares and writes the exact change into the updates; the optimistic line is a plain one.
  patch(id, 'editCrisis', w, columns(f), 'Edited');
};
export const linkAlert = (id: string, alert: Incident) =>
  patch(id, 'linkCrisisIncident', { incidentId: alert.id }, { incidentId: alert.id, incident: { id: alert.id, no: alert.no, hazard: alert.hazard, rooms: alert.rooms, status: alert.status, createdAt: alert.createdAt, called911: alert.called911 ?? null } }, `Linked to safety alert ${alert.no}`);
export const recordCase911 = (id: string) => {
  const at = new Date().toISOString();
  patch(id, 'recordCrisis911', { at }, { called911: { by: meName(app.get()), at } }, `BFP/911 called at ${clock(Date.parse(at))}`);
};
