import { useState } from 'react';
import { activeOf, canEscalate, deptLabel, holdLabel } from '../domain/catalog';
import { ago, isBlocked, isOpen, undoTarget } from '../domain/rules';
import { completeRequest, escalate, finishItem, lastStep, lastStepEvent, onSite, relay, resume, setUI, toast, undoEscalate, undoStep, useApp } from '../domain/store';
import type { Item } from '../domain/types';
import { Button, DeptChip, Icon, Pill } from '../ui/kit';
import { haptic } from '../lib/haptics';
import { EditItemDialog, EditTicketDialog, HandOffForm, HoldDialog, TransferForm } from '../modules/requests/dialogs';
import { ticketStatus, timers } from '../modules/requests/logic';
import { STATUS_WORD, StatusBadge, TimerText, hotelTime, personName } from '../modules/requests/ui';

/** Kept for other screens (the Dashboard's recent tickets). */
export const STATUS_TEXT = STATUS_WORD;

export function nextStep(it: Item): { label: string; run: () => void } | null {
  if (it.status === 'new') return { label: 'Relay', run: () => relay(it.id) };
  if (it.status === 'relayed') return { label: 'On site', run: () => onSite(it.id) };
  if (it.status === 'on_site') return { label: 'Done', run: () => finishItem(it.id) };
  if (it.status === 'on_hold') return { label: 'Resume', run: () => resume(it.id) };
  return null;
}

export function toneOf(ratio: number): 'ok' | 'warn' | 'bad' {
  return ratio >= 1 ? 'bad' : ratio >= 0.75 ? 'warn' : 'ok';
}

const by = (staff: { id: string; name: string }[], id: string) => staff.find((p) => p.id === id)?.name ?? (id === 'system' ? 'System' : 'A manager');

/** A history list: who, when, what (changes read "Room: 412 → 414"). */
function History({ events, label, all }: { events: { at: number; by: string; what: string }[]; label: string; all?: boolean }) {
  const staff = useApp((s) => s.staff);
  const cat = useApp((s) => s.catalog);
  // The server writes department keys in a few lines ("Transferred to it"); show the hotel's label.
  const say = (w: string) => w.replace(/^((?:Undone: )?Transferred to )(\S+)$/, (_, a, k) => a + deptLabel(k, cat));
  const [more, setMore] = useState(false);
  const list = all || more ? events : events.slice(-4);
  if (!events.length) return null;
  return (
    <ol className="rq-hist" aria-label={label}>
      {list.map((e, i) => (
        <li key={i}><span className="c2">{hotelTime(e.at)}</span> · {say(e.what)} <span className="c2">· {by(staff, e.by)}</span></li>
      ))}
      {!all && events.length > 4 && (
        <li><button type="button" className="btn btn-plain btn-sm" style={{ paddingLeft: 0 }} aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? 'Show less' : `Show all ${events.length}`}</button></li>
      )}
    </ol>
  );
}

function ItemCard({ it, code, codeOf }: { it: Item; code: string; codeOf: (id?: string) => string }) {
  const items = useApp((s) => s.items);
  const now = useApp((s) => s.now);
  const staff = useApp((s) => s.staff);
  const catalog = useApp((s) => s.catalog);
  const wo = useApp((s) => (it.woId ? s.wos.find((w) => w.id === it.woId) : undefined));
  const [mode, setMode] = useState<null | 'transfer' | 'handoff'>(null);
  const [edit, setEdit] = useState(false);
  const [holding, setHolding] = useState(false);
  const blocked = isBlocked(it, items);
  const pre = it.dependsOn ? items[it.dependsOn] : undefined;
  const t = timers(it, items, now);
  const open = isOpen(it);
  const parked = it.status === 'transferred' || it.status === 'escalated';
  const from = it.xFrom ? items[it.xFrom] : undefined;
  const undo = undoTarget(it);
  const me = useApp((s) => s.staff.find((p) => p.id === s.me));
  // Department staff may only undo a step they took themselves (the server refuses the rest).
  const mine = me?.role !== 'staff' || lastStepEvent(it)?.by === me.id;
  const canUndo = mine && it.status !== 'new' && !('refused' in undo) && !(it.status === 'cancelled' && !lastStep(it)) && it.status !== 'escalated';
  const step = lastStep(it);
  const doUndo = () => {
    const why = undoStep(it.id);
    toast(why ?? `Undone: ${step ?? 'last step'}. ${it.name} went back one step.`, why ? 'warn' : 'success');
  };
  const go = (fn: () => void) => () => { haptic('medium'); fn(); };

  return (
    <div className={`rq-itm ${parked ? 'off' : ''}`}>
      <div className="rq-itm-top">
        <h3 className="t-head"><span className="rq-itm-code">{code}</span>{it.name}{it.qty > 1 ? ` ×${it.qty}` : ''}</h3>
        <StatusBadge status={it.status} />
      </div>
      {from && (
        <p className="rq-link">
          {it.xKind === 'handoff' ? `Follow-up from ${codeOf(from.id)} (${deptLabel(from.dept, catalog)})` : `Transferred from ${codeOf(from.id)} (${deptLabel(from.dept, catalog)})`}
          {it.xNote ? `: ${it.xNote}` : ''}
        </p>
      )}
      <p className="rq-meta">
        <DeptChip dept={it.dept} />
        <span>{it.assignee ? <>Assigned <b>{personName({ staff }, it.assignee)}</b></> : 'In the department queue'}</span>
        {it.relayedBy && <span>Relayed by {personName({ staff }, it.relayedBy)}</span>}
      </p>
      <p className="rq-meta">
        <span>Relay <b><TimerText t={t.relay} label="Relay" /></b></span>
        <span>Resp <b><TimerText t={t.resp} label="Response" /></b></span>
        <span>Res <b><TimerText t={t.res} label="Resolution" /></b> <span className="c2">of {it.slaMin} min</span></span>
      </p>
      {it.status === 'on_hold' && it.holdReason && <p className="rq-strip">On hold: {holdLabel(it.holdReason, catalog)}. The clock is paused{it.holdSince ? ` (${ago(now - it.holdSince)})` : ''}.</p>}
      {blocked && pre && <p className="rq-strip">Waiting for “{pre.name}”. No clock runs until that is done.</p>}
      {it.remarks && <p className="rq-meta">Remarks: {it.remarks}</p>}
      {it.status === 'escalated' && (
        <p className="rq-meta">
          <button type="button" className="btn btn-plain btn-sm" style={{ paddingLeft: 0 }} onClick={() => setUI({ tab: 'workorders', selWo: it.woId, selItem: undefined, sheet: null })}>
            <Icon name="wrench" size={18} /> {wo ? `${wo.no} (${wo.status.replace('_', ' ')})` : 'Open work order'}
          </button>
          Completing it closes this item.
        </p>
      )}

      {!parked && (
        <div className="rq-acts-wrap">
          <Button size="sm" variant="gray" onClick={() => setEdit(true)} aria-label={`Edit ${code}`}>Edit</Button>
          {canUndo && <Button size="sm" variant="gray" icon="undo" onClick={doUndo} aria-label={`Undo ${step ?? 'last step'} on ${code}`}>Undo</Button>}
          {open && !blocked && it.status === 'new' && <Button size="sm" feel="medium" onClick={go(() => relay(it.id))}>Relay</Button>}
          {open && !blocked && ['new', 'relayed'].includes(it.status) && <Button size="sm" variant="tint" onClick={go(() => onSite(it.id))}>On site</Button>}
          {it.status === 'on_site' && activeOf(catalog.holdReasons).length > 0 && <Button size="sm" variant="tint" onClick={() => setHolding(true)}>Hold</Button>}
          {it.status === 'on_hold' && <Button size="sm" feel="medium" onClick={go(() => resume(it.id))}>Resume</Button>}
          {open && !blocked && ['relayed', 'on_site'].includes(it.status) && <Button size="sm" feel="success" onClick={go(() => finishItem(it.id))}>Done</Button>}
          {open && it.status !== 'new' && <Button size="sm" variant="tint" aria-expanded={mode === 'transfer'} onClick={() => setMode(mode === 'transfer' ? null : 'transfer')}>Transfer</Button>}
          {it.status === 'done' && <Button size="sm" variant="tint" aria-expanded={mode === 'handoff'} onClick={() => setMode(mode === 'handoff' ? null : 'handoff')}>Hand off</Button>}
          {canEscalate(it.dept, catalog) && ['on_site', 'on_hold'].includes(it.status) && <Button size="sm" variant="bad" icon="wrench" feel="medium" onClick={() => escalate(it.id)}>Work order</Button>}
          {open && <Button size="sm" variant="plain" onClick={go(() => finishItem(it.id, 'cant_do'))}>Can’t do</Button>}
        </div>
      )}
      {it.status === 'escalated' && (
        <div className="rq-acts-wrap"><Button size="sm" variant="gray" icon="undo" onClick={() => undoEscalate(it.id)}>Undo work order</Button></div>
      )}
      {it.status === 'transferred' && canUndo && (
        <div className="rq-acts-wrap"><Button size="sm" variant="gray" icon="undo" onClick={doUndo} aria-label={`Undo the transfer of ${code}`}>Undo transfer</Button></div>
      )}
      {mode === 'transfer' && open && <TransferForm item={it} onDone={() => setMode(null)} />}
      {mode === 'handoff' && it.status === 'done' && <HandOffForm item={it} onDone={() => setMode(null)} />}
      <History events={it.events} label={`History of ${code}`} />
      <EditItemDialog item={edit ? it : undefined} code={code} onClose={() => setEdit(false)} />
      <HoldDialog item={holding ? it : undefined} onClose={() => setHolding(false)} />
    </div>
  );
}

const STATUS_LINE = { new: 'New', in_progress: 'In progress', done: 'Done' } as const;

export function RequestDetail({ id }: { id: string }) {
  const req = useApp((s) => s.requests.find((r) => r.id === id));
  const items = useApp((s) => s.items);
  const staff = useApp((s) => s.staff);
  const types = useApp((s) => s.catalog.requestTypes);
  const now = useApp((s) => s.now);
  // Editing a ticket is desk work (full access to Requests); department staff only work on their items.
  const deskOnly = useApp((s) => s.staff.find((p) => p.id === s.me)?.role === 'staff');
  const [pick, setPick] = useState<string[]>([]);
  const [edit, setEdit] = useState(false);
  if (!req) return <p className="c2">This ticket is no longer available.</p>;
  const its = req.itemIds.map((i) => items[i]).filter(Boolean);
  const codeOf = (x?: string) => { const i = req.itemIds.indexOf(x ?? ''); return i >= 0 ? `${req.ticket}-${i + 1}` : req.ticket; };
  const st = ticketStatus(its);
  const changes = (req.events ?? []).filter((e) => e.what !== 'Logged');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 0 8px' }}>
        <span className={`room ${req.vip ? 'vip' : ''}`} style={{ minWidth: '4.2rem', height: '3.4rem', fontSize: '1.6rem' }} aria-hidden="true">{req.room}</span>
        <div style={{ minWidth: 0 }}>
          <h2 className="t-title2">{req.ticket} · Room {req.room}</h2>
          <p className="t-sub c2" style={{ margin: 0 }}>Logged {ago(now - req.createdAt)} ago</p>
        </div>
        {req.vip && <Pill tone="gold">VIP</Pill>}
      </div>

      <div className="rq-sec">
        <h3 className="group-title">Ticket</h3>
        {!deskOnly && <Button size="sm" variant="gray" onClick={() => setEdit(true)} aria-label={`Edit ticket ${req.ticket}`}>Edit</Button>}
      </div>
      <div className="group">
        <dl className="rq-facts">
          <div><dt>Ticket</dt><dd>{req.ticket}</dd></div>
          <div><dt>Room</dt><dd>{req.room}</dd></div>
          <div><dt>Requested by</dt><dd>{req.source === 'staff_request' ? `Staff: ${req.staffName ?? ''}` : 'Guest'}</dd></div>
          <div><dt>HDO</dt><dd>{personName({ staff }, req.hdo) || <span className="c2">Not set</span>}</dd></div>
          <div><dt>Created</dt><dd>{hotelTime(req.createdAt)}</dd></div>
          <div><dt>Status</dt><dd>{req.incomplete && !its.length ? 'Finish logging' : STATUS_LINE[st]}</dd></div>
        </dl>
        {req.remarks && <p className="rq-remark">“{req.remarks}”</p>}
        <History events={changes} label="Ticket changes" all />
      </div>

      {req.incomplete && its.length === 0 && (
        <>
          <h3 className="group-title">Finish logging</h3>
          <div className="group">
            <p className="t-foot c2" style={{ margin: 0, padding: '10px 16px 0' }}>You saved this room first. Add what they need.</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {activeOf(types).map((p) => (
                <button key={p.key} type="button" className="chip" aria-pressed={pick.includes(p.key)} onClick={() => setPick((x) => (x.includes(p.key) ? x.filter((k) => k !== p.key) : [...x, p.key]))}>
                  <Icon name={p.icon} size={16} /> {p.label}
                </button>
              ))}
            </div>
            <div className="row">
              <Button block feel="success" disabled={!pick.length} onClick={() => { completeRequest(req.id, pick); setPick([]); }}>Add to ticket</Button>
            </div>
          </div>
        </>
      )}

      {its.length > 0 && (
        <>
          <h3 className="group-title">Items ({its.length})</h3>
          <div className="group">
            {its.map((it, i) => <ItemCard key={it.id} it={it} code={`${req.ticket}-${i + 1}`} codeOf={codeOf} />)}
          </div>
        </>
      )}
      <EditTicketDialog req={req} open={edit} onClose={() => setEdit(false)} />
    </div>
  );
}
