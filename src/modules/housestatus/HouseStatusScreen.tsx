import { useRef, useState } from 'react';
import { myStaff, toast, useApp } from '../../domain/store';
import { Button, Empty, Pill, Screen } from '../../ui/kit';
import { Sheet } from '../../ui/sheet';
import { FILTERS, STATUS_LABEL, checkClose, checkLog, checkUpdate, clean, closeHouse, editHouse, isNotClosed, logHouse, logsOf, reopenHouse, updateHouse, visible, type Filter, type HsLog, type HsStatus, type Problems } from './model';
import { Field, nameOf, useModuleLevel } from './shared';
import { stamp } from './time';
import './housestatus.css';

type Dialog = { kind: 'new' } | { kind: 'update' | 'close' | 'edit'; log: HsLog } | null;
const TONE = { monitoring: 'accent', pending: 'warn', closed: 'ok' } as const;

export function HouseStatusScreen() {
  const logs = useApp(logsOf);
  const staff = useApp((s) => s.staff);
  const level = useModuleLevel('housestatus');
  const [filter, setFilter] = useState<Filter>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const canChange = level === 'full' || level === 'own';
  const open = logs.filter(isNotClosed).length;
  const shown = visible(logs, filter);
  const count = (f: Filter) => visible(logs, f).length;

  return (
    <Screen title="House Status" subtitle={logs.length ? `Incident logs · ${open} not closed` : 'Incident logs'}>
      <div className="modbar" role="group" aria-label="House Status actions and filter">
        {canChange && <Button size="sm" icon="plus" onClick={() => setDialog({ kind: 'new' })}>New Log</Button>}
        {logs.length > 0 && (
          <span className="hs-filters" role="group" aria-label="Show">
            {FILTERS.map((f) => <button key={f.value} type="button" className="chip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>{f.label} <span className="tnum">{count(f.value)}</span></button>)}
          </span>
        )}
      </div>
      {!canChange && <p className="t-foot c2" style={{ margin: '8px 4px 0' }}>You can read House Status. The help desk and managers add updates.</p>}

      {logs.length === 0 ? (
        <Empty icon="note" text="No house status logs. Log a building-wide condition, like low water pressure or an outage, and add updates until it is closed." action={canChange ? 'New Log' : undefined} onAction={() => setDialog({ kind: 'new' })} />
      ) : shown.length === 0 ? (
        <Empty icon="note" text={filter === 'closed' ? 'No closed logs in the last 30 days.' : 'Nothing is open. Every log is closed.'} />
      ) : (
        <ul className="cards hs-list" role="list">
          {shown.map((l) => (
            <li key={l.id}>
              <Card log={l} by={nameOf(l.loggedBy || undefined, staff)} staff={staff} canChange={canChange} onDialog={(kind) => setDialog({ kind, log: l })} />
            </li>
          ))}
        </ul>
      )}
      <HsDialog dialog={dialog} onClose={() => setDialog(null)} />
    </Screen>
  );
}

function Card({ log: l, by, staff, canChange, onDialog }: { log: HsLog; by: string; staff: { id: string; name: string }[]; canChange: boolean; onDialog: (k: 'update' | 'close' | 'edit') => void }) {
  const saving = l.no === '';
  const label = (a: string) => `${a} ${l.no || 'new log'}`;
  return (
    <article className={`hs-card ${l.status}`} aria-label={`${l.no || 'New log'}, ${STATUS_LABEL[l.status]}`}>
      <header className="hs-top">
        <h2 className="t-head">{l.no || 'New log'}</h2>
        <Pill tone={TONE[l.status]}>{STATUS_LABEL[l.status]}</Pill>
        {saving && <Pill>Saving</Pill>}
        <time className="t-foot c2 hs-when" dateTime={new Date(l.createdAt).toISOString()}>{stamp(l.createdAt)}</time>
      </header>
      <p className="t-body hs-narr">{l.narration}</p>
      <p className="t-foot c2">By {by}</p>
      {l.updates.length > 0 && (
        <ol className="hs-updates" aria-label={`Updates for ${l.no || 'this log'}`}>
          {l.updates.map((u, i) => (
            <li key={i}><span className="c2">{stamp(u.at)} · {nameOf(u.by, staff)}:</span> {u.text}</li>
          ))}
        </ol>
      )}
      {canChange && (
        <div className="hs-actions">
          {l.status !== 'closed' && <Button size="sm" variant="tint" aria-label={label('Add an update to')} onClick={() => onDialog('update')}>+ Update</Button>}
          {l.status !== 'closed' && <Button size="sm" variant="gray" aria-label={label('Close')} onClick={() => onDialog('close')}>Close</Button>}
          <Button size="sm" variant="gray" aria-label={label('Edit')} onClick={() => onDialog('edit')}>Edit</Button>
          {l.status === 'closed' && <Button size="sm" variant="bad" aria-label={label('Reopen')} onClick={() => { reopenHouse(l.id); toast(`${l.no} reopened`, 'success'); }}>Reopen</Button>}
        </div>
      )}
    </article>
  );
}

const TITLES = { new: 'New House Status', update: 'Update', close: 'Close Log', edit: 'Edit' } as const;

/** The four forms (the prototype's modals) as one sheet: fields by kind, checked before anything is sent. */
function HsDialog({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  const kind = dialog?.kind;
  const log = dialog && dialog.kind !== 'new' ? dialog.log : undefined;
  return (
    <Sheet open={!!dialog} onClose={onClose} title={kind ? (log ? `${TITLES[kind]} ${log.no}`.trim() : TITLES[kind]) : ''}>
      {dialog && <HsForm key={`${dialog.kind}-${log?.id ?? ''}`} kind={dialog.kind} log={log} onClose={onClose} />}
    </Sheet>
  );
}

function HsForm({ kind, log, onClose }: { kind: 'new' | 'update' | 'close' | 'edit'; log?: HsLog; onClose: () => void }) {
  const me = useApp(myStaff);
  const [narration, setNarration] = useState(log?.narration ?? '');
  const [status, setStatus] = useState<HsStatus>(log?.status ?? 'monitoring');
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<Problems>({});
  const form = useRef<HTMLDivElement>(null);

  const submit = () => {
    const found = kind === 'new' || kind === 'edit' ? checkLog({ narration }) : kind === 'update' ? checkUpdate({ text }) : checkClose({ note: text });
    setProblems(found);
    if (!clean(found)) return requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    if (kind === 'new') { logHouse({ narration, status: status === 'pending' ? 'pending' : 'monitoring' }); toast('Logged', 'success'); }
    else if (log && kind === 'update') { updateHouse(log.id, text); toast('Update added', 'success'); }
    else if (log && kind === 'close') { closeHouse(log.id, text); toast('Closed', 'success'); }
    else if (log) {
      if (narration.trim() === log.narration && status === log.status) { onClose(); return; }
      editHouse(log.id, { narration, status });
      toast('Saved', 'success');
    }
    onClose();
  };
  const err = (k: keyof Problems) => problems[k];
  return (
    <div ref={form}>
      {(kind === 'new' || kind === 'edit') && (
        <>
          <Field label="Incident Narration" required error={err('narration')}>
            {(p) => <textarea {...p} className="field" rows={4} data-autofocus value={narration} onChange={(e) => setNarration(e.target.value)} />}
          </Field>
          <Field label="Status">
            {(p) => (
              <select {...p} className="field" value={status} onChange={(e) => setStatus(e.target.value as HsStatus)}>
                <option value="monitoring">Monitoring</option>
                <option value="pending">Pending</option>
                {kind === 'edit' && <option value="closed">Closed</option>}
              </select>
            )}
          </Field>
          {kind === 'new' && <p className="field-help">Logged by {me?.name ?? 'you'}.</p>}
        </>
      )}
      {kind === 'update' && (
        <Field label="Update" required error={err('text')} help={`Added to ${log?.no} by ${me?.name ?? 'you'}.`}>
          {(p) => <textarea {...p} className="field" rows={3} data-autofocus value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      )}
      {kind === 'close' && (
        <Field label="Closing note" error={err('note')} help="Optional. It is added to the log's updates.">
          {(p) => <textarea {...p} className="field" rows={3} data-autofocus value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      )}
      <div className="hs-foot">
        <Button variant="gray" onClick={onClose}>Cancel</Button>
        <Button feel="success" onClick={submit}>{kind === 'new' ? 'Log' : kind === 'update' ? 'Add update' : kind === 'close' ? 'Close' : 'Save'}</Button>
      </div>
    </div>
  );
}
