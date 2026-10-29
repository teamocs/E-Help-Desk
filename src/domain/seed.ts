import type { CleanTask, Item, ItemStatus, Request, Seed, WorkOrder } from './types';
import { SEED_CATALOG } from './catalog';

/** Synthetic demo data for a hotel. Pure: every time is relative to `now`. */
export function buildSeed(now: number): Seed {
  const MIN = 60000;
  const min = (m: number) => now - m * MIN;
  const ev = (m: number, by: string, what: string) => ({ at: min(m), by, what });
  const P = (key: string) => {
    const p = SEED_CATALOG.requestTypes.find((x) => x.key === key);
    if (!p) throw new Error(`Unknown preset: ${key}`);
    return p;
  };

  // Item from a request type. Name, dept and slaMin copy from the factory list unless overridden.
  const mk = (id: string, rid: string, key: string, status: ItemStatus, c: number, extra: Partial<Item> = {}): Item => {
    const p = P(key);
    return {
      id, requestId: rid, name: p.label, qty: 1, dept: p.dept, status,
      createdAt: min(c), heldMs: 0, slaMin: p.slaMin,
      events: [ev(c, 's-maria', 'Logged')],
      ...extra,
    };
  };

  // Completed historical item. ack and work are minutes; work excludes held time.
  const dn = (id: string, rid: string, key: string, c: number, ack: number, work: number, who: string, held = 0): Item => {
    const ackAt = min(c - ack);
    const doneAt = min(c - ack - work - held);
    return mk(id, rid, key, 'done', c, {
      assignee: who, ackAt, doneAt, heldMs: held * MIN,
      events: [ev(c, 's-maria', 'Logged'), ev(c - ack, who, 'On site'), ev(c - ack - work - held, who, 'Done')],
    });
  };

  // Request. c is minutes ago.
  const rq = (n: number, room: string, c: number, itemIds: string[], extra: Partial<Request> = {}): Request => ({
    id: `r${n}`, ticket: `T-${String(n).padStart(4, '0')}`, room, source: 'guest', loggedBy: 's-maria',
    createdAt: min(c), itemIds, ...extra,
  });

  // Historical (2-6 h ago), all done. Over SLA: i3 (+4), i4 (+4), i6 (+3), i8 (+3).
  const all: Item[] = [
    dn('i1', 'r1', 'towels', 355, 2, 7, 's-joel'),
    dn('i2', 'r2', 'water', 340, 3, 8, 's-ana'),
    dn('i3', 'r3', 'wifi', 318, 2, 24, 's-paolo'),
    dn('i4', 'r4', 'ac', 300, 4, 49, 's-ramon'),
    dn('i5', 'r5', 'inspection', 285, 1, 20, 's-joel'),
    dn('i6', 'r6', 'noise', 262, 2, 13, 's-ana'),
    dn('i7', 'r7', 'late', 240, 1, 12, 's-maria'),
    dn('i8', 'r8', 'clean', 215, 3, 33, 's-liza'),
    dn('i9', 'r9', 'tray', 180, 2, 9, 's-ana'),
    dn('i10', 'r10', 'hotwater', 150, 2, 20, 's-ramon', 5),
    dn('i11', 'r10', 'bulb', 150, 1, 18, 's-ramon'),

    // Open-ish (last 90 min)
    dn('i12', 'r11', 'pillow', 88, 3, 6, 's-joel'),
    dn('i13', 'r12', 'hotwater', 74, 4, 22, 's-ramon'),
    mk('i14', 'r13', 'wifi', 'on_hold', 66, {
      assignee: 's-paolo', ackAt: min(65), holdReason: 'parts', holdSince: min(25),
      events: [ev(66, 's-maria', 'Logged'), ev(65, 's-paolo', 'On site'), ev(25, 's-paolo', 'On hold: waiting for parts')],
    }),
    dn('i15', 'r14', 'late', 55, 1, 9, 's-maria'),
    mk('i16', 'r15', 'ac', 'on_site', 40, {
      assignee: 's-ramon', ackAt: min(37),
      events: [ev(40, 's-maria', 'Logged'), ev(39, 's-maria', 'Relayed to Engineering'), ev(37, 's-ramon', 'On site')],
    }),
    mk('i17', 'r16', 'bulb', 'on_site', 18, {
      name: 'Leak: fix source', slaMin: 20, assignee: 's-ramon', ackAt: min(16),
      events: [ev(18, 's-maria', 'Logged'), ev(16, 's-ramon', 'On site')],
    }),
    mk('i18', 'r16', 'clean', 'new', 18, {
      name: 'Leak: clean up', slaMin: 25, dependsOn: 'i17',
    }),
    mk('i19', 'r17', 'inspection', 'on_site', 12, {
      assignee: 's-joel', ackAt: min(10),
      events: [ev(12, 's-maria', 'Logged'), ev(10, 's-joel', 'On site')],
    }),
    mk('i20', 'r18', 'tv', 'relayed', 12, {
      events: [ev(12, 's-maria', 'Logged'), ev(11, 's-maria', 'Relayed to IT')],
    }),
    mk('i21', 'r19', 'bulb', 'on_site', 8, {
      assignee: 's-dennis', ackAt: min(6),
      events: [ev(8, 's-maria', 'Logged'), ev(6, 's-dennis', 'On site')],
    }),
    mk('i22', 'r19', 'tray', 'on_site', 8, {
      assignee: 's-ana', ackAt: min(5),
      events: [ev(8, 's-maria', 'Logged'), ev(5, 's-ana', 'On site')],
    }),
    mk('i23', 'r20', 'toiletries', 'new', 7),
    mk('i24', 'r21', 'towels', 'on_site', 5, {
      qty: 3, assignee: 's-joel', ackAt: min(3),
      events: [ev(5, 's-maria', 'Logged'), ev(3, 's-joel', 'On site')],
    }),
  ];

  const items: Record<string, Item> = {};
  for (const it of all) items[it.id] = it;

  const requests: Request[] = [
    rq(1, '214', 355, ['i1']),
    rq(2, '322', 340, ['i2']),
    rq(3, '410', 318, ['i3']),
    rq(4, '503', 300, ['i4']),
    rq(5, '305', 285, ['i5'], { source: 'staff' }),
    rq(6, '611', 262, ['i6']),
    rq(7, '228', 240, ['i7']),
    rq(8, '417', 215, ['i8']),
    rq(9, '540', 180, ['i9']),
    rq(10, '333', 150, ['i10', 'i11']),
    rq(11, '215', 88, ['i12']),
    rq(12, '402', 74, ['i13'], { remarks: 'Walang hot water sa shower po' }),
    rq(13, '512', 66, ['i14']),
    rq(14, '330', 55, ['i15']),
    rq(15, '508', 40, ['i16'], { vip: true, remarks: 'Hindi po lumalamig ang AC' }),
    rq(16, '417', 18, ['i17', 'i18']),
    rq(17, '305', 12, ['i19'], { source: 'staff' }),
    rq(18, '228', 12, ['i20']),
    rq(19, '433', 8, ['i21', 'i22']),
    rq(20, '219', 7, ['i23']),
    rq(21, '447', 5, ['i24'], { remarks: 'Pakidagdagan po ng towels' }),
    rq(22, '519', 3, [], { incomplete: true }),
  ];

  const wos: WorkOrder[] = [
    {
      id: 'wo1', no: 'WO-0001', area: 'Lobby', loc: 'Lobby restroom', desc: 'Faucet dripping at the restroom basin.',
      priority: 'normal', dept: 'engineering', status: 'reported', reportedBy: 's-maria', encodedBy: 's-maria',
      createdAt: min(2880), audit: [{ at: min(2880), by: 's-maria', what: 'Reported' }],
    },
    {
      id: 'wo2', no: 'WO-0002', area: 'Mechanical', loc: 'Chiller plant room', desc: 'Replace chiller pump seal.',
      priority: 'high', dept: 'engineering', status: 'assessed', assignType: 'outsource', contractor: 'CoolAir Services',
      estCost: 18500, assessment: 'Seal weeping at pump shaft. Replace mechanical seal and test under load.',
      reportedBy: 's-ramon', encodedBy: 's-maria', createdAt: min(1440),
      audit: [{ at: min(1440), by: 's-ramon', what: 'Reported' }, { at: min(1100), by: 's-maria', what: 'Assessed: outsource' }],
    },
    {
      id: 'wo3', no: 'WO-0003', area: '3F Corridor', loc: '3F corridor wall', desc: 'Repaint corridor wall on 3F.',
      priority: 'low', dept: 'engineering', status: 'in_progress', assignType: 'inhouse', estCost: 4500,
      assessment: 'Patch cracks, prime, two coats. Scaffold needed.', reportedBy: 's-liza', encodedBy: 's-maria',
      createdAt: min(4320), audit: [{ at: min(4320), by: 's-liza', what: 'Reported' }, { at: min(3000), by: 's-ramon', what: 'Started' }],
    },
    {
      id: 'wo4', no: 'WO-0004', area: 'Lobby', loc: 'Lobby ceiling', desc: 'Replace lobby light fixture.',
      priority: 'normal', dept: 'engineering', status: 'done', estCost: 3000, actualCost: 2650,
      reportedBy: 's-ramon', encodedBy: 's-maria', createdAt: min(7200),
      audit: [
        { at: min(7200), by: 's-ramon', what: 'Reported' },
        { at: min(6900), by: 's-maria', what: 'Assessed: inhouse' },
        { at: min(6000), by: 's-ramon', what: 'Done' },
      ],
    },
  ];

  const cleaning: CleanTask[] = [
    { id: 'c1', room: '305', type: 'Checkout', status: 'queued', assignee: 's-joel' },
    { id: 'c2', room: '412', type: 'Checkout', status: 'scheduled' },
    { id: 'c3', room: '214', type: 'Regular', status: 'in_progress', assignee: 's-joel' },
    { id: 'c4', room: '322', type: 'Regular', status: 'ready', assignee: 's-liza' },
    { id: 'c5', room: '508', type: 'VIP setup', status: 'ready' },
    { id: 'c6', room: '417', type: 'Deep clean', status: 'queued', assignee: 's-liza' },
    { id: 'c7', room: '540', type: 'Turndown', status: 'scheduled' },
    { id: 'c8', room: '620', type: 'Pre-arrival', status: 'done', assignee: 's-liza' },
  ];

  return {
    requests,
    items,
    wos,
    cleaning,
    seq: { t: requests.length, wo: wos.length, inc: 0, id: 1000 },
  };
}
