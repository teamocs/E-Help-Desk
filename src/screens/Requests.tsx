import { useMemo, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { ago, isBlocked, isOpen, sla } from '../domain/rules';
import { hold, openComposer, setUI, useApp, useUI } from '../domain/store';
import type { Item, Request, State } from '../domain/types';
import { Button, DeptChip, Group, Icon, NetPill, Pill, Ring, Screen, Segmented, useTier } from '../ui/kit';
import { haptic } from '../lib/haptics';
import { STATUS_TEXT, nextStep, toneOf } from './Detail';

type Filter = 'open' | 'overdue' | 'hold' | 'done';

interface RowData {
  req: Request;
  items: Item[];
  open: Item[];
  primary?: Item;
  ratio: number;
  overdue: boolean;
  phase: string;
}

function build(s: Pick<State, 'requests' | 'items' | 'now'>): RowData[] {
  return s.requests.map((req) => {
    const items = req.itemIds.map((i) => s.items[i]).filter(Boolean);
    const open = items.filter(isOpen);
    const primary = open.find((i) => !isBlocked(i, s.items)) ?? open[0];
    const v = primary ? sla(primary, s.items, s.now) : null;
    return { req, items, open, primary, ratio: v?.ratio ?? 0, overdue: !!v?.overdue, phase: v?.phase ?? 'closed' };
  });
}

function TicketRow({ d, hideTimers, selected, pending, now }: { d: RowData; hideTimers: boolean; selected: boolean; pending: boolean; now: number }) {
  const x = useMotionValue(0);
  const opL = useTransform(x, [0, 60], [0, 1]);
  const opR = useTransform(x, [0, -60], [0, 1]);
  const next = d.primary ? nextStep(d.primary) : null;
  const canHold = d.primary && ['relayed', 'on_site'].includes(d.primary.status);
  const { req, primary, open } = d;
  const title = req.incomplete && !req.itemIds.length ? 'Add what they need' : primary ? primary.name : d.items[0]?.name ?? 'Closed';
  const more = open.length > 1 ? ` +${open.length - 1}` : '';
  const tier = useTier();
  const swipeable = tier === 'phone' || tier === 'tablet';

  let trailing;
  if (req.incomplete && !req.itemIds.length) trailing = <Pill tone="warn">Finish</Pill>;
  else if (!open.length) trailing = <Pill tone="ok">Done</Pill>;
  else if (d.phase === 'held') trailing = <Pill tone="warn">On hold</Pill>;
  else if (d.phase === 'waiting') trailing = <Pill>Waiting</Pill>;
  else if (hideTimers) trailing = <Pill>{primary ? STATUS_TEXT[primary.status] : ''}</Pill>;
  else
    trailing = (
      <Ring ratio={d.ratio} tone={toneOf(d.ratio)}>
        {d.overdue && <Icon name="warn" size={14} weight="fill" />}
      </Ring>
    );

  const main = (
    <button type="button" className="ticket" aria-current={selected} onClick={() => { haptic('select'); setUI({ selItem: req.id, selWo: undefined, sheet: null }); }}>
      <span className="sr">{`Room ${req.room}. ${d.overdue && !hideTimers ? 'Overdue. ' : ''}${req.vip ? 'VIP guest. ' : ''}${pending ? 'Not yet synced. ' : ''}`}</span>
      <span className={`room ${req.vip ? 'vip' : ''}`} aria-hidden="true">{req.room}</span>
      <span style={{ minWidth: 0 }}>
        <span className="t-head ellip" style={{ display: 'block' }}>{title}{more}</span>
        <span className="t-foot c2 ellip" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
          {req.ticket} · {ago(now - req.createdAt)}
          {pending && <Icon name="cloudoff" size={14} />}
          {open.slice(0, 2).map((i) => <DeptChip key={i.id} dept={i.dept} />)}
        </span>
      </span>
      {trailing}
    </button>
  );

  if (!swipeable || !(next || canHold)) return <div className="swipe"><div className="swipe-fg">{main}</div></div>;
  return (
    <div className="swipe">
      <motion.div className="swipe-bg l" aria-hidden="true" style={{ opacity: opL }}><span>{next?.label}</span><span /></motion.div>
      <motion.div className="swipe-bg r" aria-hidden="true" style={{ opacity: opR }}><span /><span>Hold</span></motion.div>
      <motion.div
        className="swipe-fg"
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.35, right: 0.5 }}
        style={{ x }}
        onDragEnd={(_, i) => {
          if (i.offset.x > 90 && next) { haptic('medium'); next.run(); }
          else if (i.offset.x < -90 && canHold && primary) { haptic('light'); hold(primary.id, 'dnd'); }
        }}
      >
        {main}
      </motion.div>
    </div>
  );
}

export function Requests() {
  const requests = useApp((s) => s.requests);
  const items = useApp((s) => s.items);
  const now = useApp((s) => s.now);
  const pending = useApp((s) => s.pending);
  const incidents = useApp((s) => s.incidents);
  const me = useApp((s) => s.staff.find((p) => p.id === s.me));
  const shadow = useApp((s) => s.prefs.shadow);
  const sel = useUI((s) => s.selItem);
  const tier = useTier();
  const [filter, setFilter] = useState<Filter>('open');
  const [scope, setScope] = useState<'all' | 'mine'>(me?.role === 'staff' ? 'mine' : 'all');
  const hideTimers = shadow && (me?.role === 'manager' || me?.role === 'owner');

  const rows = useMemo(() => build({ requests, items, now }), [requests, items, now]);
  const scoped = rows.filter((d) => scope === 'all' || !me?.dept || d.items.some((i) => i.dept === me.dept) || (d.req.incomplete && !d.items.length));
  const finish = scoped.filter((d) => d.req.incomplete && !d.req.itemIds.length);
  const live = scoped.filter((d) => d.open.length);
  const attention = live.filter((d) => d.overdue || d.req.vip);
  const calm = live.filter((d) => !(d.overdue || d.req.vip));
  const held = live.filter((d) => d.phase === 'held');
  const done = scoped.filter((d) => !d.open.length && d.items.length).slice(0, 12);
  const activeInc = incidents.filter((i) => i.status === 'active');
  const att = hideTimers ? [] : attention;
  const rest = hideTimers ? live : calm;

  const list = (title: string, ds: RowData[]) =>
    ds.length > 0 && (
      <Group title={title}>
        {ds.map((d) => <TicketRow key={d.req.id} d={d} hideTimers={hideTimers} selected={sel === d.req.id} pending={pending.includes(d.req.id)} now={now} />)}
      </Group>
    );

  return (
    <Screen
      title="Requests"
      subtitle={`${live.length} open · ${hideTimers ? 'timers hidden in shadow mode' : `${attention.filter((d) => d.overdue).length} overdue`}`}
      trailing={<><NetPill />{tier !== 'phone' && <Button size="sm" icon="plus" feel="medium" onClick={() => openComposer()}>New request</Button>}</>}
    >
      {activeInc.length > 0 && (
        <button type="button" className="banner bad" style={{ width: '100%', textAlign: 'left', marginBottom: 12 }} onClick={() => setUI({ sheet: 'incident', focusSafetyId: activeInc[0].id })}>
          <Icon name="siren" weight="fill" />
          <span><b>{activeInc[0].no} is active.</b> Staff notified (not BFP/911). Tap to open.</span>
        </button>
      )}
      <Segmented<Filter> label="Filter" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue' }, { value: 'hold', label: 'On hold' }, { value: 'done', label: 'Done' }]} />
      {me?.dept && (
        <div style={{ marginTop: 10 }}>
          <Segmented<'all' | 'mine'> label="Scope" value={scope} onChange={setScope} options={[{ value: 'all', label: 'All departments' }, { value: 'mine', label: `My department` }]} />
        </div>
      )}
      {filter === 'open' && (<>{list('Finish logging', finish)}{list('Needs attention', att)}{list('In progress', rest)}</>)}
      {filter === 'overdue' && (hideTimers ? <p className="c2" style={{ padding: 16 }}>Timers are hidden while the pilot runs in shadow mode.</p> : list('Overdue', live.filter((d) => d.overdue)))}
      {filter === 'hold' && list('On hold', held)}
      {filter === 'done' && list('Done this shift', done)}
      {((filter === 'open' && !finish.length && !live.length) || (filter === 'hold' && !held.length) || (filter === 'done' && !done.length) || (filter === 'overdue' && !hideTimers && !live.some((d) => d.overdue))) && (
        <p className="c2" style={{ padding: '2rem 16px', textAlign: 'center' }}>Nothing here right now.</p>
      )}
    </Screen>
  );
}
