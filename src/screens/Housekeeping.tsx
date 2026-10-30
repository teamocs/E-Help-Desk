// Cleaning (sidebar id cleaning), the client prototype's module 4 (docs/MODULES-SPEC.md A.6): the table with
// filters, "+ Log Cleaning", "Schedule Rooms", clock in and out with the duration, and Edit. Data and actions are in
// src/modules/cleaning/model.ts; the checkout rule of today (a finished checkout or inspection readies the room) stays.
import { useMemo, useState, type ReactNode } from 'react';
import { cleanSet, toast, useApp } from '../domain/store';
import type { Staff } from '../domain/types';
import { Button, Empty, Icon, Pill, Screen, useTier } from '../ui/kit';
import { Check, Choice, Field, FormPart, FormSheet, type Errors } from '../modules/workorders/form';
import { nameOf } from '../modules/workorders/forms';
import { dayOf, dayPlus, fmtClock, fmtDay, useLevel } from '../modules/workorders/model';
import {
  CLEAN_LABEL, CLEAN_TABS, CLEAN_TONE, ROLE_LABEL, cleaningTypes, clockIn, clockOut, editClean, filterTasks, fmtMinutes, logClean, minutes, scheduleClean, typeLabel, useTasks,
  type CleanFilter, type Task,
} from '../modules/cleaning/model';

type Open = null | { kind: 'log' } | { kind: 'schedule' } | { kind: 'clockin'; id: string } | { kind: 'edit'; id: string };

/** Room attendants: active Housekeeping staff (the server checks the same). */
const attendantsOf = (staff: Staff[]) => staff.filter((p) => p.id !== 'member' && p.dept === 'housekeeping');
const ROLE_OPTS = [{ value: 'lead', label: 'Lead' }, { value: 'backup', label: 'Backup' }];

export function Housekeeping() {
  const tasks = useTasks();
  const s = useApp((x) => x);
  const level = useLevel('cleaning');
  const tier = useTier();
  const [f, setF] = useState<CleanFilter>('all');
  const [open, setOpen] = useState<Open>(null);
  const list = useMemo(() => filterTasks(tasks, f), [tasks, f]);
  const write = level === 'full' || level === 'own';
  const ras = attendantsOf(s.staff);

  const start = (t: Task) => {
    if (t.assignee) {
      clockIn(t.id);
      toast(`Room ${t.room}: clocked in`, 'success');
    } else setOpen({ kind: 'clockin', id: t.id });
  };
  const finish = (t: Task) => {
    const m = minutes(t, s.now);
    clockOut(t.id);
    toast(`Room ${t.room} done${m != null ? ` in ${fmtMinutes(m)}` : ''}`, 'success');
  };
  const actions = (t: Task): ReactNode[] => {
    const out: ReactNode[] = [];
    if (t.status === 'ready' || t.status === 'queued') out.push(<Button key="in" size="sm" variant="tint" aria-label={`Clock in room ${t.room}`} onClick={() => start(t)}>Clock In</Button>);
    if (t.status === 'in_progress') out.push(<Button key="out" size="sm" className="btn-ok" aria-label={`Clock out room ${t.room}`} onClick={() => finish(t)}>Clock Out</Button>);
    if (t.status === 'scheduled' || t.status === 'queued') out.push(<Button key="ready" size="sm" variant="gray" aria-label={`Mark room ${t.room} ready`} onClick={() => { cleanSet(t.id, 'ready'); toast(`Room ${t.room} is ready`, 'success'); }}>Mark ready</Button>);
    out.push(<Button key="edit" size="sm" variant="gray" aria-label={`Edit room ${t.room}`} onClick={() => setOpen({ kind: 'edit', id: t.id })}>Edit</Button>);
    return out;
  };
  const ra = (t: Task) => (t.assignee ? <>{nameOf(s, t.assignee)}{t.role && <span className="c-muted"> ({ROLE_LABEL[t.role]})</span>}</> : <span className="c-muted">—</span>);
  const dur = (t: Task) => {
    const m = minutes(t, s.now);
    return m == null ? <span className="c-muted">—</span> : t.status === 'in_progress' ? <span>{fmtMinutes(m)} <span className="c-muted">so far</span></span> : fmtMinutes(m);
  };
  const status = (t: Task) => <Pill tone={CLEAN_TONE[t.status]}>{CLEAN_LABEL[t.status]}</Pill>;
  const sched = (t: Task) => (t.schedDate == null ? <span className="c-muted">—</span> : <span className="nowrap">{fmtDay(t.schedDate)}</span>);
  const counts = Object.fromEntries(CLEAN_TABS.map((t) => [t.value, filterTasks(tasks, t.value).length]));
  const ready = counts.ready ?? 0;

  return (
    <Screen title="Cleaning" subtitle={`Room cleaning${tasks.length ? ` · ${ready} room${ready === 1 ? '' : 's'} ready` : ''}`}>
      {write && (
        <div className="mx-actions">
          <Button icon="plus" onClick={() => setOpen({ kind: 'log' })}>Log Cleaning</Button>
          <Button variant="tint" icon="clock" onClick={() => setOpen({ kind: 'schedule' })}>Schedule Rooms</Button>
        </div>
      )}
      <div className="banner quiet" style={{ marginTop: '1rem' }}>
        <Icon name="bolt" weight="fill" />
        <span className="t-sub">Finish a <b>checkout</b> or <b>inspection</b> item on a ticket and that room turns Ready here by itself.</span>
      </div>

      {tasks.length === 0 ? (
        <Empty icon="broom" text={write ? 'No cleaning tasks right now. Log a clean, or schedule tomorrow’s checkout rooms.' : 'No cleaning tasks right now.'} />
      ) : (
        <>
          <div className="mx-filters">
            <div className="mx-tabs" role="group" aria-label="Filter by status">
              {CLEAN_TABS.map((t) => (
                <button key={t.value} type="button" className="chip" aria-pressed={f === t.value} onClick={() => setF(t.value)}>{t.label} <span className="n">{counts[t.value]}</span></button>
              ))}
            </div>
          </div>
          <p className="mx-count t-sub" role="status" aria-live="polite">{list.length === tasks.length ? `${tasks.length} room${tasks.length === 1 ? '' : 's'}` : `Showing ${list.length} of ${tasks.length}`}</p>
          {list.length === 0 ? (
            <Empty icon="broom" text="No rooms in this state." action="Show all" onAction={() => setF('all')} />
          ) : tier === 'phone' ? (
            <ul className="mx-cards" aria-label="Cleaning tasks">
              {list.map((t) => (
                <li key={t.id} className="mx-card">
                  <div className="mx-card-top"><span className="t-head">Room {t.room} · {typeLabel(t.type, s.catalog)}</span>{status(t)}</div>
                  <dl>
                    <dt>RA</dt><dd>{ra(t)}</dd>
                    <dt>Sched</dt><dd>{sched(t)}</dd>
                    <dt>Clock in</dt><dd>{fmtClock(t.clockIn)}</dd>
                    <dt>Clock out</dt><dd>{fmtClock(t.clockOut)}</dd>
                    <dt>Duration</dt><dd>{dur(t)}</dd>
                  </dl>
                  {write && <div className="act">{actions(t)}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="dt" role="region" aria-label="Cleaning tasks" tabIndex={0}>
              <table>
                <thead><tr>{['Room', 'Type', 'RA', 'Status', 'Sched', 'Clock In', 'Clock Out', 'Duration', ...(write ? ['Action'] : [])].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>
                  {list.map((t) => (
                    <tr key={t.id} style={{ cursor: 'default' }}>
                      <td><b>{t.room}</b></td>
                      <td className="nowrap">{typeLabel(t.type, s.catalog)}</td>
                      <td>{ra(t)}</td>
                      <td>{status(t)}</td>
                      <td>{sched(t)}</td>
                      <td className="nowrap">{fmtClock(t.clockIn)}</td>
                      <td className="nowrap">{fmtClock(t.clockOut)}</td>
                      <td className="nowrap">{dur(t)}</td>
                      {write && <td><div className="act">{actions(t)}</div></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {open?.kind === 'log' && <LogSheet ras={ras} me={s.me} close={() => setOpen(null)} />}
      {open?.kind === 'schedule' && <ScheduleSheet close={() => setOpen(null)} />}
      {open?.kind === 'clockin' && tasks.find((t) => t.id === open.id) && <ClockInSheet t={tasks.find((t) => t.id === open.id)!} ras={ras} me={s.me} close={() => setOpen(null)} />}
      {open?.kind === 'edit' && tasks.find((t) => t.id === open.id) && <EditSheet t={tasks.find((t) => t.id === open.id)!} ras={ras} close={() => setOpen(null)} />}
    </Screen>
  );
}

const firstOf = (ras: Staff[], me: string | null) => (ras.some((p) => p.id === me) ? me! : ras[0]?.id ?? '');
const raOpts = (ras: Staff[], blank: string) => [{ value: '', label: blank }, ...ras.map((p) => ({ value: p.id, label: p.name }))];

function LogSheet({ ras, me, close }: { ras: Staff[]; me: string | null; close: () => void }) {
  const cat = useApp((x) => x.catalog);
  const types = cleaningTypes(cat);
  const [f, setF] = useState({ room: '', type: types[0]?.key ?? '', ra: firstOf(ras, me), role: 'lead' as 'lead' | 'backup', now: true });
  const [err, setErr] = useState<Errors>({});
  const submit = (): Errors => {
    const e: Errors = {
      room: f.room.trim() ? (f.room.trim().length > 40 ? 'Keep the room under 40 characters.' : undefined) : 'Room required.',
      type: f.type ? undefined : 'Choose the cleaning type.',
      ra: f.now && !f.ra ? 'Choose the room attendant who clocks in.' : undefined,
    };
    setErr(e);
    if (Object.values(e).some(Boolean)) return e;
    logClean({ room: f.room.trim(), cleanType: f.type, attendantId: f.ra || undefined, role: f.role, clockIn: f.now });
    toast(f.now ? `Room ${f.room.trim()}: clocked in` : `Room ${f.room.trim()} queued`, 'success');
    close();
    return {};
  };
  return (
    <FormSheet open title="Log Cleaning" onClose={close} submitLabel="Add" submit={submit}>
      <Field label="Room" error={err.room}>{(p) => <input {...p} className="field" inputMode="text" autoComplete="off" maxLength={40} value={f.room} onChange={(e) => setF((x) => ({ ...x, room: e.target.value }))} data-autofocus />}</Field>
      <Field label="Type" error={err.type}>{(p) => <Choice {...p} value={f.type} onChange={(v) => setF((x) => ({ ...x, type: v }))} options={types.map((t) => ({ value: t.key, label: t.label }))} />}</Field>
      <Field label="RA (room attendant)" error={err.ra} help={ras.length ? undefined : 'No Housekeeping staff listed: add them in Configuration, Staff.'}>{(p) => <Choice {...p} value={f.ra} onChange={(v) => setF((x) => ({ ...x, ra: v }))} options={raOpts(ras, '—')} />}</Field>
      <Field label="Role">{(p) => <Choice {...p} value={f.role} onChange={(v) => setF((x) => ({ ...x, role: v as 'lead' | 'backup' }))} options={ROLE_OPTS} />}</Field>
      <Check checked={f.now} onChange={(v) => setF((x) => ({ ...x, now: v }))}>Clock In now</Check>
    </FormSheet>
  );
}

function ScheduleSheet({ close }: { close: () => void }) {
  const cat = useApp((x) => x.catalog);
  const now = useApp((x) => x.now);
  const types = cleaningTypes(cat);
  const [date, setDate] = useState(dayPlus(1));
  const [type, setType] = useState(types.find((t) => t.key === 'checkout')?.key ?? types[0]?.key ?? '');
  const [rooms, setRooms] = useState<{ k: number; v: string }[]>([{ k: 0, v: '' }]);
  const [err, setErr] = useState<Errors>({});
  const submit = (): Errors => {
    const e: Errors = { date: date ? undefined : 'Date required.', type: type ? undefined : 'Choose the cleaning type.' };
    const seen = new Set<string>();
    const filled = rooms.filter((r) => r.v.trim());
    for (const r of filled) {
      const v = r.v.trim().toLowerCase();
      if (v.length > 40) e[`r${r.k}`] = 'Keep the room under 40 characters.';
      else if (seen.has(v)) e[`r${r.k}`] = `Room ${r.v.trim()} is listed twice.`;
      seen.add(v);
    }
    if (!filled.length) e[`r${rooms[0].k}`] = 'Add rooms.';
    if (filled.length > 30) e.date = 'Schedule at most 30 rooms at a time.';
    setErr(e);
    if (Object.values(e).some(Boolean)) return e;
    scheduleClean({ rooms: filled.map((r) => r.v.trim()), date, cleanType: type });
    toast(`${filled.length} scheduled for ${date}`, 'success');
    close();
    return {};
  };
  return (
    <FormSheet open title="Schedule Rooms" onClose={close} submitLabel="Schedule" submit={submit}>
      <Field label="Checkout Date" error={err.date}>{(p) => <input {...p} className="field" type="date" value={date} min={dayOf(now)} onChange={(e) => setDate(e.target.value)} />}</Field>
      <Field label="Type" error={err.type}>{(p) => <Choice {...p} value={type} onChange={setType} options={types.map((t) => ({ value: t.key, label: t.label }))} />}</Field>
      <FormPart>Rooms</FormPart>
      <div className="fm-rooms">
        {rooms.map((r, i) => (
          <div key={r.k} className="fm-room">
            <Field label={`Room ${i + 1}`} error={err[`r${r.k}`]}>{(p) => <input {...p} className="field" autoComplete="off" maxLength={40} value={r.v} onChange={(e) => setRooms((x) => x.map((y) => (y.k === r.k ? { ...y, v: e.target.value } : y)))} {...(i === 0 ? { 'data-autofocus': true } : {})} />}</Field>
            {rooms.length > 1 && <button type="button" className="iconbtn" aria-label={`Remove room ${i + 1}`} onClick={() => setRooms((x) => x.filter((y) => y.k !== r.k))}><Icon name="x" /></button>}
          </div>
        ))}
        <div><Button size="sm" variant="plain" icon="plus" onClick={() => setRooms((x) => [...x, { k: Math.max(...x.map((y) => y.k)) + 1, v: '' }])}>Add room</Button></div>
      </div>
    </FormSheet>
  );
}

function ClockInSheet({ t, ras, me, close }: { t: Task; ras: Staff[]; me: string | null; close: () => void }) {
  const [ra, setRa] = useState(firstOf(ras, me));
  const [role, setRole] = useState<'lead' | 'backup'>(t.role ?? 'lead');
  const [err, setErr] = useState<Errors>({});
  const submit = (): Errors => {
    const e: Errors = { ra: ra ? undefined : 'Choose the room attendant who clocks in.' };
    setErr(e);
    if (e.ra) return e;
    clockIn(t.id, ra, role);
    toast(`Room ${t.room}: clocked in`, 'success');
    close();
    return {};
  };
  return (
    <FormSheet open title={`Clock in room ${t.room}`} onClose={close} submitLabel="Clock In" submit={submit}>
      <Field label="RA (room attendant)" error={err.ra}>{(p) => <Choice {...p} value={ra} onChange={setRa} options={raOpts(ras, 'Choose…')} />}</Field>
      <Field label="Role">{(p) => <Choice {...p} value={role} onChange={(v) => setRole(v as 'lead' | 'backup')} options={ROLE_OPTS} />}</Field>
    </FormSheet>
  );
}

function EditSheet({ t, ras, close }: { t: Task; ras: Staff[]; close: () => void }) {
  const cat = useApp((x) => x.catalog);
  const types = cleaningTypes(cat);
  const start = { room: t.room, type: t.type, ra: t.assignee ?? '', role: t.role ?? 'lead', sched: t.schedDate == null ? '' : dayOf(t.schedDate) };
  const [f, setF] = useState(start);
  const [err, setErr] = useState<Errors>({});
  const typeOpts = [...(types.some((x) => x.key === f.type) ? [] : [{ value: f.type, label: typeLabel(f.type, cat) }]), ...types.map((x) => ({ value: x.key, label: x.label }))];
  const raList = ras.some((p) => p.id === f.ra) || !f.ra ? ras : [...ras, { id: f.ra, name: 'Former staff' } as Staff];
  const submit = (): Errors => {
    const e: Errors = {
      room: f.room.trim() ? undefined : 'Room required.',
      sched: t.status === 'scheduled' && !f.sched ? 'A scheduled room needs its date.' : undefined,
      ra: t.status === 'in_progress' && !f.ra ? 'A room being cleaned keeps its attendant.' : undefined,
    };
    setErr(e);
    if (Object.values(e).some(Boolean)) return e;
    const ch: Parameters<typeof editClean>[1] = {};
    if (f.room.trim() !== start.room) ch.room = f.room.trim();
    if (f.type !== start.type) ch.cleanType = f.type;
    if (f.ra !== start.ra) Object.assign(ch, f.ra ? { attendantId: f.ra } : { clearAttendant: true });
    if (f.role !== start.role) ch.role = f.role as 'lead' | 'backup';
    if (f.sched && f.sched !== start.sched) ch.schedDate = f.sched;
    if (!Object.keys(ch).length) {
      toast('Nothing to change.', 'info');
      close();
      return {};
    }
    editClean(t.id, ch);
    toast(`Room ${f.room.trim()} saved`, 'success');
    close();
    return {};
  };
  return (
    <FormSheet open title={`Edit room ${t.room}`} onClose={close} submitLabel="Save" submit={submit} summary={<>{CLEAN_LABEL[t.status]}{t.clockIn != null ? ` · clocked in ${fmtClock(t.clockIn)}` : ''}</>}>
      <Field label="Room" error={err.room}>{(p) => <input {...p} className="field" maxLength={40} value={f.room} onChange={(e) => setF((x) => ({ ...x, room: e.target.value }))} data-autofocus />}</Field>
      <Field label="Type">{(p) => <Choice {...p} value={f.type} onChange={(v) => setF((x) => ({ ...x, type: v }))} options={typeOpts} />}</Field>
      <Field label="RA (room attendant)" error={err.ra}>{(p) => <Choice {...p} value={f.ra} onChange={(v) => setF((x) => ({ ...x, ra: v }))} options={raOpts(raList, '—')} />}</Field>
      <Field label="Role">{(p) => <Choice {...p} value={f.role} onChange={(v) => setF((x) => ({ ...x, role: v as 'lead' | 'backup' }))} options={ROLE_OPTS} />}</Field>
      <Field label="Scheduled date" error={err.sched}>{(p) => <input {...p} className="field" type="date" value={f.sched} onChange={(e) => setF((x) => ({ ...x, sched: e.target.value }))} />}</Field>
    </FormSheet>
  );
}
