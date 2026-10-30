import { useId, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { activeDepartments, activeOf, deptLabel, type Catalog } from '../domain/catalog';
import { HAZARDS, detectSafety } from '../domain/rules';
import { logRequest, raiseSafety, setUI, toast, ui, useApp, useUI } from '../domain/store';
import { haptic, tone } from '../lib/haptics';
import { springs } from '../lib/motion';
import { Button, Icon, Switch } from '../ui/kit';
import { Sheet } from '../ui/sheet';
import { NAME_MAX, QTY_MAX, ROOM_MAX, type NewRow, type Source } from '../modules/requests/commands';
import { Field, deptStaff, hdoChoices } from '../modules/requests/ui';

/** One item row of the form: a request type, or "Other" (free text with a department). */
interface Draft { key: number; type?: string; other?: string; dept?: string; text: string; qty: string; assignee: string }
const OTHER = '__other';
let keys = 0;
const blank = (type?: string): Draft => ({ key: ++keys, type, text: '', qty: '1', assignee: '' });

/** Type-to-search across every active request type ("Item — Department"), with "Other (not listed)" last. */
function ItemPicker({ row, cat, error, onPick, inputProps }: { row: Draft; cat: Catalog; error?: string; onPick: (type: string | typeof OTHER, typed: string) => void; inputProps: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string } }) {
  const types = useMemo(() => activeOf(cat.requestTypes), [cat]);
  const chosen = row.type ? types.find((t) => t.key === row.type)?.label ?? '' : row.dept !== undefined || row.other !== undefined ? 'Other (not listed)' : '';
  const [q, setQ] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const list = `${inputProps.id}-list`;
  const text = q ?? chosen;
  const hits = (q ? types.filter((t) => `${t.label} ${deptLabel(t.dept, cat)}`.toLowerCase().includes(q.toLowerCase())) : types).slice(0, 40);
  const opts: { key: string; label: string; dept?: string }[] = [...hits.map((t) => ({ key: t.key, label: t.label, dept: deptLabel(t.dept, cat) })), { key: OTHER, label: 'Other (not listed)' }];
  const open = q !== null;
  const pick = (k: string) => { onPick(k, (q ?? '').trim()); setQ(null); haptic('select'); };
  return (
    <div className="rq-combo">
      <input
        className="field"
        {...inputProps}
        role="combobox"
        aria-expanded={open}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${list}-${active}` : undefined}
        value={text}
        placeholder="Type to search…"
        autoComplete="off"
        onFocus={() => { setQ(''); setActive(0); }}
        onBlur={() => setTimeout(() => setQ(null), 120)}
        onChange={(e) => { setQ(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setQ((x) => x ?? ''); setActive((a) => Math.min(opts.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && open) { e.preventDefault(); pick(opts[active].key); }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setQ(null); }
        }}
      />
      {open && (
        <ul className="rq-options" id={list} role="listbox" aria-label="Items">
          {opts.map((o, i) => (
            <li key={o.key} id={`${list}-${i}`} role="option" aria-selected={i === active} className={o.key === OTHER ? 'other' : ''} onMouseDown={(e) => { e.preventDefault(); pick(o.key); }}>
              <span>{o.label}</span>{o.dept && <span>{o.dept}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && <span className="sr">{error}</span>}
    </div>
  );
}

function Body() {
  const seed = useUI((s) => s.composerSeed);
  const requests = useApp((s) => s.requests);
  const catalog = useApp((s) => s.catalog);
  const staff = useApp((s) => s.staff);
  const meId = useApp((s) => s.me);
  const me = staff.find((p) => p.id === meId && p.id !== 'member');
  const bundles = useMemo(() => activeOf(catalog.bundles), [catalog]);
  const depts = activeDepartments(catalog);
  // The rooms of the latest tickets, newest first, for one-tap repeat requests.
  const recent = useMemo(() => [...new Set([...requests].sort((a, b) => b.createdAt - a.createdAt).map((r) => r.room))].slice(0, 5), [requests]);
  const hdos = hdoChoices(staff);
  const [source, setSource] = useState<Source>('guest');
  const [room, setRoom] = useState(seed?.room ?? '');
  const [staffName, setStaffName] = useState('');
  const [hdo, setHdo] = useState(me?.id ?? hdos[0]?.id ?? '');
  const [vip, setVip] = useState(false);
  const [rows, setRows] = useState<Draft[]>(() => [blank(seed?.preset && catalog.requestTypes.some((t) => t.key === seed.preset && t.active) ? seed.preset : undefined)]);
  const [bundle, setBundle] = useState<string | undefined>();
  const [remarks, setRemarks] = useState(seed?.text ?? '');
  const [err, setErr] = useState<Record<string, string>>({});
  const roomId = useId();

  const hazard = useMemo(() => detectSafety([remarks, ...rows.map((r) => r.text)].join(' \n ')), [remarks, rows]);
  const patch = (key: number, p: Partial<Draft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const deptOf = (r: Draft) => (r.type ? catalog.requestTypes.find((t) => t.key === r.type)?.dept : r.dept);
  const isOther = (r: Draft) => !r.type && r.dept !== undefined;
  const started = (r: Draft) => !!r.type || isOther(r);

  /** Valid rows as the server wants them, or the errors to show. Empty rows are left out (as the prototype drops them). */
  const check = (later: boolean) => {
    const e: Record<string, string> = {};
    const out: NewRow[] = [];
    if (!room.trim()) e.room = 'Enter the room.';
    else if (room.trim().length > ROOM_MAX) e.room = `Keep the room under ${ROOM_MAX} characters.`;
    if (!later && source === 'staff_request' && !staffName.trim()) e.staffName = "Enter the staff member's name.";
    if (!later) {
      for (const r of rows.filter(started)) {
        const qty = Number(r.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > QTY_MAX) e[`qty${r.key}`] = `1 to ${QTY_MAX}.`;
        if (isOther(r) && !r.dept) e[`dept${r.key}`] = 'Choose a department.';
        if (isOther(r) && !r.text.trim()) e[`text${r.key}`] = 'Describe the item.';
        out.push(r.type ? { type: r.type, qty, ...(r.assignee ? { assignee: r.assignee } : {}) } : { other: r.text.trim(), dept: r.dept, qty, ...(r.assignee ? { assignee: r.assignee } : {}) });
      }
      if (!out.length && !bundle) e.items = 'Add at least one item, or use Log it later.';
    }
    return { e, out };
  };

  const finish = (later: boolean) => {
    const { e, out } = check(later);
    setErr(e);
    if (Object.keys(e).length) {
      haptic('warning');
      // Take the person to the first problem (screen readers then read its message).
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.sheet [aria-invalid="true"]')?.focus());
      return;
    }
    logRequest({
      room: room.trim(), rows: later ? [] : out, bundle: later ? undefined : bundle, remarks: remarks.trim() || undefined, later, vip,
      source, staffName: source === 'staff_request' ? staffName : undefined, hdo: hdo || undefined,
    });
    haptic('success');
    tone('success');
    toast(later ? `Room ${room.trim()} saved. Add what they need from the ticket.` : `Room ${room.trim()} logged and sent to the right teams.`, 'success');
    setUI({ sheet: null, selItem: undefined });
  };

  const raise = () => {
    if (!hazard) return;
    const r = raiseSafety(room.trim() || '—', [remarks, ...rows.map((x) => x.text)].filter(Boolean).join(' · '), hazard);
    setUI({ sheet: 'safety', focusSafetyId: r.id });
  };

  return (
    <form className="rq-form" onSubmit={(e) => { e.preventDefault(); finish(false); }} noValidate>
      <div className="rq-grid2">
        <Field label="Requested by">{(a) => (
          <select className="field" {...a} value={source} onChange={(e) => setSource(e.target.value as Source)}>
            <option value="guest">Guest request</option>
            <option value="staff_request">Staff request</option>
          </select>
        )}</Field>
        <div className="rq-field">
          <label className="field-label" htmlFor={roomId}>Room</label>
          <input id={roomId} className="field" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="412" autoComplete="off" inputMode="text" data-autofocus
            aria-invalid={err.room ? true : undefined} aria-describedby={err.room ? `${roomId}-e` : undefined} />
          {err.room && <p className="rq-err" id={`${roomId}-e`} role="alert">{err.room}</p>}
          {recent.length > 0 && (
            <div className="rq-quick" style={{ marginTop: 6 }} role="group" aria-label="Recent rooms">
              {recent.map((r) => <button key={r} type="button" className="chip" aria-pressed={room === r} onClick={() => { haptic('select'); setRoom(r); }}>{r}</button>)}
            </div>
          )}
        </div>
      </div>
      <div className="rq-grid2">
        {source === 'staff_request' && (
          <Field label="Staff name (Last, First)" error={err.staffName}>{(a) => <input className="field" {...a} value={staffName} maxLength={NAME_MAX} onChange={(e) => setStaffName(e.target.value)} placeholder="Dela Cruz, Maria" list="rq-new-staff" />}</Field>
        )}
        <datalist id="rq-new-staff">{staff.filter((p) => p.id !== 'member').map((p) => <option key={p.id} value={p.name} />)}</datalist>
        <Field label="HDO (help-desk officer)" help="Who handles the ticket at the desk. You, by default.">{(a) => (
          <select className="field" {...a} value={hdo} onChange={(e) => setHdo(e.target.value)}>
            {!hdo && <option value="">Not set</option>}
            {me && !hdos.some((p) => p.id === me.id) && <option value={me.id}>{me.name} (you)</option>}
            {hdos.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === me?.id ? ' (you)' : ''}</option>)}
          </select>
        )}</Field>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="field-label">Items</legend>
        <ol className="rq-rows">
          {rows.map((r, i) => {
            const dept = deptOf(r);
            const people = deptStaff(staff, dept);
            return (
              <li key={r.key} className="rq-row">
                <div className="rq-row-head">
                  <span>Item {i + 1}</span>
                  {rows.length > 1 && <button type="button" className="iconbtn" aria-label={`Remove item ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Icon name="x" size={18} /></button>}
                </div>
                <div className="rq-row-grid">
                  <Field label="Item (type to search)">{(a) => (
                    <ItemPicker row={r} cat={catalog} inputProps={a} onPick={(k, typed) => patch(r.key, k === OTHER ? { type: undefined, dept: r.dept ?? '', assignee: '', text: r.text || typed } : { type: k, dept: undefined, assignee: '' })} />
                  )}</Field>
                  {isOther(r) ? (
                    <Field label="Department" error={err[`dept${r.key}`]}>{(a) => (
                      <select className="field" {...a} value={r.dept} onChange={(e) => patch(r.key, { dept: e.target.value, assignee: '' })}>
                        <option value="">Choose…</option>
                        {depts.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                      </select>
                    )}</Field>
                  ) : (
                    <div className="rq-field"><span className="field-label">Department</span><span className="rq-readonly">{dept ? deptLabel(dept, catalog) : 'From the item'}</span></div>
                  )}
                  <Field label="Qty" error={err[`qty${r.key}`]}>{(a) => (
                    <div className="rq-qty">
                      <button type="button" aria-label="One less" disabled={Number(r.qty) <= 1} onClick={() => patch(r.key, { qty: String(Math.max(1, Number(r.qty) - 1)) })}>−</button>
                      <input {...a} type="number" inputMode="numeric" min={1} max={QTY_MAX} value={r.qty} onChange={(e) => patch(r.key, { qty: e.target.value })} />
                      <button type="button" aria-label="One more" disabled={Number(r.qty) >= QTY_MAX} onClick={() => patch(r.key, { qty: String(Math.min(QTY_MAX, (Number(r.qty) || 0) + 1)) })}>+</button>
                    </div>
                  )}</Field>
                  <Field label="Assign">{(a) => (
                    <select className="field" {...a} value={r.assignee} disabled={!dept} onChange={(e) => patch(r.key, { assignee: e.target.value })}>
                      <option value="">{dept ? 'Department queue' : 'Pick the item first'}</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.onShift ? '' : ' (off shift)'}</option>)}
                    </select>
                  )}</Field>
                </div>
                {isOther(r) && (
                  <Field label="Describe the item" error={err[`text${r.key}`]}>{(a) => <input className="field" {...a} value={r.text} maxLength={NAME_MAX} onChange={(e) => patch(r.key, { text: e.target.value })} placeholder="e.g. Extra hangers" />}</Field>
                )}
              </li>
            );
          })}
        </ol>
        <div className="rq-quick" style={{ marginTop: 10 }}>
          <Button size="sm" variant="tint" icon="plus" onClick={() => setRows((rs) => [...rs, blank()])}>Add item</Button>
          {bundles.map((b) => (
            <button key={b.key} type="button" className="chip" aria-pressed={bundle === b.key} title={b.hint} onClick={() => { haptic('medium'); setBundle(bundle === b.key ? undefined : b.key); }}>
              <Icon name="bolt" size={16} weight="fill" /> {b.label} bundle
            </button>
          ))}
        </div>
        {bundle && <p className="field-help">{bundles.find((b) => b.key === bundle)?.hint} Later steps wait until the earlier ones are done.</p>}
        {err.items && <p className="rq-err" role="alert">{err.items}</p>}
      </fieldset>

      <Field label="Remarks (optional)" help="Safety words in English, Tagalog and Bikol are checked on this device, with or without internet.">{(a) => (
        <textarea className="field" {...a} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add detail only if it helps." />
      )}</Field>
      <div className="row" style={{ padding: 0, minHeight: 0 }}>
        <span className="grow field-label" style={{ margin: 0 }}>VIP guest</span>
        <Switch checked={vip} onChange={setVip} label="VIP guest" />
      </div>

      <AnimatePresence>
        {hazard && (
          <motion.div initial={{ opacity: 0, y: 10, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={springs.snappy} style={{ overflow: 'hidden' }} role="alert">
            <div className="banner bad">
              <Icon name="siren" weight="fill" />
              <div>
                <b>Possible safety issue: {HAZARDS[hazard].label.toLowerCase()}.</b>
                <p className="t-sub" style={{ margin: '4px 0 0' }}>CALL 911 / RADIO FIRST, THEN LOG. {HAZARDS[hazard].call}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <Button variant="fill" feel="error" onClick={raise}>Raise safety alert</Button>
                  <Button variant="gray" onClick={() => { setRemarks(''); setRows((rs) => rs.map((r) => ({ ...r, text: '' }))); }}>False alarm, clear</Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rq-foot">
        <Button variant="gray" disabled={!room.trim()} onClick={() => finish(true)}>Log it later (room only)</Button>
        <Button feel="success" disabled={!!hazard} onClick={() => finish(false)}>Create request</Button>
      </div>
    </form>
  );
}

export function Composer() {
  const open = useUI((s) => s.sheet === 'composer');
  return (
    <Sheet open={open} title="New request" onClose={() => ui.set((s) => ({ ...s, sheet: null }))}>
      <Body />
    </Sheet>
  );
}
