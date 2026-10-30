import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, editItem, editRequest, finishItem, handOff, hold, logRequest, onSite, relay, resetApp, resume, transfer, undoStep, unlock } from '../../domain/store';
import { undoTarget } from '../../domain/rules';
import { SEED_CATALOG } from '../../domain/catalog';
import { memoryOutbox } from '../../domain/outbox';
import { remote } from '../../domain/remote';
import type { AnyCommand } from '../../domain/contract';
import type { Item, Request } from '../../domain/types';
import { apply, counts, dayKey, dur, inRange, layoutFor, lines, rowActions, ticketStatus, timers, todayRange, weekRange, type Ctx } from './logic';

const MIN = 60000;
const iso = (s: string) => Date.parse(s);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T02:00:00Z')); // Thursday 10:00 in Manila
  resetApp(Date.now());
  unlock('s-maria');
});
afterEach(() => {
  remote.disable();
  vi.useRealTimers();
});

const item = (p: Partial<Item> & { id: string; requestId: string }): Item => ({ name: 'Extra towels', qty: 1, dept: 'housekeeping', status: 'new', createdAt: 0, heldMs: 0, slaMin: 10, events: [], ...p });
const req = (p: Partial<Request> & { id: string; itemIds: string[] }): Request => ({ ticket: `T-${p.id}`, room: '412', source: 'guest', loggedBy: 's-maria', createdAt: 0, ...p });

/* ---------- hotel days (Asia/Manila), never UTC dates ---------- */

describe('hotel days', () => {
  it('a day starts at midnight in Manila (16:00 UTC the day before)', () => {
    expect(dayKey(iso('2026-10-29T15:59:59Z'))).toBe('2026-10-29'); // 23:59:59 Manila
    expect(dayKey(iso('2026-10-29T16:00:00Z'))).toBe('2026-10-30'); // 00:00:00 Manila
  });

  it('Today at 7 a.m. Manila is that local day, not the UTC date (the prototype bug A.16 #7)', () => {
    const sevenAm = iso('2026-10-29T23:00:00Z'); // Oct 30, 07:00 in Manila, still Oct 29 in UTC
    expect(todayRange(sevenAm)).toEqual({ from: '2026-10-30', to: '2026-10-30' });
  });

  it('the range includes both end days and excludes one second either side', () => {
    expect(inRange(iso('2026-10-29T16:00:00Z'), '2026-10-30', '2026-10-30')).toBe(true);
    expect(inRange(iso('2026-10-30T15:59:59Z'), '2026-10-30', '2026-10-30')).toBe(true);
    expect(inRange(iso('2026-10-29T15:59:59Z'), '2026-10-30', '2026-10-30')).toBe(false);
    expect(inRange(iso('2026-10-30T16:00:00Z'), '2026-10-30', '2026-10-30')).toBe(false);
    expect(inRange(0, '', '')).toBe(true);
    expect(inRange(iso('2026-10-29T16:00:00Z'), '2026-10-30', '')).toBe(true);
  });

  it('Week runs from Monday in Manila, also just after midnight on a Monday', () => {
    expect(weekRange(iso('2026-10-29T02:00:00Z'))).toEqual({ from: '2026-10-26', to: '2026-10-29' }); // Thursday
    const mondayHalfPastMidnight = iso('2026-10-25T16:30:00Z'); // Sunday in UTC
    expect(weekRange(mondayHalfPastMidnight)).toEqual({ from: '2026-10-26', to: '2026-10-26' });
    expect(weekRange(iso('2026-11-01T10:00:00Z'))).toEqual({ from: '2026-10-26', to: '2026-11-01' }); // Sunday evening
  });
});

/* ---------- the list: rows, filters, search, counters ---------- */

describe('the Requests list', () => {
  const now = iso('2026-10-30T02:00:00Z');
  const items: Record<string, Item> = {
    a: item({ id: 'a', requestId: 'r1', createdAt: now - 5 * MIN }),
    b: item({ id: 'b', requestId: 'r1', name: 'AC not cold', dept: 'engineering', status: 'on_hold', ackAt: now - 4 * MIN, holdSince: now - MIN, holdReason: 'parts', assignee: 's-ramon', createdAt: now - 5 * MIN }),
    c: item({ id: 'c', requestId: 'r2', status: 'done', ackAt: now - 3 * 3600000, doneAt: now - 2 * 3600000, createdAt: now - 3 * 3600000 }),
    d: item({ id: 'd', requestId: 'r2', status: 'escalated', dept: 'engineering', createdAt: now - 3 * 3600000 }),
    e: item({ id: 'e', requestId: 'r3', status: 'transferred', createdAt: iso('2026-10-29T15:59:00Z') }),
  };
  const requests: Request[] = [
    req({ id: 'r1', itemIds: ['a', 'b'], room: '412', createdAt: now - 5 * MIN, vip: true }),
    req({ id: 'r2', itemIds: ['c', 'd'], room: '305', createdAt: now - 3 * 3600000, source: 'staff_request', staffName: 'Dela Cruz, Maria' }),
    req({ id: 'r3', itemIds: ['e'], room: '218', createdAt: iso('2026-10-29T15:59:00Z') }), // 23:59 the day before, Manila
    req({ id: 'r4', itemIds: [], room: '118', createdAt: now - MIN, incomplete: true }),
  ];
  const all = lines(requests, items);
  const ctx: Ctx = { items, now, cat: SEED_CATALOG, staff: app.get().staff };
  const codes = (f: Parameters<typeof apply>[1]) => apply(all, f, ctx).map((l) => l.code);

  it('one row per item, newest ticket first, coded T-xxx-n; a ticket logged for later is one row', () => {
    expect(all.map((l) => l.code)).toEqual(['T-r4', 'T-r1-1', 'T-r1-2', 'T-r2-1', 'T-r2-2', 'T-r3-1']);
  });

  it('All / Active / Done as the prototype; an escalated item is in All only', () => {
    expect(codes({ status: 'all' })).toHaveLength(6);
    expect(codes({ status: 'active' })).toEqual(['T-r4', 'T-r1-1', 'T-r1-2']);
    expect(codes({ status: 'done' })).toEqual(['T-r2-1', 'T-r3-1']);
  });

  it('quick filters: overdue, on hold, my department', () => {
    expect(codes({ status: 'all', quick: 'overdue' })).toEqual(['T-r1-1']); // new for 5 minutes: past the 2-minute relay target
    expect(codes({ status: 'all', quick: 'hold' })).toEqual(['T-r1-2']);
    expect(codes({ status: 'all', quick: 'mine', myDept: 'engineering' })).toEqual(['T-r4', 'T-r1-2', 'T-r2-2']);
  });

  it('the date range uses the ticket day in Manila', () => {
    expect(codes({ status: 'all', from: '2026-10-30', to: '2026-10-30' })).toEqual(['T-r4', 'T-r1-1', 'T-r1-2', 'T-r2-1', 'T-r2-2']);
    expect(codes({ status: 'all', from: '2026-10-29', to: '2026-10-29' })).toEqual(['T-r3-1']);
  });

  it('type-to-search across rooms, items, departments, people and who asked; every word must match', () => {
    expect(codes({ status: 'all', q: '305' })).toEqual(['T-r2-1', 'T-r2-2']);
    expect(codes({ status: 'all', q: 'ramon' })).toEqual(['T-r1-2']);
    expect(codes({ status: 'all', q: 'dela cruz' })).toEqual(['T-r2-1', 'T-r2-2']);
    expect(codes({ status: 'all', q: 'engineering hold' })).toEqual(['T-r1-2']);
    expect(codes({ status: 'all', q: 'T-r1-2' })).toEqual(['T-r1-2']);
    expect(codes({ status: 'all', q: 'vip towels' })).toEqual(['T-r1-1']);
    expect(codes({ status: 'all', q: 'caviar' })).toEqual([]);
  });

  it('counters', () => {
    expect(counts(all, items, now)).toEqual({ all: 6, active: 3, done: 2, new: 1, relayed: 0, on_site: 0, on_hold: 1, overdue: 1 });
  });

  it('ticket status: transferred items ignored; all done is done; all new is new; else in progress', () => {
    expect(ticketStatus([items.a, items.b])).toBe('in_progress');
    expect(ticketStatus([items.a])).toBe('new');
    expect(ticketStatus([items.c, items.e])).toBe('done');
  });
});

/* ---------- table or cards ---------- */

describe('layout', () => {
  it('cards on a phone (375 px) and in a narrow list; the table from 720 px of list', () => {
    expect(layoutFor(375)).toBe('cards');
    expect(layoutFor(719)).toBe('cards');
    expect(layoutFor(720)).toBe('table');
    expect(layoutFor(1240)).toBe('table');
  });
});

/* ---------- timers ---------- */

describe('Relay / Resp / Res timers', () => {
  const t0 = 1_000_000;
  it('Relay runs while new and turns bad after 2 minutes; it stops at acknowledgement', () => {
    const it0 = item({ id: 'x', requestId: 'r', createdAt: t0 });
    expect(timers(it0, {}, t0 + 90000).relay).toEqual({ ms: 90000, live: true, tone: 'ok' });
    expect(timers(it0, {}, t0 + 100000).relay?.tone).toBe('warn');
    expect(timers(it0, {}, t0 + 121000).relay?.tone).toBe('bad');
    expect(timers({ ...it0, status: 'relayed', ackAt: t0 + 72000 }, {}, t0 + 999999).relay).toEqual({ ms: 72000, live: false, tone: 'ok' });
  });

  it('Resp is acknowledgement to on site; Res leaves the hold out and compares with the item target', () => {
    const it0 = item({ id: 'x', requestId: 'r', createdAt: t0, ackAt: t0 + MIN, onSiteAt: t0 + 3 * MIN, status: 'on_hold', holdSince: t0 + 8 * MIN, heldMs: 2 * MIN, slaMin: 10 });
    const at = t0 + 20 * MIN;
    const t = timers(it0, {}, at);
    expect(t.resp).toEqual({ ms: 2 * MIN, live: false, tone: '' });
    // 19 minutes since acknowledgement, minus 2 earlier held and 12 held now = 5 minutes of work; paused while held.
    expect(t.res).toEqual({ ms: 5 * MIN, live: false, tone: 'ok' });
    const done = timers({ ...it0, status: 'done', holdSince: undefined, heldMs: 14 * MIN, doneAt: at }, {}, at + MIN);
    expect(done.res).toEqual({ ms: 5 * MIN, live: false, tone: 'ok' });
    expect(timers({ ...it0, status: 'on_site', holdSince: undefined, heldMs: 0 }, {}, at).res).toEqual({ ms: 19 * MIN, live: true, tone: 'bad' });
  });

  it('no timer before its step, and none for a waiting bundle step', () => {
    const pre = item({ id: 'p', requestId: 'r' });
    const blocked = item({ id: 'x', requestId: 'r', dependsOn: 'p', createdAt: t0 });
    expect(timers(blocked, { p: pre, x: blocked }, t0 + MIN)).toEqual({});
  });

  it('prints like the prototype: "1m 12s"; hours as "2h 05m"', () => {
    expect(dur(72000)).toBe('1m 12s');
    expect(dur(0)).toBe('0m 0s');
    expect(dur(2 * 3600000 + 5 * MIN)).toBe('2h 05m');
  });
});

/* ---------- row actions and the undo rule ---------- */

describe('row actions (prototype A.4.1) and undo targets', () => {
  it('actions by status', () => {
    const a = (status: Item['status'], extra: Partial<Item> = {}) => rowActions(item({ id: 'x', requestId: 'r', status, ...extra }), {});
    expect(a('new')).toEqual(['relay']);
    expect(a('relayed')).toEqual(['onSite', 'done']);
    expect(a('on_site')).toEqual(['hold', 'done']);
    expect(a('on_hold')).toEqual(['undo', 'resume']);
    expect(a('done')).toEqual(['undo']);
    expect(a('transferred')).toEqual(['undo']);
    expect(a('done', { woId: 'w' })).toEqual([]);
    expect(a('escalated')).toEqual([]);
    expect(a('cancelled')).toEqual([]); // the copy of an undone transfer
  });

  it('undoTarget is the server rule (Azl_Commands::undo_target), fallbacks included', () => {
    const t = (status: Item['status'], extra: Partial<Item> = {}) => undoTarget({ status, ackAt: 1, ...extra });
    expect(t('relayed')).toEqual({ to: 'new' });
    expect(t('on_site')).toEqual({ to: 'relayed' });
    expect(t('on_site', { prevStatus: 'new' })).toEqual({ to: 'new' });
    expect(t('on_site', { onSiteAt: 1, ackAt: 1 })).toEqual({ to: 'new' });
    expect(t('on_site', { prevStatus: 'on_hold' })).toEqual({ refused: 'A resume cannot be undone. Put the item on hold again.' });
    expect(t('on_hold')).toEqual({ to: 'on_site' });
    expect(t('on_hold', { prevStatus: 'relayed' })).toEqual({ to: 'relayed' });
    expect(t('done', { prevStatus: 'on_hold' })).toEqual({ to: 'on_site' });
    expect(t('done')).toEqual({ to: 'relayed' });
    expect(t('done', { woId: 'w' })).toEqual({ refused: 'Closed by its work order. Reopen the work order instead.' });
    expect(t('transferred', { prevStatus: 'on_hold' })).toEqual({ to: 'on_hold' });
    expect(t('new')).toEqual({ refused: 'Nothing to undo' });
  });
});

/* ---------- the store: New Request, edits, hand off, undo ---------- */

const newestReq = () => app.get().requests[0];
const at = (id: string) => app.get().items[id];

describe('New Request in the store', () => {
  it('rows with an Other item, qty and an assignee; a staff request; the HDO is the person logging by default', () => {
    logRequest({ room: '1015', source: 'staff_request', staffName: ' Abad, Liza ', rows: [{ type: 'towels', qty: 3, assignee: 's-joel' }, { other: 'Extra hangers', dept: 'housekeeping' }, { other: '  ' }] });
    const r = newestReq();
    expect(r).toMatchObject({ room: '1015', source: 'staff_request', staffName: 'Abad, Liza', hdo: 's-maria' });
    const [a, b] = r.itemIds.map(at);
    expect(r.itemIds).toHaveLength(2); // the empty row is dropped
    expect(a).toMatchObject({ name: 'Extra towels', qty: 3, assignee: 's-joel', slaMin: 10 });
    expect(b).toMatchObject({ name: 'Extra hangers', qty: 1, dept: 'housekeeping', slaMin: 30 });
  });

  it('sends rows, source and the HDO only when it is someone else', async () => {
    vi.useRealTimers();
    const sent: AnyCommand[] = [];
    remote.enable({ run: async (c) => { sent.push(c); return { ok: true, applied: true }; }, load: () => new Promise(() => {}) }, { snapshot: () => {}, error: () => {} }, { scope: 'p', outbox: memoryOutbox() });
    logRequest({ room: '1', source: 'guest', rows: [{ type: 'water' }] });
    logRequest({ room: '2', rows: [{ type: 'water' }], hdo: 's-ana' });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]).toMatchObject({ type: 'logRequest', source: 'guest', rows: [{ type: 'water' }] });
    expect(sent[0]).not.toHaveProperty('hdoId');
    expect(sent[0]).not.toHaveProperty('presets');
    expect(sent[1]).toMatchObject({ hdoId: 's-ana' });
    expect(sent[1]).not.toHaveProperty('source'); // no source: the server keeps the old value
  });
});

describe('Edit ticket and Edit item', () => {
  it('records one history line per change, old to new; nothing changed sends nothing', () => {
    logRequest({ room: '410', rows: [{ type: 'towels' }] });
    const r = newestReq();
    expect(editRequest(r.id, { room: '412', vip: true, hdo: 's-ana', source: 'staff_request', staffName: 'Lynette, HK' })).toBe(true);
    expect(newestReq().events?.map((e) => e.what)).toEqual(['Logged', 'Room: 410 → 412', 'VIP: no → yes', 'Requested by: Guest → Staff (Lynette, HK)', 'HDO: Maria Santos → Ana Villanueva']);
    expect(newestReq().events?.[1]).toMatchObject({ by: 's-maria', at: Date.now() });
    expect(editRequest(r.id, { room: '412' })).toBe(false);
  });

  it('the department changes only while new; a matching type sets its target time', () => {
    logRequest({ room: '1', rows: [{ type: 'towels' }] });
    const id = newestReq().itemIds[0];
    expect(editItem(id, { dept: 'engineering', name: 'AC not cold', qty: 2 })).toBe(true);
    expect(at(id)).toMatchObject({ dept: 'engineering', name: 'AC not cold', qty: 2, slaMin: 45 });
    relay(id);
    expect(editItem(id, { dept: 'it' })).toBe(false);
    expect(at(id).dept).toBe('engineering');
  });
});

describe('Hand off and undo in the store', () => {
  it('hand off adds a follow-up item linked to the done one, with the note', () => {
    logRequest({ room: '1', rows: [{ type: 'towels' }] });
    const id = newestReq().itemIds[0];
    expect(handOff(id, { dept: 'engineering' })).toBeNull(); // not done yet
    relay(id); onSite(id); finishItem(id);
    const next = handOff(id, { dept: 'engineering', assignee: 's-ramon', note: 'Check the rail' })!;
    expect(at(next)).toMatchObject({ status: 'new', dept: 'engineering', xFrom: id, xKind: 'handoff', xNote: 'Check the rail', assignee: 's-ramon' });
    expect(at(id).events.at(-1)?.what).toBe('Handed off to Engineering (Ramon Cruz): Check the rail');
    expect(newestReq().itemIds).toContain(next);
  });

  it('undo goes back step by step and keeps the history; the hold is erased from the clock', () => {
    logRequest({ room: '1', rows: [{ type: 'towels' }] });
    const id = newestReq().itemIds[0];
    relay(id);
    vi.advanceTimersByTime(MIN);
    onSite(id);
    hold(id, 'dnd');
    vi.advanceTimersByTime(5 * MIN);
    expect(undoStep(id)).toBeNull();
    expect(at(id)).toMatchObject({ status: 'on_site', heldMs: 0, holdSince: undefined, holdReason: undefined });
    expect(undoStep(id)).toBeNull();
    expect(at(id)).toMatchObject({ status: 'relayed', onSiteAt: undefined });
    expect(undoStep(id)).toBeNull();
    expect(at(id)).toMatchObject({ status: 'new', ackAt: undefined });
    expect(undoStep(id)).toBe('Nothing to undo');
    expect(at(id).events.map((e) => e.what)).toEqual(['Logged', 'Relayed', 'On site', 'On hold', 'Undone: On hold', 'Undone: On site', 'Undone: Relayed']);
  });

  it('a resume is not undone; an undone transfer cancels the untouched copy', () => {
    logRequest({ room: '1', rows: [{ type: 'towels' }] });
    const id = newestReq().itemIds[0];
    relay(id); onSite(id); hold(id, 'dnd'); resume(id);
    expect(undoStep(id)).toBe('A resume cannot be undone. Put the item on hold again.');
    transfer(id, 'engineering', { note: 'Ladder' });
    const copy = newestReq().itemIds.at(-1)!;
    expect(at(copy)).toMatchObject({ xKind: 'transfer', xNote: 'Ladder', status: 'new' });
    expect(undoStep(id)).toBeNull();
    expect(at(id).status).toBe('on_site');
    expect(at(copy).status).toBe('cancelled');
  });

  it('a started copy blocks undoing its transfer', () => {
    logRequest({ room: '1', rows: [{ type: 'towels' }] });
    const id = newestReq().itemIds[0];
    relay(id);
    transfer(id, 'engineering');
    relay(newestReq().itemIds.at(-1)!);
    expect(undoStep(id)).toBe('The other department already started on it. Ask them to transfer it back.');
    expect(at(id).status).toBe('transferred');
  });
});
