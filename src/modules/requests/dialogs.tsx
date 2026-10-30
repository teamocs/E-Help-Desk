import { useState } from 'react';
import { activeDepartments, activeOf, deptLabel } from '../../domain/catalog';
import { editItem, editRequest, handOff, hold, toast, transfer, useApp } from '../../domain/store';
import type { Item, Request } from '../../domain/types';
import { Button, Switch } from '../../ui/kit';
import { NAME_MAX, NOTE_MAX, QTY_MAX, ROOM_MAX, type Source } from './commands';
import { Dialog, Field, deptStaff, hdoChoices } from './ui';

/* ---------- hold: the hotel's coded reasons (the clock pauses) ---------- */

export function HoldDialog({ item, onClose }: { item?: Item; onClose: () => void }) {
  const all = useApp((s) => s.catalog.holdReasons);
  const reasons = activeOf(all);
  return (
    <Dialog open={!!item} title={item ? `Hold: ${item.name}` : 'Hold'} onClose={onClose}>
      <p className="t-sub c2" style={{ marginTop: 0 }}>Why is it waiting? Its clock stops until someone resumes it.</p>
      <div className="rq-acts-wrap" role="group" aria-label="Reason for hold">
        {reasons.map((r) => (
          <button key={r.key} type="button" className="chip" onClick={() => { if (item) hold(item.id, r.key); onClose(); }}>{r.label}</button>
        ))}
        {!reasons.length && <p className="c2">No hold reasons yet. A manager adds them in Configuration, Lists.</p>}
      </div>
    </Dialog>
  );
}

/* ---------- Edit ticket ---------- */

export function EditTicketDialog({ req, open, onClose }: { req: Request; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title={`Edit ${req.ticket}`} onClose={onClose}>
      {open && <EditTicketForm req={req} onClose={onClose} />}
    </Dialog>
  );
}

function EditTicketForm({ req, onClose }: { req: Request; onClose: () => void }) {
  const staff = useApp((s) => s.staff);
  const [room, setRoom] = useState(req.room);
  const [source, setSource] = useState<Source>(req.source === 'staff_request' ? 'staff_request' : 'guest');
  const [name, setName] = useState(req.staffName ?? '');
  const [hdo, setHdo] = useState(req.hdo ?? '');
  const [vip, setVip] = useState(!!req.vip);
  const [remarks, setRemarks] = useState(req.remarks ?? '');
  const [err, setErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const hdos = hdoChoices(staff);
  const legacy = req.source === 'staff';

  const save = () => {
    const e: Record<string, string> = {};
    if (!room.trim()) e.room = 'Enter the room.';
    else if (room.trim().length > ROOM_MAX) e.room = `Keep the room under ${ROOM_MAX} characters.`;
    if (source === 'staff_request' && !name.trim()) e.name = "Enter the staff member's name.";
    setErr(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    // A pre-wave-2 ticket ('staff') keeps its value unless someone picks Staff request.
    const changed = editRequest(req.id, { room, vip, remarks, hdo: hdo || undefined, ...(legacy && source === 'guest' ? {} : { source, staffName: name }) });
    toast(changed ? `${req.ticket} saved. The change is in its history.` : 'Nothing changed.', changed ? 'success' : 'info');
    onClose();
  };

  return (
    <form className="rq-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
      <div className="rq-grid2">
        <Field label="Room" error={err.room}>{(a) => <input className="field" {...a} value={room} onChange={(e) => setRoom(e.target.value)} autoComplete="off" data-autofocus />}</Field>
        <Field label="Requested by">{(a) => (
          <select className="field" {...a} value={source} onChange={(e) => setSource(e.target.value as Source)}>
            <option value="guest">Guest request</option>
            <option value="staff_request">Staff request</option>
          </select>
        )}</Field>
      </div>
      {source === 'staff_request' && (
        <Field label="Staff name (Last, First)" error={err.name}>{(a) => <input className="field" {...a} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Dela Cruz, Maria" list="rq-staff-names" />}</Field>
      )}
      <datalist id="rq-staff-names">{staff.filter((p) => p.id !== 'member').map((p) => <option key={p.id} value={p.name} />)}</datalist>
      <Field label="HDO (help-desk officer)">{(a) => (
        <select className="field" {...a} value={hdo} onChange={(e) => setHdo(e.target.value)}>
          {!hdo && <option value="">Not set</option>}
          {hdo && !hdos.some((p) => p.id === hdo) && <option value={hdo}>{staff.find((p) => p.id === hdo)?.name ?? 'Someone removed'}</option>}
          {hdos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}</Field>
      <div className="row" style={{ padding: 0, minHeight: 0 }}>
        <span className="grow"><span className="field-label" id="rq-vip-l">VIP guest</span></span>
        <Switch checked={vip} onChange={setVip} label="VIP guest" />
      </div>
      <Field label="Remarks">{(a) => <textarea className="field" {...a} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />}</Field>
      <div className="rq-foot">
        <Button variant="gray" onClick={onClose}>Cancel</Button>
        <Button feel="success" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </form>
  );
}

/* ---------- Edit item ---------- */

export function EditItemDialog({ item, code, onClose }: { item?: Item; code: string; onClose: () => void }) {
  return (
    <Dialog open={!!item} title={item ? `Edit ${code}` : 'Edit item'} onClose={onClose}>
      {item && <EditItemForm item={item} onClose={onClose} />}
    </Dialog>
  );
}

const OPEN = ['new', 'relayed', 'on_site', 'on_hold'];

function EditItemForm({ item, onClose }: { item: Item; onClose: () => void }) {
  const staff = useApp((s) => s.staff);
  const cat = useApp((s) => s.catalog);
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(String(item.qty));
  const [dept, setDept] = useState(item.dept);
  const [who, setWho] = useState(item.assignee ?? '');
  const [remarks, setRemarks] = useState(item.remarks ?? '');
  const [err, setErr] = useState<Record<string, string>>({});
  const canMove = item.status === 'new';
  const canAssign = OPEN.includes(item.status);
  const people = deptStaff(staff, dept);
  const types = cat.requestTypes.filter((p) => p.active && p.dept === dept);

  const save = () => {
    const e: Record<string, string> = {};
    const n = Number(qty);
    if (!name.trim()) e.name = 'Describe the item.';
    if (!Number.isInteger(n) || n < 1 || n > QTY_MAX) e.qty = `Enter a quantity from 1 to ${QTY_MAX}.`;
    setErr(e);
    if (Object.keys(e).length) return;
    const changed = editItem(item.id, { name, qty: n, dept, remarks, ...(canAssign ? { assignee: who || null } : {}) });
    toast(changed ? 'Item saved. The change is in its history.' : 'Nothing changed.', changed ? 'success' : 'info');
    onClose();
  };

  return (
    <form className="rq-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
      <div className="rq-grid2">
        <Field label="Department" help={canMove ? undefined : 'Started items move with Transfer, so the trail stays.'}>{(a) => (
          <select className="field" {...a} value={dept} disabled={!canMove} onChange={(e) => { setDept(e.target.value); setWho(''); }}>
            {!activeDepartments(cat).some((d) => d.key === dept) && <option value={dept}>{deptLabel(dept, cat)}</option>}
            {activeDepartments(cat).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        )}</Field>
        <Field label="Item" error={err.name}>{(a) => (
          <>
            <input className="field" {...a} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} list="rq-edit-types" data-autofocus />
            <datalist id="rq-edit-types">{types.map((p) => <option key={p.key} value={p.label} />)}</datalist>
          </>
        )}</Field>
        <Field label="Quantity" error={err.qty}>{(a) => <input className="field" {...a} type="number" inputMode="numeric" min={1} max={QTY_MAX} value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
        <Field label="Assigned to" help={canAssign ? undefined : 'Only open items can be assigned.'}>{(a) => (
          <select className="field" {...a} value={who} disabled={!canAssign} onChange={(e) => setWho(e.target.value)}>
            <option value="">Department queue (nobody yet)</option>
            {who && !people.some((p) => p.id === who) && <option value={who}>{staff.find((p) => p.id === who)?.name ?? 'Someone removed'}</option>}
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.onShift ? '' : ' (off shift)'}</option>)}
          </select>
        )}</Field>
      </div>
      <Field label="Remarks">{(a) => <textarea className="field" {...a} rows={2} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />}</Field>
      <div className="rq-foot">
        <Button variant="gray" onClick={onClose}>Cancel</Button>
        <Button feel="success" onClick={save}>Save changes</Button>
      </div>
    </form>
  );
}

/* ---------- inline forms in the drawer: Transfer (open items) and Hand Off (done items) ---------- */

export function TransferForm({ item, onDone }: { item: Item; onDone: () => void }) {
  const cat = useApp((s) => s.catalog);
  const staff = useApp((s) => s.staff);
  const [dept, setDept] = useState('');
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const go = () => {
    if (!dept) return setErr('Choose the department that takes it over.');
    transfer(item.id, dept, { note, assignee: who || undefined });
    toast(`Transferred to ${deptLabel(dept, cat)}.`, 'success');
    onDone();
  };
  return (
    <div className="rq-inline" role="group" aria-label={`Transfer ${item.name}`}>
      <div className="grid2">
        <Field label="To department" error={err}>{(a) => (
          <select className="field" {...a} value={dept} onChange={(e) => { setDept(e.target.value); setWho(''); setErr(''); }} data-autofocus>
            <option value="">Choose…</option>
            {activeDepartments(cat).filter((d) => d.key !== item.dept).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        )}</Field>
        <Field label="Person (optional)">{(a) => (
          <select className="field" {...a} value={who} disabled={!dept} onChange={(e) => setWho(e.target.value)}>
            <option value="">Department queue</option>
            {deptStaff(staff, dept).map((p) => <option key={p.id} value={p.id}>{p.name}{p.onShift ? '' : ' (off shift)'}</option>)}
          </select>
        )}</Field>
      </div>
      <Field label="Reason (optional)">{(a) => <input className="field" {...a} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Needs a ladder" />}</Field>
      <div className="rq-inline-acts">
        <Button size="sm" feel="medium" onClick={go}>Transfer</Button>
        <Button size="sm" variant="gray" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

export function HandOffForm({ item, onDone }: { item: Item; onDone: () => void }) {
  const cat = useApp((s) => s.catalog);
  const staff = useApp((s) => s.staff);
  const [dept, setDept] = useState('');
  const [name, setName] = useState('');
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const types = cat.requestTypes.filter((p) => p.active && p.dept === dept);
  const go = () => {
    if (!dept) return setErr('Choose who takes the follow-up.');
    if (!handOff(item.id, { dept, name: name || undefined, assignee: who || undefined, note })) return setErr('Only a done item can be handed off.');
    toast(`Handed off to ${deptLabel(dept, cat)}. A follow-up item was added.`, 'success');
    onDone();
  };
  return (
    <div className="rq-inline" role="group" aria-label={`Hand off ${item.name}`}>
      <p className="t-foot c2" style={{ margin: 0 }}>Adds a follow-up item for another team or person. This item stays done.</p>
      <div className="grid2">
        <Field label="Department" error={err}>{(a) => (
          <select className="field" {...a} value={dept} onChange={(e) => { setDept(e.target.value); setWho(''); setErr(''); }} data-autofocus>
            <option value="">Choose…</option>
            {activeDepartments(cat).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        )}</Field>
        <Field label="Item">{(a) => (
          <select className="field" {...a} value={name} onChange={(e) => setName(e.target.value)}>
            <option value="">Same: {item.name}</option>
            {types.filter((p) => p.label !== item.name).map((p) => <option key={p.key} value={p.label}>{p.label}</option>)}
          </select>
        )}</Field>
        <Field label="Person (optional)">{(a) => (
          <select className="field" {...a} value={who} disabled={!dept} onChange={(e) => setWho(e.target.value)}>
            <option value="">Department queue</option>
            {deptStaff(staff, dept).map((p) => <option key={p.id} value={p.id}>{p.name}{p.onShift ? '' : ' (off shift)'}</option>)}
          </select>
        )}</Field>
      </div>
      <Field label="Note (optional)">{(a) => <input className="field" {...a} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Guest asks for a second set tonight" />}</Field>
      <div className="rq-inline-acts">
        <Button size="sm" feel="success" onClick={go}>Hand off</Button>
        <Button size="sm" variant="gray" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
