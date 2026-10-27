import { useSyncExternalStore } from 'react';
import { buildSeed } from './seed';
import { BUNDLES, HAZARDS, PRESETS, STAFF, detectSafety, hubUp, isOpen, pad } from './rules';
import { haptic, hapticsConfig, tone } from '../lib/haptics';
import type { Hazard, HoldReason, Item, Incident, Prefs, State, Toast, WorkOrder } from './types';
import type { Snapshot } from '../server/contract';
import { remote, type Draft } from './remote';

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
/** Report a change that already happened locally to the server. No-op in demo mode. */
const send = (d: Draft) => remote.send(d);

export function initialState(now = Date.now()): State {
  const seed = buildSeed(now);
  return {
    now,
    me: null,
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
    stationB: { requests: seed.requests.length, open: Object.values(seed.items).filter(isOpen).length, lastSync: now },
    netlog: [{ at: now, text: 'Edge node online. 6 devices registered.' }],
    handover: {},
    prefs: { textScale: 1, contrast: false, motion: 'auto', haptics: true, sound: true, showHaptics: true, shadow: true, theme: 'auto', shortcuts: true },
    toasts: [],
    announce: '',
  };
}

export const app = createStore<State>(initialState());
export function useApp<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(app.sub, () => sel(app.get()));
}
export function resetApp(now = Date.now()) {
  const keep = { me: app.get().me, prefs: app.get().prefs };
  app.set(() => ({ ...initialState(now), ...keep }));
  syncPrefs(app.get().prefs);
}

/* ---------- ui state ---------- */
export type Tab = 'requests' | 'maintenance' | 'housekeeping' | 'handover' | 'insights' | 'network' | 'settings';
export type Sheet = null | 'composer' | 'safety' | 'paper' | 'more' | 'demo' | 'switch' | 'incident';
export interface UI {
  screen: 'cover' | 'lock' | 'app';
  tab: Tab;
  selItem?: string;
  selWo?: string;
  sheet: Sheet;
  composerSeed?: { room?: string; text?: string; preset?: string };
  composerOpenedAt?: number;
  guide: boolean;
  step: number;
  doneSteps: number[];
  running: boolean;
  focusSafetyId?: string;
  /** Server-backed app: the demo-only screens and the guide are hidden. */
  remote: boolean;
  /** Server-backed app: changes saved on this device that the server has not accepted yet. */
  sync: { pending: number; offline: boolean };
  /** Server-backed app on a shared phone's account: no manager mode, so staff must sign in with a PIN. */
  deviceOnly: boolean;
}
export const ui = createStore<UI>({ screen: 'cover', tab: 'requests', sheet: null, guide: false, step: 0, doneSteps: [], running: false, remote: false, sync: { pending: 0, offline: false }, deviceOnly: false });
export function useUI<T>(sel: (s: UI) => T): T {
  return useSyncExternalStore(ui.sub, () => sel(ui.get()));
}
export const setUI = (p: Partial<UI>) => ui.set((s) => ({ ...s, ...p }));
export const go = (tab: Tab) => setUI({ tab, selItem: undefined, selWo: undefined, sheet: null });
export const openComposer = (seed?: UI['composerSeed']) => setUI({ sheet: 'composer', composerSeed: seed, composerOpenedAt: Date.now() });

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

/* ---------- sync simulation ---------- */
let bTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleB() {
  clearTimeout(bTimer);
  bTimer = setTimeout(() => {
    app.set((s) =>
      hubUp(s.net, false)
        ? { ...s, stationB: { requests: s.requests.length, open: Object.values(s.items).filter(isOpen).length, lastSync: Date.now() } }
        : s,
    );
  }, 450);
}

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
  if (reach) scheduleB();
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
      stationB: { requests: s.requests.length, open: Object.values(s.items).filter(isOpen).length, lastSync: Date.now() },
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
  bundle?: string;
  remarks?: string;
  later?: boolean;
  vip?: boolean;
}

export function logRequest(o: LogInput): string {
  const reqId = nid('r');
  const refs: string[] = [reqId];
  const presets = (o.presets ?? []).filter((k) => PRESETS.some((x) => x.key === k));
  const bundle = BUNDLES.find((x) => x.key === o.bundle);
  const itemIds = [...presets.map(() => nid('i')), ...(bundle ? bundle.parts.map(() => nid('i')) : [])];
  let next = 0;
  commit(`Log request, room ${o.room}`, (s) => {
    const n = s.seq.t + 1;
    const items: Record<string, Item> = {};
    const ids: string[] = [];
    const mk = (name: string, dept: Item['dept'], slaMin: number, dependsOn?: string): string => {
      const id = itemIds[next++];
      ids.push(id);
      refs.push(id);
      items[id] = { id, requestId: reqId, name, qty: 1, dept, status: 'new', createdAt: s.now, heldMs: 0, slaMin, dependsOn, events: [ev(s, 'Logged')] };
      return id;
    };
    for (const k of o.presets ?? []) {
      const p = PRESETS.find((x) => x.key === k);
      if (p) mk(p.label, p.dept, p.slaMin);
    }
    const b = BUNDLES.find((x) => x.key === o.bundle);
    if (b) {
      const made: string[] = [];
      for (const part of b.parts) made.push(mk(part.name, part.dept, part.slaMin, 'after' in part && part.after != null ? made[part.after] : undefined));
    }
    return {
      ...s,
      seq: { ...s.seq, t: n },
      requests: [
        { id: reqId, ticket: `T-${pad(n)}`, room: o.room, source: 'staff', remarks: o.remarks, loggedBy: s.me ?? 's-maria', createdAt: s.now, itemIds: ids, incomplete: o.later || ids.length === 0, vip: o.vip },
        ...s.requests,
      ],
      items: { ...s.items, ...items },
    };
  }, refs);
  send({ type: 'logRequest', requestId: reqId, itemIds, room: o.room, presets, bundle: o.bundle, remarks: o.remarks, later: o.later, vip: o.vip });
  return reqId;
}

export function completeRequest(reqId: string, presetKeys: string[]) {
  const refs = [reqId];
  const presets = presetKeys.filter((k) => PRESETS.some((x) => x.key === k));
  const itemIds = presets.map(() => nid('i'));
  let next = 0;
  commit('Finish logged request', (s) => {
    const req = s.requests.find((r) => r.id === reqId);
    if (!req) return s;
    const items: Record<string, Item> = {};
    const ids: string[] = [];
    for (const k of presets) {
      const p = PRESETS.find((x) => x.key === k);
      if (!p) continue;
      const id = itemIds[next++];
      ids.push(id);
      refs.push(id);
      items[id] = { id, requestId: reqId, name: p.label, qty: 1, dept: p.dept, status: 'new', createdAt: s.now, heldMs: 0, slaMin: p.slaMin, events: [ev(s, 'Details added')] };
    }
    return { ...s, requests: s.requests.map((r) => (r.id === reqId ? { ...r, itemIds: [...r.itemIds, ...ids], incomplete: false } : r)), items: { ...s.items, ...items } };
  }, refs);
  send({ type: 'completeRequest', requestId: reqId, itemIds, presets });
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
  const ok = patchItem(id, 'Relayed', (it, now) => (it.status === 'new' ? { status: 'relayed', ackAt: now, assignee: it.assignee ?? firstOf(it.dept, app.get()) } : null));
  if (ok) send({ type: 'relay', itemId: id });
};
export const onSite = (id: string) => {
  const ok = patchItem(id, 'On site', (it, now) => (['new', 'relayed'].includes(it.status) ? { status: 'on_site', ackAt: it.ackAt ?? now, assignee: it.assignee ?? firstOf(it.dept, app.get()) } : null));
  if (ok) send({ type: 'onSite', itemId: id });
};
export const hold = (id: string, reason: HoldReason) => {
  const ok = patchItem(id, 'On hold', (it, now) => (['relayed', 'on_site'].includes(it.status) ? { status: 'on_hold', holdReason: reason, holdSince: now, ackAt: it.ackAt ?? now } : null));
  if (ok) send({ type: 'hold', itemId: id, reason });
};
export const resume = (id: string) => {
  const ok = patchItem(id, 'Resumed', (it, now) => (it.status === 'on_hold' ? { status: 'on_site', heldMs: it.heldMs + (now - (it.holdSince ?? now)), holdSince: undefined, holdReason: undefined } : null));
  if (ok) send({ type: 'resume', itemId: id });
};

function closeItem(s: State, id: string, status: 'done' | 'cant_do' | 'duplicate' | 'cancelled', what: string): State {
  const it = s.items[id];
  if (!it) return s;
  const heldMs = it.status === 'on_hold' ? it.heldMs + (s.now - (it.holdSince ?? s.now)) : it.heldMs;
  let n: State = { ...s, items: { ...s.items, [id]: { ...it, status, doneAt: s.now, heldMs, holdSince: undefined, ackAt: it.ackAt ?? s.now, events: [...it.events, ev(s, what)] } } };
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

export function transfer(id: string, dept: Item['dept']) {
  const newId = nid('i');
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
        [id]: { ...it, status: 'transferred', doneAt: s.now, events: [...it.events, ev(s, `Transferred to ${dept}`)] },
        [newId]: { ...it, id: newId, dept, status: 'new', ackAt: undefined, assignee: undefined, createdAt: s.now, heldMs: 0, holdSince: undefined, holdReason: undefined, xFrom: id, events: [ev(s, 'Transferred in')] },
      },
      requests: s.requests.map((r) => (r.id === req?.id ? { ...r, itemIds: [...r.itemIds, newId] } : r)),
    };
  }, [id]);
  if (applied) send({ type: 'transfer', itemId: id, newItemId: newId, dept });
}

/* ---------- escalate item -> work order ---------- */
export function escalate(id: string): boolean {
  const s0 = app.get();
  const it = s0.items[id];
  if (!it || !['engineering', 'it'].includes(it.dept) || !['on_site', 'on_hold'].includes(it.status)) {
    toast('Only on-site Engineering or IT items can become work orders.', 'warn');
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
// Handover sign-off and returning orphaned items are not stored on the server yet.
const notSaved = () => toast('Handover sign-off is not saved to the server yet.', 'warn');
export function ackHandover() {
  if (remote.active) return notSaved();
  commit('Handover acknowledged', (s) => ({ ...s, handover: { ackBy: meName(s), ackAt: s.now } }));
}
export function returnOrphans() {
  if (remote.active) return notSaved();
  const s0 = app.get();
  const off = new Set(s0.staff.filter((p) => !p.onShift).map((p) => p.id));
  const ids = Object.values(s0.items).filter((i) => isOpen(i) && i.assignee && off.has(i.assignee)).map((i) => i.id);
  if (!ids.length) return;
  commit('Returned to department queue', (s) => ({
    ...s,
    items: Object.fromEntries(Object.entries(s.items).map(([k, i]) => [k, ids.includes(k) ? { ...i, assignee: undefined, events: [...i.events, ev(s, 'Returned to department queue at shift end')] } : i])),
  }), ids);
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
    staff: member ? [...snap.staff, member] : snap.staff,
    requests: snap.requests,
    items: snap.items,
    wos: snap.wos,
    cleaning: snap.cleaning,
    incidents: snap.incidents,
    seq: snap.seq,
  }));
}

/* ---------- selectors ---------- */
export const myStaff = (s: State) => s.staff.find((p) => p.id === s.me);
export const openCount = (s: State) => Object.values(s.items).filter(isOpen).length;
