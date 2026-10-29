import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ago, DEPTS, HOLD_REASONS, PRESETS, isBlocked, isOpen, sla } from '../domain/rules';
import { completeRequest, escalate, finishItem, hold, onSite, relay, resume, setUI, transfer, undoEscalate, useApp } from '../domain/store';
import type { Dept, HoldReason, Item } from '../domain/types';
import { Button, DeptChip, Group, Icon, Pill, Ring, Row } from '../ui/kit';
import { springs } from '../lib/motion';

export const STATUS_TEXT: Record<Item['status'], string> = {
  new: 'New', relayed: 'Relayed', on_site: 'On site', on_hold: 'On hold', done: 'Done', transferred: 'Transferred',
  escalated: 'Work order', cant_do: "Can't do", duplicate: 'Duplicate', cancelled: 'Cancelled',
};

export function nextStep(it: Item): { label: string; run: () => void } | null {
  if (it.status === 'new') return { label: 'Relay', run: () => relay(it.id) };
  if (it.status === 'relayed') return { label: 'On site', run: () => onSite(it.id) };
  if (it.status === 'on_site') return { label: 'Done', run: () => finishItem(it.id) };
  if (it.status === 'on_hold') return { label: 'Resume', run: () => resume(it.id) };
  return null;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function toneOf(ratio: number): 'ok' | 'warn' | 'bad' {
  return ratio >= 1 ? 'bad' : ratio >= 0.75 ? 'warn' : 'ok';
}

function ItemCard({ it }: { it: Item }) {
  const items = useApp((s) => s.items);
  const now = useApp((s) => s.now);
  const staff = useApp((s) => s.staff);
  const [mode, setMode] = useState<null | 'hold' | 'transfer'>(null);
  const view = sla(it, items, now);
  const blocked = isBlocked(it, items);
  const pre = it.dependsOn ? items[it.dependsOn] : undefined;
  const who = staff.find((p) => p.id === it.assignee)?.name;
  const next = nextStep(it);
  const open = isOpen(it);

  return (
    <Group>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 className="t-head">{it.name}{it.qty > 1 ? ` ×${it.qty}` : ''}</h3>
            <DeptChip dept={it.dept} />
          </div>
          <p className="t-foot c2" style={{ margin: '4px 0 0' }}>
            {who ? `Assigned to ${who}` : 'In the department queue'}
            {it.xFrom ? ' · transferred in' : ''}
          </p>
          {it.status === 'on_hold' && it.holdReason && <p className="t-foot" style={{ margin: '4px 0 0', color: 'var(--warn)' }}>{HOLD_REASONS[it.holdReason]}. The clock is paused.</p>}
          {blocked && pre && <p className="t-foot" style={{ margin: '4px 0 0', color: 'var(--warn)' }}>Waiting for “{pre.name}”. No clock runs until that is done.</p>}
          {it.status === 'escalated' && <p className="t-foot c2" style={{ margin: '4px 0 0' }}>Tracked as a work order. Completing it closes this item.</p>}
        </div>
        {open && view.phase !== 'waiting' && view.phase !== 'held' ? (
          <Ring ratio={view.ratio} tone={toneOf(view.ratio)} size={44}>
            <span className="t-cap">{ago(view.phase === 'ack' ? now - it.createdAt : now - (it.ackAt ?? it.createdAt) - it.heldMs)}</span>
          </Ring>
        ) : (
          <Pill tone={it.status === 'done' ? 'ok' : it.status === 'on_hold' ? 'warn' : ''}>{STATUS_TEXT[it.status]}</Pill>
        )}
      </div>

      {open && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {next && !blocked && <Button size="sm" feel={next.label === 'Done' ? 'success' : 'medium'} onClick={next.run}>{next.label}</Button>}
          {it.status === 'new' && !blocked && <Button size="sm" variant="tint" onClick={() => onSite(it.id)}>On site</Button>}
          {['relayed', 'on_site'].includes(it.status) && <Button size="sm" variant="gray" onClick={() => setMode(mode === 'hold' ? null : 'hold')}>Hold…</Button>}
          {['engineering', 'it'].includes(it.dept) && ['on_site', 'on_hold'].includes(it.status) && (
            <Button size="sm" variant="tint" icon="wrench" feel="medium" onClick={() => escalate(it.id)}>Escalate to work order</Button>
          )}
          <Button size="sm" variant="gray" onClick={() => setMode(mode === 'transfer' ? null : 'transfer')}>Transfer…</Button>
          <Button size="sm" variant="plain" onClick={() => finishItem(it.id, 'cant_do')}>Can’t do</Button>
        </div>
      )}
      {it.status === 'escalated' && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="tint" onClick={() => setUI({ tab: 'maintenance', selWo: it.woId, selItem: undefined, sheet: null })}>Open work order</Button>
          <Button size="sm" variant="gray" icon="undo" onClick={() => undoEscalate(it.id)}>Undo escalation</Button>
        </div>
      )}

      <AnimatePresence initial={false}>
        {mode && (
          <motion.div key={mode} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={springs.snappy} style={{ overflow: 'hidden' }}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span className="t-foot c2" style={{ width: '100%' }}>{mode === 'hold' ? 'Why is it waiting? The clock pauses.' : 'Move this item to'}</span>
              {mode === 'hold' &&
                (Object.keys(HOLD_REASONS) as HoldReason[]).map((r) => (
                  <button key={r} type="button" className="chip" onClick={() => { hold(it.id, r); setMode(null); }}>{HOLD_REASONS[r]}</button>
                ))}
              {mode === 'transfer' &&
                (Object.keys(DEPTS) as Dept[]).filter((d) => d !== it.dept).map((d) => (
                  <button key={d} type="button" className="chip" onClick={() => { transfer(it.id, d); setMode(null); }}>{DEPTS[d].label}</button>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ol className="timeline" aria-label="History" style={{ listStyle: 'none', padding: '8px 16px 10px 40px', margin: 0 }}>
        {it.events.slice(-4).map((e, i) => (
          <li key={i} className="t-foot">
            <span className="c2">{clock(e.at)}</span> · {e.what}
            <span className="c3"> · {staff.find((p) => p.id === e.by)?.name.split(' ')[0] ?? 'System'}</span>
          </li>
        ))}
      </ol>
    </Group>
  );
}

export function RequestDetail({ id }: { id: string }) {
  const req = useApp((s) => s.requests.find((r) => r.id === id));
  const items = useApp((s) => s.items);
  const now = useApp((s) => s.now);
  const [pick, setPick] = useState<string[]>([]);
  if (!req) return <p className="c2">This ticket is no longer available.</p>;
  const its = req.itemIds.map((i) => items[i]).filter(Boolean);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 0 8px' }}>
        <span className={`room ${req.vip ? 'vip' : ''}`} style={{ minWidth: '4.2rem', height: '3.4rem', fontSize: '1.6rem' }}>{req.room}</span>
        <div>
          <h2 className="t-title2">Room {req.room}</h2>
          <p className="t-sub c2" style={{ margin: 0 }}>{req.ticket} · logged {ago(now - req.createdAt)} ago · {req.source === 'guest' ? 'Guest request' : 'Staff request'}</p>
        </div>
        {req.vip && <Pill tone="gold">VIP</Pill>}
      </div>
      {req.remarks && (
        <Group>
          <Row icon="info" title={<span>“{req.remarks}”</span>} sub="Remark from the guest" />
        </Group>
      )}
      {req.incomplete && its.length === 0 && (
        <Group title="Finish logging" note="You saved this room in two taps. Add what the guest needs.">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {PRESETS.slice(0, 12).map((p) => (
              <button key={p.key} type="button" className="chip" aria-pressed={pick.includes(p.key)} onClick={() => setPick((x) => (x.includes(p.key) ? x.filter((k) => k !== p.key) : [...x, p.key]))}>
                <Icon name={p.icon} size={16} /> {p.label}
              </button>
            ))}
          </div>
          <div className="row">
            <Button block feel="success" disabled={!pick.length} onClick={() => { completeRequest(req.id, pick); setPick([]); }}>Add to ticket</Button>
          </div>
        </Group>
      )}
      {its.map((it) => (
        <div key={it.id} style={{ marginTop: 14 }}><ItemCard it={it} /></div>
      ))}
    </div>
  );
}
