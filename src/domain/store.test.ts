import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ackHandover, app, applySnapshot, assessWo, escalate, finishItem, hold, logRequest, onSite, raiseSafety, relay, resetApp, resume, returnOrphans, setNet, setPref, transfer, undoEscalate, completeWo, unlock } from './store';
import { detectSafety, hubUp, pad, sla } from './rules';
import { memoryOutbox } from './outbox';
import { remote } from './remote';
import type { Command, Snapshot } from './contract';
import type { Net } from './types';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
  resetApp(Date.now());
});

afterEach(() => {
  vi.useRealTimers();
});

/** Item id of the first item on the newest request. */
const newestItemId = () => app.get().requests[0].itemIds[0];
const itemOf = (id: string) => app.get().items[id];

describe('detectSafety', () => {
  it('flags smoke from English and Tagalog words', () => {
    expect(detectSafety('may usok sa hallway')).toBe('smoke');
  });

  it('flags a gas smell', () => {
    expect(detectSafety('amoy gas dito')).toBe('gas');
  });

  it('flags flooding', () => {
    expect(detectSafety('baha sa banyo')).toBe('flood');
  });

  it('flags medical distress', () => {
    expect(detectSafety('hindi makahinga si guest')).toBe('medical');
  });

  it('returns null for ordinary requests', () => {
    expect(detectSafety('extra towels please')).toBeNull();
  });
});

describe('hubUp', () => {
  const base: Net = { internet: true, deviceWifi: true, power: true, tier: 'standard', ups: 0 };

  it('standard tier is down without internet', () => {
    expect(hubUp({ ...base, tier: 'standard', internet: false })).toBe(false);
  });

  it('resilient tier stays up without internet', () => {
    expect(hubUp({ ...base, tier: 'resilient', internet: false })).toBe(true);
  });

  it('resilient tier stays up on UPS during a power cut', () => {
    expect(hubUp({ ...base, tier: 'resilient', power: false, ups: 40 })).toBe(true);
  });

  it('resilient tier is down with no power and an empty UPS', () => {
    expect(hubUp({ ...base, tier: 'resilient', power: false, ups: 0 })).toBe(false);
  });

  it('device Wi-Fi loss takes both tiers down', () => {
    expect(hubUp({ ...base, tier: 'standard', deviceWifi: false })).toBe(false);
    expect(hubUp({ ...base, tier: 'resilient', deviceWifi: false })).toBe(false);
  });
});

describe('logRequest', () => {
  it('adds a new request at the front with one housekeeping item and the next ticket number', () => {
    const prevSeq = app.get().seq.t;
    const reqId = logRequest({ room: '412', presets: ['towels'] });

    const req = app.get().requests[0];
    expect(req.id).toBe(reqId);
    expect(req.room).toBe('412');
    expect(req.ticket).toBe(`T-${pad(prevSeq + 1)}`);
    expect(req.itemIds).toHaveLength(1);

    const it = itemOf(req.itemIds[0]);
    expect(it.status).toBe('new');
    expect(it.dept).toBe('housekeeping');
    expect(it.slaMin).toBe(10);
  });
});

describe('bundles', () => {
  it('leak bundle creates two items, with housekeeping waiting on engineering', () => {
    logRequest({ room: '320', bundle: 'leak' });
    const [fixId, cleanId] = app.get().requests[0].itemIds;
    expect(app.get().requests[0].itemIds).toHaveLength(2);
    expect(itemOf(cleanId).dependsOn).toBe(fixId);
    expect(itemOf(fixId).dept).toBe('engineering');
    expect(itemOf(cleanId).dept).toBe('housekeeping');
  });

  it('finishing the dependent item before the first is done leaves it new', () => {
    logRequest({ room: '320', bundle: 'leak' });
    const [, cleanId] = app.get().requests[0].itemIds;
    finishItem(cleanId);
    expect(itemOf(cleanId).status).toBe('new');
  });
});

describe('item lifecycle', () => {
  it('relay, on-site, then done sets ack and done times', () => {
    logRequest({ room: '412', presets: ['towels'] });
    const id = newestItemId();

    relay(id);
    expect(itemOf(id).status).toBe('relayed');
    expect(itemOf(id).ackAt).toBe(Date.now());

    onSite(id);
    expect(itemOf(id).status).toBe('on_site');

    finishItem(id);
    expect(itemOf(id).status).toBe('done');
    expect(itemOf(id).doneAt).toBe(Date.now());
  });

  it('hold then resume adds the held time and returns to on site', () => {
    logRequest({ room: '412', presets: ['towels'] });
    const id = newestItemId();
    relay(id);
    onSite(id);

    hold(id, 'parts');
    vi.advanceTimersByTime(5 * 60000);

    const view = sla(itemOf(id), app.get().items, Date.now());
    expect(view.phase).toBe('held');

    resume(id);
    expect(itemOf(id).status).toBe('on_site');
    expect(itemOf(id).heldMs).toBeGreaterThanOrEqual(5 * 60000 - 1000);
    expect(itemOf(id).heldMs).toBeLessThanOrEqual(5 * 60000 + 1000);
  });
});

describe('escalation to work orders', () => {
  it('escalates an on-site engineering item to a work order and can undo it', () => {
    logRequest({ room: '508', presets: ['ac'] });
    const id = newestItemId();
    onSite(id);
    const woCount = app.get().wos.length;

    expect(escalate(id)).toBe(true);
    const wo = app.get().wos[0];
    expect(app.get().wos).toHaveLength(woCount + 1);
    expect(wo.srcItemId).toBe(id);
    expect(itemOf(id).status).toBe('escalated');
    expect(itemOf(id).woId).toBe(wo.id);

    undoEscalate(id);
    expect(itemOf(id).status).toBe('on_site');
    expect(app.get().wos.some((w) => w.id === wo.id)).toBe(false);
  });

  it('completing the work order closes the escalated item', () => {
    logRequest({ room: '508', presets: ['ac'] });
    const id = newestItemId();
    onSite(id);
    escalate(id);
    const woId = itemOf(id).woId!;
    // completeWo only accepts assessed / in_progress / on_hold work orders, so assess first.
    assessWo(woId, { assessment: 'Replace fan motor', assignType: 'inhouse', estCost: 500 });

    completeWo(woId, 1000);
    const wo = app.get().wos.find((w) => w.id === woId)!;
    expect(wo.status).toBe('done');
    expect(itemOf(id).status).toBe('done');
  });

  it('refuses to escalate a housekeeping item', () => {
    logRequest({ room: '412', presets: ['towels'] });
    const id = newestItemId();
    onSite(id);
    const woCount = app.get().wos.length;
    const itemCount = Object.keys(app.get().items).length;

    expect(escalate(id)).toBe(false);
    expect(app.get().wos).toHaveLength(woCount);
    expect(Object.keys(app.get().items)).toHaveLength(itemCount);
  });
});

describe('cleaning automation', () => {
  it('finishing a checkout inspection readies the room cleaning task', () => {
    // Seed: item i19 is 'Checkout inspection' in room 305, on site; cleaning c1 for 305 is queued.
    expect(app.get().cleaning.find((c) => c.id === 'c1')?.status).toBe('queued');
    finishItem('i19');
    expect(app.get().cleaning.find((c) => c.id === 'c1')?.status).toBe('ready');
  });
});

describe('transfer', () => {
  it('transfers an open item to another department and creates a linked new item', () => {
    logRequest({ room: '412', presets: ['towels'] });
    const id = newestItemId();

    transfer(id, 'it');
    expect(itemOf(id).status).toBe('transferred');

    const moved = Object.values(app.get().items).find((i) => i.xFrom === id);
    expect(moved).toBeDefined();
    expect(moved!.dept).toBe('it');
    expect(moved!.status).toBe('new');
  });
});

describe('offline queue', () => {
  it('queues changes while device Wi-Fi is down and syncs them on reconnect', () => {
    setNet({ deviceWifi: false });
    const reqId = logRequest({ room: '101', presets: ['towels'] });

    expect(app.get().ops[0].synced).toBe(false);
    expect(app.get().pending).toContain(reqId);

    setNet({ deviceWifi: true });
    vi.advanceTimersByTime(1500);

    expect(app.get().ops.every((o) => o.synced)).toBe(true);
    expect(app.get().pending).toEqual([]);
  });
});

describe('raiseSafety', () => {
  it('merges a second smoke report from another room into the same incident', () => {
    const first = raiseSafety('612', 'usok', 'smoke');
    expect(first.clustered).toBe(false);

    const second = raiseSafety('614', 'usok din', 'smoke');
    expect(second.clustered).toBe(true);
    expect(second.id).toBe(first.id);

    const inc = app.get().incidents.find((i) => i.id === first.id)!;
    expect(inc.rooms).toHaveLength(2);
    expect(app.get().incidents).toHaveLength(1);
  });
});

describe('handover', () => {
  const orphanIds = () => Object.values(app.get().items).filter((i) => i.assignee === 's-dennis' && ['new', 'relayed', 'on_site', 'on_hold'].includes(i.status)).map((i) => i.id);

  it('demo: sign-off and orphan return change local state only', () => {
    unlock('s-maria');
    const orphans = orphanIds();
    expect(orphans.length).toBeGreaterThan(0);
    ackHandover();
    expect(app.get().handover).toEqual({ ackBy: 'Maria Santos', ackAt: Date.now() });
    returnOrphans();
    for (const id of orphans) expect(itemOf(id).assignee).toBeUndefined();
    expect(itemOf(orphans[0]).events.at(-1)?.what).toBe('Returned to department queue at shift end');
  });

  it('server-backed: sends both as commands and a snapshot restores the sign-off', async () => {
    vi.useRealTimers();
    unlock('s-maria');
    const sent: Command[] = [];
    remote.enable(
      { run: async (c) => { sent.push(c); return { ok: true, applied: true }; }, load: () => new Promise<Snapshot>(() => {}) },
      { snapshot: () => {}, error: () => {} },
      { scope: 'p', outbox: memoryOutbox() },
    );
    try {
      const orphans = orphanIds();
      ackHandover();
      expect(app.get().handover).toMatchObject({ ackBy: 'Maria Santos' });
      returnOrphans();
      for (const id of orphans) expect(itemOf(id).assignee).toBeUndefined();
      await vi.waitFor(() => expect(sent).toHaveLength(2));
      expect(sent[0]).toMatchObject({ type: 'ackHandover', handoverId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      expect(sent[1]).toMatchObject({ type: 'returnOrphans', itemIds: orphans });

      const s = app.get();
      const snap: Snapshot = {
        property: { id: 'p', name: 'P' }, properties: [], staff: s.staff, requests: s.requests, items: s.items, wos: s.wos,
        cleaning: s.cleaning, incidents: [], seq: s.seq, at: 0, handover: { ackBy: 'Joel Dizon', ackAt: 1234 },
      };
      applySnapshot(snap);
      expect(app.get().handover).toEqual({ ackBy: 'Joel Dizon', ackAt: 1234 });
      applySnapshot({ ...snap, handover: {} });
      expect(app.get().handover).toEqual({});
    } finally {
      remote.disable();
    }
  });
});

describe('resetApp', () => {
  it('keeps the signed-in user and preferences', () => {
    unlock('s-maria');
    setPref('contrast', true);
    setPref('textScale', 1.25);

    resetApp(Date.now());

    expect(app.get().me).toBe('s-maria');
    expect(app.get().prefs.contrast).toBe(true);
    expect(app.get().prefs.textScale).toBe(1.25);
    expect(app.get().requests).toHaveLength(22);
  });
});
