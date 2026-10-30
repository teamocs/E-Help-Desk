import { useEffect, useMemo, useRef, useState } from 'react';
import { ago } from '../domain/rules';
import { finishItem, lastStepEvent, onSite, openComposer, relay, resume, setUI, toast, undoStep, useApp, useUI } from '../domain/store';
import type { Item } from '../domain/types';
import { Button, DeptChip, Empty, Icon, Segmented, Screen, useTier } from '../ui/kit';
import { haptic } from '../lib/haptics';
import { HoldDialog } from '../modules/requests/dialogs';
import { apply, counts, layoutFor, lines, rowActions, timers, todayRange, weekRange, type Filters, type Line, type Quick, type StatusFilter } from '../modules/requests/logic';
import { StatusBadge, TimerText, personName } from '../modules/requests/ui';

const STEP_LABEL = { relay: 'Relay', onSite: 'On site', done: 'Done', hold: 'Hold', resume: 'Resume', undo: 'Undo' } as const;
type Step = keyof typeof STEP_LABEL;

/** Runs a row action. Hold needs a reason, so it asks first (onHold). Undo explains a refusal. */
export function runStep(step: Step, it: Item, onHold: (it: Item) => void) {
  haptic(step === 'done' ? 'success' : 'medium');
  if (step === 'relay') relay(it.id);
  else if (step === 'onSite') onSite(it.id);
  else if (step === 'done') finishItem(it.id);
  else if (step === 'resume') resume(it.id);
  else if (step === 'hold') onHold(it);
  else {
    const why = undoStep(it.id);
    toast(why ?? `Undone. ${it.name} went back one step.`, why ? 'warn' : 'success');
  }
}

/** The filters survive leaving the screen and coming back (the prototype lost them on every render). */
let kept: Filters = { status: 'active', quick: null, from: '', to: '', q: '' };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1024);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Requests() {
  const requests = useApp((s) => s.requests);
  const items = useApp((s) => s.items);
  const now = useApp((s) => s.now);
  const cat = useApp((s) => s.catalog);
  const staff = useApp((s) => s.staff);
  const pending = useApp((s) => s.pending);
  const incidents = useApp((s) => s.incidents);
  const me = useApp((s) => s.staff.find((p) => p.id === s.me));
  const sel = useUI((s) => s.selItem);
  const tier = useTier();
  const [f, setF] = useState<Filters>(() => ({ ...kept, quick: kept.quick ?? (me?.role === 'staff' ? 'mine' : null) }));
  const [holdFor, setHoldFor] = useState<Item>();
  const [ref, width] = useWidth();
  const set = (p: Partial<Filters>) => setF((x) => (kept = { ...x, ...p }));

  const all = useMemo(() => lines(requests, items), [requests, items]);
  const ctx = { items, now, cat, staff };
  // Counters follow the range and search, not the status tab, so every tab shows its own number.
  const inScope = apply(all, { ...f, status: 'all', quick: f.quick === 'mine' ? 'mine' : null, myDept: me?.dept }, ctx);
  const n = counts(inScope, items, now);
  const shown = apply(all, { ...f, myDept: me?.dept }, ctx);
  const layout = layoutFor(width);
  const activeInc = incidents.filter((i) => i.status === 'active');
  const today = todayRange(now);
  const week = weekRange(now);
  const range = !f.from && !f.to ? 'all' : f.from === today.from && f.to === today.to ? 'today' : f.from === week.from && f.to === week.to ? 'week' : 'custom';
  const open = (l: Line) => { haptic('select'); setUI({ selItem: l.req.id, selWo: undefined, sheet: null }); };

  const actions = (l: Line, size: 'sm' = 'sm') =>
    l.it ? rowActions(l.it, items).filter((a) => a !== 'undo' || me?.role !== 'staff' || lastStepEvent(l.it!)?.by === me.id).map((a) => (
      <Button key={a} size={size} variant={a === 'done' ? 'fill' : a === 'undo' ? 'gray' : 'tint'} feel={a === 'done' ? 'success' : 'medium'} aria-label={`${STEP_LABEL[a]}: ${l.code} ${l.it!.name}`} onClick={() => runStep(a, l.it!, setHoldFor)}>
        {a === 'undo' && <Icon name="undo" size={18} />}{STEP_LABEL[a]}
      </Button>
    )) : <Button size={size} variant="tint" onClick={() => open(l)}>Add items</Button>;

  return (
    <Screen
      title="Requests"
      subtitle={`${n.active} active · ${n.overdue} overdue · ${n.on_hold} on hold`}
      trailing={tier !== 'phone' && <Button size="sm" icon="plus" feel="medium" onClick={() => openComposer()}>New request</Button>}
    >
      {activeInc.length > 0 && (
        <button type="button" className="banner bad" style={{ width: '100%', textAlign: 'left', marginBottom: 12 }} onClick={() => setUI({ sheet: 'incident', focusSafetyId: activeInc[0].id })}>
          <Icon name="siren" weight="fill" />
          <span><b>{activeInc[0].no} is active.</b> Staff notified (not BFP/911). Tap to open.</span>
        </button>
      )}

      <div className="rq-bar">
        <div className="rq-bar-row">
          <Segmented<StatusFilter> label="Show" value={f.status} onChange={(status) => set({ status })} options={[
            { value: 'all', label: `All ${n.all}` }, { value: 'active', label: `Active ${n.active}` }, { value: 'done', label: `Done ${n.done}` },
          ]} />
          <div className="rq-quick" role="group" aria-label="Quick filters">
            {([['overdue', `Overdue ${n.overdue}`], ['hold', `On hold ${n.on_hold}`], ...(me?.dept ? [['mine', `My department`]] : [])] as [Quick, string][]).map(([k, label]) => (
              <button key={k} type="button" className="chip" aria-pressed={f.quick === k} onClick={() => { haptic('select'); set({ quick: f.quick === k ? null : k }); }}>{label}</button>
            ))}
          </div>
        </div>
        <div className="rq-bar-row">
          <div className="rq-search">
            <label className="sr" htmlFor="rq-q">Search requests</label>
            <input id="rq-q" className="field" type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search room, item, ticket, person…" autoComplete="off" />
          </div>
          <div className="rq-dates">
            <label>From<input className="field" type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} /></label>
            <label>To<input className="field" type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} /></label>
            <div className="rq-quick" role="group" aria-label="Date range">
              <button type="button" className="chip" aria-pressed={range === 'today'} onClick={() => set(today)}>Today</button>
              <button type="button" className="chip" aria-pressed={range === 'week'} onClick={() => set(week)}>Week</button>
              <button type="button" className="chip" aria-pressed={range === 'all'} onClick={() => set({ from: '', to: '' })}>All dates</button>
            </div>
          </div>
        </div>
      </div>

      <p className="rq-count" aria-live="polite">
        <b>{shown.length}</b> {shown.length === 1 ? 'item' : 'items'}
        {n.new + n.relayed + n.on_site > 0 && ` · ${n.new} new, ${n.relayed} relayed, ${n.on_site} on site`}
        {range !== 'all' && ` · ${f.from === f.to ? `day ${f.from}` : `${f.from || '…'} to ${f.to || '…'}`} (hotel time)`}
      </p>

      <div className="rq-list" ref={ref}>
        {shown.length === 0 ? (
          all.length === 0
            ? <Empty icon="bell" text="No requests yet. When a guest or staff member calls, log the room and what they need." action="New request" onAction={() => openComposer()} />
            : <Empty icon="clip" text="Nothing matches these filters. Try All, another date range, or clear the search." action="Show everything" onAction={() => set({ status: 'all', quick: null, from: '', to: '', q: '' })} />
        ) : layout === 'table' ? (
          <div className="rq-table-wrap">
            <table className="rq-table" aria-label="Request items">
              <thead>
                <tr>
                  <th scope="col">Ticket</th><th scope="col">Room</th><th scope="col">Item</th><th scope="col" className="rq-c3 rq-num">Qty</th><th scope="col" className="rq-c2">Dept</th>
                  <th scope="col">Status</th><th scope="col" className="rq-num" title="Logging to acknowledgement">Relay</th>
                  <th scope="col" className="rq-num rq-c1" title="Acknowledgement to on site">Resp</th><th scope="col" className="rq-num" title="Acknowledgement to done, hold time left out">Res</th>
                  <th scope="col" className="rq-c2">Staff</th><th scope="col" className="rq-c3 rq-num">Age</th><th scope="col" className="rq-num"><span className="sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const t = l.it ? timers(l.it, items, now) : {};
                  const closed = !!l.it && !['new', 'relayed', 'on_site', 'on_hold'].includes(l.it.status);
                  return (
                    <tr key={l.key} aria-selected={sel === l.req.id} className={closed ? 'closed' : ''} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a')) open(l); }}>
                      <td>
                        <button type="button" className="rq-code" onClick={() => open(l)} aria-label={`Open ${l.code}, room ${l.req.room}`}>{l.code}</button>
                        {pending.includes(l.it?.id ?? l.req.id) && <span title="Not yet synced" style={{ marginLeft: 4 }}><Icon name="cloudoff" size={14} /><span className="sr">Not yet synced</span></span>}
                      </td>
                      <td className="rq-room">{l.req.room}{l.req.vip && <span className="pill gold vip">VIP</span>}</td>
                      <td className="rq-item">
                        {l.it ? <>{l.it.name}{l.it.qty > 1 && <span className="rq-narrow-qty">&nbsp;×{l.it.qty}</span>}</> : <i className="c2">Add what they need</i>}
                        {l.it && <span className="rq-narrow-dept"><DeptChip dept={l.it.dept} /></span>}
                        {l.req.source === 'staff_request' && <small>Staff request: {l.req.staffName}</small>}
                      </td>
                      <td className="rq-c3 rq-num">{l.it?.qty ?? ''}</td>
                      <td className="rq-c2">{l.it ? <DeptChip dept={l.it.dept} /> : ''}</td>
                      <td>{l.it ? <StatusBadge status={l.it.status} /> : <span className="st st-on_hold">Finish logging</span>}</td>
                      <td className="rq-num"><TimerText t={t.relay} label="Relay" /></td>
                      <td className="rq-num rq-c1"><TimerText t={t.resp} label="Response" /></td>
                      <td className="rq-num"><TimerText t={t.res} label="Resolution" /></td>
                      <td className="rq-c2">{personName({ staff }, l.it?.assignee) || <span className="c2">—</span>}</td>
                      <td className="rq-c3 rq-num c2">{ago(now - l.req.createdAt)}</td>
                      <td><div className="rq-acts">{actions(l)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="rq-cards" aria-label="Request items">
            {shown.map((l) => {
              const t = l.it ? timers(l.it, items, now) : {};
              return (
                <li key={l.key} className="rq-card" aria-current={sel === l.req.id}>
                  <button type="button" className="rq-card-main" onClick={() => open(l)}>
                    <span className={`room ${l.req.vip ? 'vip' : ''}`} aria-hidden="true">{l.req.room}</span>
                    <span className="rq-card-title"><span className="sr">Room {l.req.room}{l.req.vip ? ', VIP' : ''}. </span>{l.it ? `${l.it.name}${l.it.qty > 1 ? ` ×${l.it.qty}` : ''}` : 'Add what they need'}</span>
                    {l.it ? <StatusBadge status={l.it.status} /> : <span className="st st-on_hold">Finish logging</span>}
                    <span className="rq-card-meta">
                      <span>{l.code}</span>
                      {l.it && <DeptChip dept={l.it.dept} />}
                      {l.it?.assignee && <span>{personName({ staff }, l.it.assignee)}</span>}
                      {l.req.source === 'staff_request' && <span>Staff: {l.req.staffName}</span>}
                      <span>{ago(now - l.req.createdAt)} ago</span>
                      {pending.includes(l.it?.id ?? l.req.id) && <span><Icon name="cloudoff" size={14} /> Not yet synced</span>}
                    </span>
                    {l.it && (
                      <span className="rq-card-times">
                        <span>Relay <b><TimerText t={t.relay} label="Relay" /></b></span>
                        <span>Resp <b><TimerText t={t.resp} label="Response" /></b></span>
                        <span>Res <b><TimerText t={t.res} label="Resolution" /></b></span>
                      </span>
                    )}
                  </button>
                  {(!l.it || rowActions(l.it, items).some((a) => a !== 'undo' || me?.role !== 'staff' || lastStepEvent(l.it!)?.by === me.id)) && <div className="rq-card-acts">{actions(l)}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <HoldDialog item={holdFor} onClose={() => setHoldFor(undefined)} />
    </Screen>
  );
}
