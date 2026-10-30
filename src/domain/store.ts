import { useSyncExternalStore } from 'react';
import { buildSeed } from './seed';
import { HAZARDS, STAFF, detectSafety, hubUp, isOpen, pad, undoTarget } from './rules';
import { SEED_CATALOG, canEscalate, deptLabel, isCatalog, type Catalog } from './catalog';
import { haptic, hapticsConfig, tone } from '../lib/haptics';
import type { Hazard, HoldReason, Item, Incident, Prefs, Request, State, Toast, WorkOrder } from './types';
import { OTHER_SLA_MIN, QTY_MAX, type NewRow, type RequestCommand, type Source } from '../modules/requests/commands';
import type { Snapshot } from './contract';
import { remote, type Draft } from './remote';
import type { Level, Matrix } from '../modules/access';

/* ---------- tiny observable store (SwiftUI @Observable in spirit) ---------- */
export function createStore<S>(init: S) {
  let s = init;
  const subs = new Set<() => void>();
  return {
    get: () => s,
    set: (fn: (p: S) => S) => {
      s = fn(s);
      subs.forEach((f) => f());
    },
    sub: (f: () => void) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}

let counter = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(++counter).toString(36)}`;
/** Domain ids. Server-backed mode needs real uuids so the optimistic row is the stored row. */
const nid = (p: string) => (remote.active ? crypto.randomUUID() : uid(p));
/** Report a change that already happened locally to the server. No-op until the desk is connected. */
const send = (d: Draft) => remote.send(d);

export function initialState(now = Date.now()): State {
  const seed = buildSeed(now);
  return {
    now,
    me: null,
    catalog: SEED_CATALOG,
    staff: STAFF,
    requests: seed.requests,
    items: seed.items,
    wos: seed.wos,
    cleaning: seed.cleaning,
    incidents: [],
    seq: seed.seq,
    net: { internet: true, deviceWifi: true, power: true, tier: 'resilient', ups: 100 },
    ops: [],
    pending: [],
    reconciling: false,
    netlog: [],
    handover: {},
    modules: {},
    prefs: { textScale: 1, contrast: false, motion: 'auto', haptics: true, sound: true, shortcuts: true },
    toasts: [],
    announce: '',
  };
}

export const app = createStore<State>(initialState());
export function useApp<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(app.sub, () => sel(app.get()), () => sel(app.get()));
}
export function resetApp(now = Date.now()) {
  const keep = { me: app.get().me, prefs: app.get().prefs };
  app.set(() => ({ ...initialState(now), ...keep }));
  syncPrefs(app.get().prefs);
}

/* ---------- ui state ---------- */
/** The open screen: a module id from src/modules/registry.ts. */
export type Tab = string;
export type Sheet = null | 'composer' | 'safety' | 'paper' | 'more' | 'incident';
export type AccountRole = 'owner' | 'manager' | 'supervisor' | 'device';
/** The WordPress account this desk is signed in with, and the hotel it belongs to. */
export interface Account {
  name: string;
  role: AccountRole;
  hotel: string;
  logoUrl: string;
  /** The modules this account may see, from the server (window.AZL.user.modules). Empty on a shared phone. */
  modules?: Record<string, Level>;
}
export interface UI {
  screen: 'lock' | 'app';
  tab: Tab;
  /** The server's role matrix (window.AZL.access); src/modules/access.ts MATRIX until it arrives. */
  access?: Matrix;
  selItem?: string;
  selWo?: string;
  sheet: Sheet;
  composerSeed?: { room?: string; text?: string; preset?: string };
  focusSafetyId?: string;
  /** True once the desk is wired to the server and the first snapshot arrived. */
  remote: boolean;
  /** Changes saved on this device that the server has not accepted yet. */
  sync: { pending: number; offline: boolean };
  /** The last poll for changes failed. */
  pollDown: boolean;
  /** A shared phone's account: no manager mode, so staff must sign in with a PIN. */
  deviceOnly: boolean;
  account: Account;
}
export const ui = createStore<UI>({ screen: 'lock', tab: 'dashboard', sheet: null, remote: false, sync: { pending: 0, offline: false }, pollDown: false, deviceOnly: false, account: { name: '', role: 'device', hotel: '', logoUrl: '' } });
export function useUI<T>(sel: (s: UI) => T): T {
  return useSyncExternalStore(ui.sub, () => sel(ui.get()), () => sel(ui.get()));
}
/** Owners and managers edit the hotel's lists (the server's azl_manage_lists); supervisors and shared phones only read them. */
export const canEditLists = (role: AccountRole) => role === 'owner' || role === 'manager';
export const setUI = (p: Partial<UI>) => ui.set((s) => ({ ...s, ...p }));
export const go = (tab: Tab) => setUI({ tab, selItem: undefined, selWo: undefined, sheet: null });
export const openComposer = (seed?: UI['composerSeed']) => setUI({ sheet: 'composer', composerSeed: seed });

/* ---------- helpers ---------- */
const meName = (s: State) => s.staff.find((p) => p.id === s.me)?.name ?? 'System';
const ev = (s: State, what: string) => ({ at: s.now, by: s.me ?? 'system', what });

export function toast(text: string, tone_: Toast['tone'] = 'info') {
  const id = uid('t');
  app.set((s) => ({ ...s, toasts: [...s.toasts.slice(-2), { id, text, tone: tone_ }] }));
  setTimeout(() => app.set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 3600);
}

export function syncPrefs(p: Prefs) {
  hapticsConfig.enabled = p.haptics;
  hapticsConfig.sound = p.sound;
}
export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  app.set((s) => ({ ...s, prefs: { ...s.prefs, [k]: v } }));
  syncPrefs(app.get().prefs);
}

/* ---------- local change log (the offline queue indicator for rows) ---------- */
function commit(label: string, fn: (s: State) => State, refs: string[] = []) {
  const reach = hubUp(app.get().net);
  app.set((s) => {
    const n = fn({ ...s, now: Date.now() });
    if (n === undefined) return s;
    return {
      ...n,
      ops: [{ id: uid('op'), label, at: n.now, synced: reach }, ...n.ops].slice(0, 80),
      pending: reach ? n.pending : Array.from(new Set([...n.pending, ...refs])),
    };
  });
}

export function reconcile() {
  app.set((s) => ({ ...s, reconciling: true }));
  setTimeout(() => {
    const n = app.get().ops.filter((o) => !o.synced).length;
    app.set((s) => ({
      ...s,
      reconciling: false,
      ops: s.ops.map((o) => ({ ...o, synced: true })),
      pending: [],
      netlog: [{ at: Date.now(), text: `Reconciled ${n} queued change${n === 1 ? '' : 's'}. No conflicts.` }, ...s.netlog].slice(0, 40),
    }));
    if (n > 0) {
      toast(`Caught up. ${n} change${n === 1 ? '' : 's'} synced.`, 'success');
      haptic('success');
      tone('success');
    }
  }, 1300);
}

export function setNet(p: Partial<State['net']>, note?: string) {
  const before = hubUp(app.get().net);
  app.set((s) => ({
    ...s,
    net: { ...s.net, ...p },
    netlog: note ? [{ at: Date.now(), text: note }, ...s.netlog].slice(0, 40) : s.netlog,
  }));
  const after = hubUp(app.get().net);
  if (!before && after) reconcile();
  if (before && !after) {
    toast('Offline. This device keeps working and will catch up.', 'warn');
    haptic('warning');
  }
}

/** One-second heartbeat: clock plus UPS drain on a power cut. */
export function tick() {
  app.set((s) => {
    let ups = s.net.ups;
    if (!s.net.power) ups = Math.max(0, ups - 4);
    else if (ups < 100) ups = Math.min(100, ups + 10);
    const wasOn = s.net.ups > 0;
    const netlog = !s.net.power && wasOn && ups === 0 ? [{ at: Date.now(), text: 'UPS exhausted. Edge node and access points are down.' }, ...s.netlog] : s.netlog;
    return { ...s, now: Date.now(), net: ups === s.net.ups ? s.net : { ...s.net, ups }, netlog };
  });
  const s = app.get();
  if (!s.net.power && s.net.ups === 0 && !paperAnnounced) {
    paperAnnounced = true;
    toast('Battery empty. Switch to the paper kit.', 'error');
    haptic('error');
  }
  if (s.net.power) paperAnnounced = false;
}
let paperAnnounced = false;
export const paperMode = (s: State) => !s.net.power && s.net.ups <= 0;

/* ---------- auth ---------- */
export function unlock(id: string) {
  app.set((s) => ({ ...s, me: id }));
  setUI({ screen: 'app', sheet: null });
}
export function lock() {
  setUI({ screen: 'lock', sheet: null });
}

/* ---------- requests ---------- */
export interface LogInput {
  room: string;
  presets?: string[];
  /** New Request rows (request types or "Other" items with qty and assignee). Sent instead of presets. */
  rows?: NewRow[];
  bundle?: string;
  remarks?: string;
  later?: boolean;
  vip?: boolean;
  /** Who asked. Without it the request keeps the pre-wave-2 value 'staff'. */
  source?: Source;
  staffName?: string;
  /** The HDO's staff id; the person logging by default. */
  hdo?: string;
}

/** The hotel's active request type or bundle with this key (archived ones are not offered for new work). */
const activeType = (cat: Catalog, key: string) => cat.requestTypes.find((x) => x.key === key && x.active);
const activeBundle = (cat: Catalog, key?: string) => cat.bundles.find((x) => x.key === key && x.active);
const activeDept = (cat: Catalog, key?: string) => cat.departments.some((d) => d.key === key && d.active);
/** The signed-in person when they are a staff row (a manager account acting as itself is 'member', not one). */
const meStaff = (s: State) => (s.me && s.me !== 'member' ? s.me : undefined);

/** An item spec from a row: [name, dept, slaMin, qty, assignee], or null when the row is not valid here. */
function rowSpec(cat: Catalog, r: NewRow): [string, string, number, number, string | undefined] | null {
  const qty = r.qty ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > QTY_MAX) return null;
  if (r.type) {
    const p = activeType(cat, r.type);
    return p ? [p.label, p.dept, p.slaMin, qty, r.assignee] : null;
  }
  const name = (r.other ?? '').trim();
  return name && activeDept(cat, r.dept) ? [name, r.dept!, OTHER_SLA_MIN, qty, r.assignee] : null;
}

export function logRequest(o: LogInput): string {
  const reqId = nid('r');
  const refs: string[] = [reqId];
  const cat = app.get().catalog;
  const later = !!o.later;
  const presets = later ? [] : (o.presets ?? []).filter((k) => activeType(cat, k));
  const rows = later ? [] : (o.rows ?? []).filter((r) => rowSpec(cat, r));
  const bundle = later ? undefined : activeBundle(cat, o.bundle);
  const specs = [
    ...(o.rows ? rows.map((r) => rowSpec(cat, r)!) : presets.map((k) => { const p = activeType(cat, k)!; return [p.label, p.dept, p.slaMin, 1, undefined] as const; })),
  ];
  const itemIds = [...specs.map(() => nid('i')), ...(bundle ? bundle.parts.map(() => nid('i')) : [])];
  const s0 = app.get();
  const me = meStaff(s0);
  const hdo = o.hdo ?? me;
  let next = 0;
  commit(`Log request, room ${o.room}`, (s) => {
    const n = s.seq.t + 1;
    const items: Record<string, Item> = {};
    const ids: string[] = [];
    const mk = (name: string, dept: Item['dept'], slaMin: number, dependsOn?: string, qty = 1, assignee?: string): string => {
      const id = itemIds[next++];
      ids.push(id);
      refs.push(id);
      items[id] = { id, requestId: reqId, name, qty, dept, assignee, status: 'new', createdAt: s.now, heldMs: 0, slaMin, dependsOn, events: [ev(s, 'Logged')] };
      return id;
    };
    for (const [name, dept, sla, qty, who] of specs) mk(name, dept, sla, undefined, qty, who);
    if (bundle) {
      const made: string[] = [];
      for (const part of bundle.parts) made.push(mk(part.name, part.dept, part.slaMin, part.after != null ? made[part.after] : undefined));
    }
    const staffName = o.source === 'staff_request' ? o.staffName?.trim() : undefined;
    return {
      ...s,
      seq: { ...s.seq, t: n },
      requests: [
        { id: reqId, ticket: `T-${pad(n)}`, room: o.room, source: o.source ?? 'staff', staffName, hdo, remarks: o.remarks, loggedBy: s.me ?? 's-maria', createdAt: s.now, itemIds: ids, incomplete: later || ids.length === 0, vip: o.vip, events: [ev(s, 'Logged')] },
        ...s.requests,
      ],
      items: { ...s.items, ...items },
    };
  }, refs);
  const cmd: RequestCommand = {
    type: 'logRequest', requestId: reqId, itemIds, room: o.room, bundle: bundle?.key, remarks: o.remarks, later: o.later, vip: o.vip,
    ...(o.rows ? { rows: later ? [] : rows } : { presets }),
    ...(o.source ? { source: o.source, ...(o.source === 'staff_request' ? { staffName: o.staffName?.trim() } : {}) } : {}),
    ...(o.hdo && o.hdo !== me ? { hdoId: o.hdo } : {}),
  };
  remote.sendModule(cmd);
  return reqId;
}

/** Adds the items of a ticket logged for later: request type keys, or New Request rows. */
export function completeRequest(reqId: string, what: string[] | NewRow[]) {
  const refs = [reqId];
  const cat = app.get().catalog;
  const asRows: NewRow[] = what.map((x) => (typeof x === 'string' ? { type: x } : x));
  const rows = asRows.filter((r) => rowSpec(cat, r));
  const itemIds = rows.map(() => nid('i'));
  commit('Finish logged request', (s) => {
    const req = s.requests.find((r) => r.id === reqId);
    if (!req) return s;
    const items: Record<string, Item> = {};
    rows.forEach((r, i) => {
      const [name, dept, slaMin, qty, assignee] = rowSpec(cat, r)!;
      const id = itemIds[i];
      refs.push(id);
      items[id] = { id, requestId: reqId, name, qty, dept, assignee, status: 'new', createdAt: s.now, heldMs: 0, slaMin, events: [ev(s, 'Details added')] };
    });
    return { ...s, requests: s.requests.map((r) => (r.id === reqId ? { ...r, itemIds: [...r.itemIds, ...itemIds], incomplete: false } : r)), items: { ...s.items, ...items } };
  }, refs);
  const plain = what.every((x) => typeof x === 'string');
  const cmd: RequestCommand = plain
    ? { type: 'completeRequest', requestId: reqId, itemIds, presets: rows.map((r) => r.type!) }
    : { type: 'completeRequest', requestId: reqId, itemIds, rows };
  remote.sendModule(cmd);
}

/** Returns true when the change applied locally, so only real changes are sent to the server. */
function patchItem(id: string, label: string, fn: (it: Item, now: number) => Partial<Item> | null): boolean {
  let applied = false;
  commit(label, (s) => {
    const it = s.items[id];
    if (!it) return s;
    const p = fn(it, s.now);
    if (!p) return s;
    applied = true;
    return { ...s, items: { ...s.items, [id]: { ...it, ...p, events: [...it.events, ev(s, label)] } } };
  }, [id]);
  return applied;
}

const firstOf = (dept: Item['dept'], s: State) => s.staff.find((p) => p.dept === dept && p.onShift && p.role === 'staff')?.id;

export const relay = (id: string) => {
  const ok = patchItem(id, 'Relayed', (it, now) => (it.status === 'new' ? { status: 'relayed', prevStatus: it.status, ackAt: now, relayedBy: meStaff(app.get()), assignee: it.assignee ?? firstOf(it.dept, app.get()) } : null));
  if (ok) send({ type: 'relay', itemId: id });
};
export const onSite = (id: string) => {
  const ok = patchItem(id, 'On site', (it, now) => (['new', 'relayed'].includes(it.status) ? { status: 'on_site', prevStatus: it.status, ackAt: it.ackAt ?? now, onSiteAt: now, assignee: it.assignee ?? firstOf(it.dept, app.get()) } : null));
  if (ok) send({ type: 'onSite', itemId: id });
};
export const hold = (id: string, reason: HoldReason) => {
  const ok = patchItem(id, 'On hold', (it, now) => (['relayed', 'on_site'].includes(it.status) ? { status: 'on_hold', prevStatus: it.status, holdReason: reason, holdSince: now, ackAt: it.ackAt ?? now } : null));
  if (ok) send({ type: 'hold', itemId: id, reason });
};
export const resume = (id: string) => {
  const ok = patchItem(id, 'Resumed', (it, now) => (it.status === 'on_hold' ? { status: 'on_site', prevStatus: it.status, heldMs: it.heldMs + (now - (it.holdSince ?? now)), holdSince: undefined, holdReason: undefined } : null));
  if (ok) send({ type: 'resume', itemId: id });
};

function closeItem(s: State, id: string, status: 'done' | 'cant_do' | 'duplicate' | 'cancelled', what: string): State {
  const it = s.items[id];
  if (!it) return s;
  const heldMs = it.status === 'on_hold' ? it.heldMs + (s.now - (it.holdSince ?? s.now)) : it.heldMs;
  let n: State = { ...s, items: { ...s.items, [id]: { ...it, status, prevStatus: it.status, doneAt: s.now, heldMs, holdSince: undefined, holdReason: undefined, ackAt: it.ackAt ?? s.now, events: [...it.events, ev(s, what)] } } };
  if (status === 'done' && /checkout|inspection/i.test(it.name)) {
    const room = s.requests.find((r) => r.id === it.requestId)?.room;
    n = { ...n, cleaning: n.cleaning.map((c) => (c.room === room && (c.status === 'scheduled' || c.status === 'queued') ? { ...c, status: 'ready' } : c)) };
  }
  return n;
}

export function finishItem(id: string, status: 'done' | 'cant_do' | 'duplicate' | 'cancelled' = 'done') {
  const before = app.get();
  const it = before.items[id];
  if (!it || !isOpen(it)) return;
  if (it.dependsOn && before.items[it.dependsOn]?.status !== 'done') {
    toast('Waiting for the earlier step to finish first.', 'warn');
    haptic('warning');
    return;
  }
  const label = { done: 'Done', cant_do: "Can't do", duplicate: 'Marked duplicate', cancelled: 'Cancelled' }[status];
  const room = before.requests.find((r) => r.id === it.requestId)?.room;
  commit(label, (s) => closeItem(s, id, status, label), [id]);
  send({ type: 'finish', itemId: id, status });
  const readied = status === 'done' && /checkout|inspection/i.test(it.name) && before.cleaning.some((c) => c.room === room && (c.status === 'scheduled' || c.status === 'queued'));
  if (readied) toast(`Room ${room} is ready for cleaning. Housekeeping was told.`, 'success');
}

/** Moves an open item to another department (a copy there starts new), with an optional reason and person. */
export function transfer(id: string, dept: Item['dept'], o: { note?: string; assignee?: string } = {}) {
  const newId = nid('i');
  const note = o.note?.trim() || undefined;
  let applied = false;
  commit('Transfer', (s) => {
    const it = s.items[id];
    if (!it || !isOpen(it) || it.dept === dept) return s;
    applied = true;
    const req = s.requests.find((r) => r.id === it.requestId);
    return {
      ...s,
      items: {
        ...s.items,
        [id]: { ...it, status: 'transferred', prevStatus: it.status, doneAt: s.now, events: [...it.events, ev(s, `Transferred to ${dept}`)] },
        [newId]: {
          ...it, id: newId, dept, status: 'new', ackAt: undefined, onSiteAt: undefined, relayedBy: undefined, prevStatus: undefined, assignee: o.assignee, createdAt: s.now, heldMs: 0,
          holdSince: undefined, holdReason: undefined, doneAt: undefined, xFrom: id, xKind: 'transfer', xNote: note, events: [ev(s, 'Transferred in')],
        },
      },
      requests: s.requests.map((r) => (r.id === req?.id ? { ...r, itemIds: [...r.itemIds, newId] } : r)),
    };
  }, [id]);
  if (applied) remote.sendModule({ type: 'transfer', itemId: id, newItemId: newId, dept, ...(note ? { note } : {}), ...(o.assignee ? { assignee: o.assignee } : {}) } satisfies RequestCommand);
}

/* ---------- requests: edit, hand off, undo (wave 2) ---------- */

const staffName = (s: State, id?: string) => (id ? s.staff.find((p) => p.id === id)?.name ?? '—' : '—');
const asked = (source: string, name?: string) => (source === 'staff_request' ? `Staff (${name ?? ''})` : 'Guest');
const line = (field: string, a: string, b: string) => {
  const cut = (x: string) => { const v = x || '—'; return v.length > 70 ? `${v.slice(0, 69)}…` : v; };
  return `${field}: ${cut(a)} → ${cut(b)}`;
};

export interface TicketEdit { room?: string; remarks?: string; vip?: boolean; source?: Source; staffName?: string; hdo?: string }

/**
 * Edit ticket. Sends only what changed; each change becomes one history line ("Room: 412 → 414"), here at once and
 * from the server on the next snapshot. Returns false (and sends nothing) when nothing changed.
 */
export function editRequest(reqId: string, e: TicketEdit): boolean {
  const s0 = app.get();
  const req = s0.requests.find((r) => r.id === reqId);
  if (!req) return false;
  const cmd: Extract<RequestCommand, { type: 'editRequest' }> = { type: 'editRequest', requestId: reqId };
  const lines: string[] = [];
  const patch: Partial<Request> = {};
  if (e.room != null && e.room.trim() !== req.room) { cmd.room = patch.room = e.room.trim(); lines.push(line('Room', req.room, cmd.room)); }
  if (e.vip != null && e.vip !== !!req.vip) { cmd.vip = patch.vip = e.vip; lines.push(line('VIP', req.vip ? 'yes' : 'no', e.vip ? 'yes' : 'no')); }
  if (e.source) {
    const name = e.source === 'staff_request' ? e.staffName?.trim() : undefined;
    const was = asked(req.source, req.staffName), now = asked(e.source, name);
    if (was !== now) { cmd.source = e.source; if (name) cmd.staffName = name; patch.source = e.source; patch.staffName = name; lines.push(line('Requested by', was, now)); }
  }
  if (e.hdo && e.hdo !== req.hdo) { cmd.hdoId = patch.hdo = e.hdo; lines.push(line('HDO', staffName(s0, req.hdo), staffName(s0, e.hdo))); }
  if (e.remarks != null && e.remarks.trim() !== (req.remarks ?? '')) { cmd.remarks = e.remarks.trim(); patch.remarks = cmd.remarks || undefined; lines.push(line('Remarks', req.remarks ?? '', cmd.remarks)); }
  if (!lines.length) return false;
  commit('Edit ticket', (s) => ({
    ...s,
    requests: s.requests.map((r) => (r.id === reqId ? { ...r, ...patch, events: [...(r.events ?? []), ...lines.map((l) => ev(s, l))] } : r)),
  }), [reqId]);
  remote.sendModule(cmd);
  return true;
}

export interface ItemEdit { name?: string; qty?: number; dept?: string; assignee?: string | null; remarks?: string }

/** Edit item. The department changes only while the item is new (then Transfer). False when nothing changed. */
export function editItem(id: string, e: ItemEdit): boolean {
  const s0 = app.get();
  const it = s0.items[id];
  if (!it) return false;
  const cat = s0.catalog;
  const cmd: Extract<RequestCommand, { type: 'editItem' }> = { type: 'editItem', itemId: id };
  const lines: string[] = [];
  const patch: Partial<Item> = {};
  const name = e.name?.trim();
  const dept = e.dept && e.dept !== it.dept && it.status === 'new' ? e.dept : it.dept;
  if (name && name !== it.name) { cmd.name = patch.name = name; lines.push(line('Item', it.name, name)); }
  if (e.qty != null && e.qty !== it.qty) { cmd.qty = patch.qty = e.qty; lines.push(line('Qty', String(it.qty), String(e.qty))); }
  if (dept !== it.dept) { cmd.dept = patch.dept = dept; lines.push(line('Department', deptLabel(it.dept, cat), deptLabel(dept, cat))); }
  const want = e.assignee !== undefined ? e.assignee ?? undefined : dept !== it.dept ? undefined : it.assignee;
  if (want !== it.assignee) { cmd.assignee = want ?? null; patch.assignee = want; lines.push(line('Assigned', staffName(s0, it.assignee), staffName(s0, want))); }
  if (e.remarks != null && e.remarks.trim() !== (it.remarks ?? '')) { cmd.remarks = e.remarks.trim(); patch.remarks = cmd.remarks || undefined; lines.push(line('Remarks', it.remarks ?? '', cmd.remarks)); }
  if (!lines.length) return false;
  if (patch.name || patch.dept) {
    const t = cat.requestTypes.find((p) => p.active && p.dept === dept && p.label.toLowerCase() === (patch.name ?? it.name).toLowerCase());
    if (t) patch.slaMin = t.slaMin;
  }
  commit('Edit item', (s) => {
    const cur = s.items[id];
    return cur ? { ...s, items: { ...s.items, [id]: { ...cur, ...patch, events: [...cur.events, ...lines.map((l) => ev(s, l))] } } } : s;
  }, [id]);
  remote.sendModule(cmd);
  return true;
}

/** Hand Off a done item: a follow-up item for a department (and a person), with a note. Returns the new item id. */
export function handOff(id: string, o: { dept: string; name?: string; assignee?: string; note?: string }): string | null {
  const s0 = app.get();
  const it = s0.items[id];
  if (!it || it.status !== 'done' || !activeDept(s0.catalog, o.dept)) return null;
  const newId = nid('i');
  const name = o.name?.trim() || it.name;
  const note = o.note?.trim() || undefined;
  const t = s0.catalog.requestTypes.find((p) => p.active && p.dept === o.dept && p.label.toLowerCase() === name.toLowerCase());
  const slaMin = t ? t.slaMin : name === it.name ? it.slaMin : OTHER_SLA_MIN;
  const to = `${deptLabel(o.dept, s0.catalog)}${o.assignee ? ` (${staffName(s0, o.assignee)})` : ''}`;
  commit('Hand off', (s) => ({
    ...s,
    items: {
      ...s.items,
      [id]: { ...it, events: [...it.events, ev(s, `Handed off to ${to}${note ? `: ${note}` : ''}`.slice(0, 191))] },
      [newId]: { id: newId, requestId: it.requestId, name, qty: it.qty, dept: o.dept, assignee: o.assignee, status: 'new', createdAt: s.now, heldMs: 0, slaMin, xFrom: id, xKind: 'handoff', xNote: note, events: [ev(s, `Follow-up of ${it.name}`)] },
    },
    requests: s.requests.map((r) => (r.id === it.requestId ? { ...r, itemIds: [...r.itemIds, newId] } : r)),
  }), [id, newId]);
  remote.sendModule({ type: 'handOff', itemId: id, newItemId: newId, dept: o.dept, ...(name !== it.name ? { name } : {}), ...(o.assignee ? { assignee: o.assignee } : {}), ...(note ? { note } : {}) } satisfies RequestCommand);
  return newId;
}

/** The label of the newest step not undone yet (the server's last_step), for "Undone: <step>". */
export function lastStep(it: Item): string | null {
  return lastStepEvent(it)?.what ?? null;
}
/** The event of that step (who took it: department staff may only undo their own). */
export function lastStepEvent(it: Item): Item['events'][number] | null {
  let undone = 0;
  for (let i = it.events.length - 1; i >= 0; i--) {
    const w = it.events[i].what;
    if (w.startsWith('Undone: ')) undone++;
    else if (UNDOABLE.includes(w) || w.startsWith('Transferred to ')) {
      if (!undone) return it.events[i];
      undone--;
    }
  }
  return null;
}
const UNDOABLE = ['Relayed', 'On site', 'On hold', 'Resumed', 'Done', "Can't do", 'Marked duplicate', 'Cancelled'];

/**
 * Undo the item's latest step, by the rules of undoTarget() (rules.ts; the UNDO RULES block in Commands.php).
 * Returns the refusal text, or null when it was undone. An escalation is undone with undoEscalate.
 */
export function undoStep(id: string): string | null {
  const s0 = app.get();
  const it = s0.items[id];
  if (!it) return 'Unknown item';
  if (it.status === 'escalated') { undoEscalate(id); return null; }
  const t = undoTarget(it);
  if ('refused' in t) return t.refused;
  if (it.status === 'cancelled' && !lastStep(it)) return 'Nothing to undo';
  const copy = it.status === 'transferred' ? Object.values(s0.items).filter((x) => x.xFrom === id && x.status !== 'cancelled' && x.xKind !== 'handoff').sort((a, b) => b.createdAt - a.createdAt)[0] : undefined;
  if (copy && copy.status !== 'new') return 'The other department already started on it. Ask them to transfer it back.';
  const what = `Undone: ${lastStep(it) ?? STATUS_WORD[it.status]}`;
  commit('Undo', (s) => {
    const cur = s.items[id];
    if (!cur) return s;
    const p: Partial<Item> = { status: t.to, prevStatus: undefined };
    if (cur.status === 'relayed') Object.assign(p, { ackAt: undefined, relayedBy: undefined });
    else if (cur.status === 'on_site') Object.assign(p, { onSiteAt: undefined }, t.to === 'new' ? { ackAt: undefined } : {});
    else if (cur.status === 'on_hold') Object.assign(p, { holdSince: undefined, holdReason: undefined });
    else Object.assign(p, { doneAt: undefined }, t.to === 'new' ? { ackAt: undefined } : {});
    const items = { ...s.items, [id]: { ...cur, ...p, events: [...cur.events, ev(s, what)] } };
    if (copy && items[copy.id]) items[copy.id] = { ...items[copy.id], status: 'cancelled', prevStatus: 'new', doneAt: s.now, events: [...items[copy.id].events, ev(s, 'Cancelled: transfer undone')] };
    return { ...s, items };
  }, [id]);
  remote.sendModule({ type: 'undoStep', itemId: id } satisfies RequestCommand);
  return null;
}
const STATUS_WORD: Record<string, string> = { relayed: 'Relayed', on_site: 'On site', on_hold: 'On hold', done: 'Done', cant_do: "Can't do", duplicate: 'Marked duplicate', cancelled: 'Cancelled', transferred: 'Transfer' };

/* ---------- escalate item -> work order ---------- */
export function escalate(id: string): boolean {
  const s0 = app.get();
  const it = s0.items[id];
  if (!it || !canEscalate(it.dept, s0.catalog) || !['on_site', 'on_hold'].includes(it.status)) {
    toast('Only on-site items of a department that handles repairs can become work orders.', 'warn');
    return false;
  }
  const woId = nid('wo');
  commit('Escalate to work order', (s) => {
    const cur = s.items[id];
    const req = s.requests.find((r) => r.id === cur.requestId);
    const n = s.seq.wo + 1;
    const wo: WorkOrder = {
      id: woId, no: `WO-${pad(n)}`, area: 'Guest room', loc: `Room ${req?.room ?? ''}`, desc: `${cur.name} (from ${req?.ticket ?? 'ticket'})`,
      priority: 'normal', dept: cur.dept, status: 'reported', reportedBy: s.me ?? 's-maria', encodedBy: s.me ?? 's-maria', createdAt: s.now, srcItemId: id,
      audit: [ev(s, 'Escalated from request')],
    };
    return {
      ...s,
      seq: { ...s.seq, wo: n },
      wos: [wo, ...s.wos],
      items: { ...s.items, [id]: { ...cur, status: 'escalated', stBeforeEsc: cur.status, woId: wo.id, events: [...cur.events, ev(s, `Escalated to ${wo.no}`)] } },
    };
  }, [id]);
  send({ type: 'escalate', itemId: id, woId });
  return true;
}

export function undoEscalate(itemId: string) {
  let applied = false;
  commit('Undo escalation', (s) => {
    const it = s.items[itemId];
    if (!it || it.status !== 'escalated' || !it.woId) return s;
    const wo = s.wos.find((w) => w.id === it.woId);
    if (wo && wo.status === 'done') return s;
    applied = true;
    return {
      ...s,
      wos: s.wos.filter((w) => w.id !== it.woId),
      items: { ...s.items, [itemId]: { ...it, status: it.stBeforeEsc ?? 'on_site', woId: undefined, stBeforeEsc: undefined, events: [...it.events, ev(s, 'Escalation undone')] } },
    };
  }, [itemId]);
  if (applied) send({ type: 'undoEscalate', itemId });
}

/* ---------- work orders ---------- */
function patchWo(id: string, label: string, fn: (w: WorkOrder, s: State) => Partial<WorkOrder> | null, after?: (s: State, w: WorkOrder) => State): boolean {
  let applied = false;
  commit(label, (s) => {
    const w = s.wos.find((x) => x.id === id);
    if (!w) return s;
    const p = fn(w, s);
    if (!p) return s;
    applied = true;
    const nw = { ...w, ...p, audit: [...w.audit, ev(s, label)] };
    const n = { ...s, wos: s.wos.map((x) => (x.id === id ? nw : x)) };
    return after ? after(n, nw) : n;
  }, [id]);
  return applied;
}
export const assessWo = (id: string, a: { assessment: string; assignType: 'inhouse' | 'outsource'; contractor?: string; estCost: number }) => {
  if (patchWo(id, 'Assessed', (w) => (w.status === 'reported' ? { ...a, status: 'assessed' } : null))) send({ type: 'assessWo', woId: id, ...a });
};
export const startWo = (id: string) => {
  if (patchWo(id, 'Work started', (w) => (['assessed', 'on_hold'].includes(w.status) ? { status: 'in_progress' } : null))) send({ type: 'startWo', woId: id });
};
export const holdWo = (id: string) => {
  if (patchWo(id, 'Put on hold', (w) => (w.status === 'in_progress' ? { status: 'on_hold' } : null))) send({ type: 'holdWo', woId: id });
};
export const completeWo = (id: string, actualCost: number) => {
  const ok = patchWo(id, 'Completed', (w) => (['in_progress', 'on_hold', 'assessed'].includes(w.status) ? { status: 'done', actualCost } : null), (s, w) =>
    w.srcItemId && s.items[w.srcItemId]?.status === 'escalated' ? closeItem(s, w.srcItemId, 'done', `Closed by ${w.no}`) : s,
  );
  if (ok) send({ type: 'completeWo', woId: id, actualCost });
};
export const reopenWo = (id: string) => {
  if (patchWo(id, 'Reopened', (w) => (w.status === 'done' ? { status: 'in_progress', actualCost: undefined } : null))) send({ type: 'reopenWo', woId: id });
};

/* ---------- cleaning ---------- */
export function cleanSet(id: string, status: State['cleaning'][number]['status']) {
  commit('Cleaning update', (s) => ({ ...s, cleaning: s.cleaning.map((c) => (c.id === id ? { ...c, status } : c)) }), [id]);
  send({ type: 'cleanSet', taskId: id, status });
}

/* ---------- handover ---------- */
/** The server names a sign-off by the owner or manager account this way. */
const signer = (s: State) => (remote.active && s.me === 'member' ? 'a manager' : meName(s));
export function ackHandover() {
  const handoverId = nid('h');
  commit('Handover acknowledged', (s) => ({ ...s, handover: { ackBy: signer(s), ackAt: s.now } }));
  send({ type: 'ackHandover', handoverId });
}
export function returnOrphans() {
  const s0 = app.get();
  const off = new Set(s0.staff.filter((p) => !p.onShift).map((p) => p.id));
  const ids = Object.values(s0.items).filter((i) => isOpen(i) && i.assignee && off.has(i.assignee)).map((i) => i.id);
  if (!ids.length) return;
  commit('Returned to department queue', (s) => ({
    ...s,
    items: Object.fromEntries(Object.entries(s.items).map(([k, i]) => [k, ids.includes(k) ? { ...i, assignee: undefined, events: [...i.events, ev(s, 'Returned to department queue at shift end')] } : i])),
  }), ids);
  send({ type: 'returnOrphans', itemIds: ids });
  toast(`${ids.length} item${ids.length === 1 ? '' : 's'} returned to the department queue.`, 'success');
}

/* ---------- safety ---------- */
export { detectSafety };
export function raiseSafety(room: string, text: string, hazard: Hazard): { id: string; clustered: boolean } {
  const s0 = app.get();
  const recent = s0.incidents.find((i) => i.hazard === hazard && i.status === 'active' && Date.now() - i.createdAt < 15 * 60000 && !i.rooms.includes(room));
  haptic('error');
  tone('alert');
  if (recent) {
    commit('Safety report merged', (s) => ({
      ...s,
      incidents: s.incidents.map((i) => (i.id === recent.id ? { ...i, rooms: [...i.rooms, room], log: [...i.log, ev(s, `Second report from room ${room}: treated as one incident`)] } : i)),
    }));
    toast(`Second ${HAZARDS[hazard].label.toLowerCase()} report. Merged into ${recent.no}.`, 'error');
    send({ type: 'raiseSafety', incidentId: nid('inc'), room, text, hazard });
    return { id: recent.id, clustered: true };
  }
  const id = nid('inc');
  commit('Safety escalation', (s) => {
    const n = s.seq.inc + 1;
    const inc: Incident = { id, no: `INC-${pad(n, 3)}`, hazard, rooms: [room], createdAt: s.now, text, status: 'active', log: [ev(s, 'Safety words detected. Duty manager and Security alerted over the local network. Staff notified (not BFP/911).')] };
    return { ...s, seq: { ...s.seq, inc: n }, incidents: [inc, ...s.incidents] };
  });
  send({ type: 'raiseSafety', incidentId: id, room, text, hazard });
  return { id, clustered: false };
}
export function patchIncident(id: string, fn: (i: Incident, s: State) => Partial<Incident>, what: string) {
  commit(what, (s) => ({ ...s, incidents: s.incidents.map((i) => (i.id === id ? { ...i, ...fn(i, s), log: [...i.log, ev(s, what)] } : i)) }));
}
export const downgradeIncident = (id: string) => {
  patchIncident(id, () => ({ status: 'downgraded' }), 'Downgraded by staff (logged)');
  send({ type: 'downgradeIncident', incidentId: id });
};
export const resolveIncident = (id: string) => {
  patchIncident(id, () => ({ status: 'resolved' }), 'Resolved with engineer and manager sign-off');
  send({ type: 'resolveIncident', incidentId: id });
};
export const record911 = (id: string, at: string) => {
  patchIncident(id, (_i, s) => ({ called911: { by: meName(s), at } }), `BFP/911 called at ${at}`);
  send({ type: 'record911', incidentId: id, at: new Date().toISOString() });
};

/* ---------- server-backed mode ---------- */
/** Replace the lists with a fresh server snapshot. The signed-in member acts as `member`, who is not a staff row. */
export function applySnapshot(snap: Snapshot, member?: State['staff'][number]) {
  app.set((s) => ({
    ...s,
    now: Date.now(),
    // A server without lists (an older plugin) keeps the factory lists.
    catalog: isCatalog(snap.catalog) ? snap.catalog : SEED_CATALOG,
    staff: member ? [...snap.staff, member] : snap.staff,
    requests: snap.requests,
    items: snap.items,
    wos: snap.wos,
    cleaning: snap.cleaning,
    incidents: snap.incidents,
    handover: snap.handover,
    seq: snap.seq,
    // An older plugin sends no modules: no module data, never an error.
    modules: snap.modules && typeof snap.modules === 'object' ? snap.modules : {},
  }));
}

/* ---------- modules: their own data and commands ---------- */

/**
 * The shape of each module's snapshot slice. A module adds its own entry from its own file, without editing this one:
 *   declare module '../../domain/store' { interface ModuleSlices { inquiries: { list: Inquiry[] } } }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled in by each module through declaration merging
export interface ModuleSlices {}

/** A module's data from the latest snapshot, or undefined (not loaded yet, or the reader may not read it). */
export function moduleData<K extends keyof ModuleSlices & string>(s: State, id: K): ModuleSlices[K] | undefined;
export function moduleData<T = unknown>(s: State, id: string): T | undefined;
export function moduleData(s: State, id: string): unknown {
  return s.modules[id];
}

/**
 * Sends a module's own command through the offline outbox, like every built-in command: a fresh opId, so a resend
 * after a dropped connection never applies twice. `local` changes the module's slice at once (optimistic); the next
 * snapshot replaces it with the server's. `refs` are row ids to mark as waiting while offline.
 */
export function runModuleCommand(module: string, type: string, fields: Record<string, unknown>, local?: (slice: unknown, s: State) => unknown, refs: string[] = []) {
  if (local) commit(type, (s) => ({ ...s, modules: { ...s.modules, [module]: local(s.modules[module], s) } }), refs);
  remote.sendModule({ ...fields, type });
}

/** A list editor saved: every screen follows at once (the next snapshot carries the same lists). */
export function setCatalog(catalog: Catalog) {
  if (isCatalog(catalog)) app.set((s) => ({ ...s, catalog }));
}

/* ---------- selectors ---------- */
export const myStaff = (s: State) => s.staff.find((p) => p.id === s.me);
export const openCount = (s: State) => Object.values(s.items).filter(isOpen).length;
