import { useId, useRef, useState } from 'react';
import { myStaff, toast, useApp } from '../../domain/store';
import { Button, Empty, Pill, Screen, useTier } from '../../ui/kit';
import { Sheet } from '../../ui/sheet';
import { Field, useModuleLevel } from '../housestatus/shared';
import { addDays, clock, dayName, hotelDate, hotelMoment, hotelTime, when } from '../housestatus/time';
import '../housestatus/housestatus.css';
import { FILTERS, STATUS_LABEL, TONE, arriveTrip, cancelTrip, checkTrip, clean, departTrip, editTrip, isDriver, logTrip, scheduleTrip, sortTrips, tripsOf, vehiclesOf, visible, type Filter, type Problems, type Trip, type TripInput, type Vehicle } from './model';

type Dialog = { kind: 'log' | 'schedule' } | { kind: 'edit'; trip: Trip } | null;

/** The departed column: the time it left, or for a scheduled trip when it is due. */
const leftAt = (t: Trip, now: number): string => (t.depAt ? when(t.depAt, now) : t.schedAt ? `${dayName(t.schedAt, now)} ${clock(t.schedAt)}` : '—');

export function TransportScreen() {
  const trips = useApp(tripsOf);
  const vehicles = useApp(vehiclesOf);
  const now = useApp((s) => s.now);
  const me = useApp(myStaff);
  const level = useModuleLevel('transport');
  const tier = useTier();
  const [filter, setFilter] = useState<Filter>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const desk = level === 'full';
  const shown = sortTrips(visible(trips, filter));
  const count = (f: Filter) => visible(trips, f).length;
  const out = count('en_route'), due = count('scheduled');
  const can = (t: Trip) => desk || (level === 'own' && isDriver(t, me?.name));
  const act = (t: Trip) => {
    if (t.status === 'scheduled') { departTrip(t.id); toast(`${t.no || 'Trip'} departed`, 'success'); }
    else { arriveTrip(t.id); toast(`${t.no || 'Trip'} arrived`, 'success'); }
  };
  const detailTrip = trips.find((t) => t.id === detail);

  return (
    <Screen title="Transport Log" subtitle={trips.length ? `Vehicles · ${out} on the road · ${due} scheduled` : 'Vehicles'}>
      <div className="modbar" role="group" aria-label="Transport actions and filter">
        {desk && <Button size="sm" icon="plus" onClick={() => setDialog({ kind: 'log' })}>Log Trip</Button>}
        {desk && <Button size="sm" variant="gray" onClick={() => setDialog({ kind: 'schedule' })}>Schedule Trip</Button>}
        {trips.length > 0 && (
          <span className="hs-filters" role="group" aria-label="Show">
            {FILTERS.map((f) => <button key={f.value} type="button" className="chip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>{f.label} <span className="tnum">{count(f.value)}</span></button>)}
          </span>
        )}
      </div>
      {!desk && <p className="t-foot c2" style={{ margin: '8px 4px 0' }}>{level === 'own' ? 'You can start and finish the trips where you are the driver.' : 'You can read the transport log.'}</p>}

      {trips.length === 0 ? (
        <Empty icon="van" text="No trips yet. Log a trip as it leaves, or schedule a pickup for later." action={desk ? 'Log Trip' : undefined} onAction={() => setDialog({ kind: 'log' })} />
      ) : shown.length === 0 ? (
        <Empty icon="van" text={`No ${STATUS_LABEL[filter === 'all' ? 'arrived' : filter].toLowerCase()} trips.`} />
      ) : tier === 'desktop' || tier === 'wide' ? (
        <div className="tr-wrap">
          <table className="tr-table">
            <thead>
              <tr>{['No', 'Vehicle', 'Driver', 'Destination', 'Purpose', 'Passengers', 'Departed', 'Arrived', 'Status', 'Action'].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className={t.status}>
                  <td><button type="button" className="tr-no" aria-label={`${t.no || 'New trip'}: open details`} onClick={() => setDetail(t.id)}>{t.no || 'New'}</button></td>
                  <td>{t.vehicle}</td>
                  <td>{t.driver || '—'}</td>
                  <td>{t.dest}</td>
                  <td>{t.purpose || '—'}</td>
                  <td>{t.passengers || '—'}</td>
                  <td className="tnum">{leftAt(t, now)}</td>
                  <td className="tnum">{t.arrAt ? when(t.arrAt, now) : '—'}</td>
                  <td><Pill tone={TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill></td>
                  <td>{(t.status === 'scheduled' || t.status === 'en_route') && can(t) && <Button size="sm" variant={t.status === 'scheduled' ? 'tint' : 'fill'} aria-label={`${t.status === 'scheduled' ? 'Depart' : 'Mark arrived'} ${t.no}`} onClick={() => act(t)}>{t.status === 'scheduled' ? 'Depart' : 'Arrived'}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="cards" role="list" style={{ marginTop: 12 }}>
          {shown.map((t) => (
            <li key={t.id}>
              <article className={`tr-card ${t.status}`}>
                <button type="button" className="tr-open" aria-label={`${t.no || 'New trip'} to ${t.dest}: open details`} onClick={() => setDetail(t.id)}>
                  <span className="t-head">{t.no || 'New'} · {t.vehicle}</span>
                  <Pill tone={TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill>
                </button>
                <dl>
                  <dt>To</dt><dd>{t.dest}</dd>
                  <dt>Driver</dt><dd>{t.driver || '—'}</dd>
                  {t.purpose && <><dt>Purpose</dt><dd>{t.purpose}</dd></>}
                  {t.passengers && <><dt>Passengers</dt><dd>{t.passengers}</dd></>}
                  <dt>{t.depAt ? 'Departed' : 'Due'}</dt><dd className="tnum">{leftAt(t, now)}</dd>
                  {t.arrAt && <><dt>Arrived</dt><dd className="tnum">{when(t.arrAt, now)}</dd></>}
                </dl>
                {(t.status === 'scheduled' || t.status === 'en_route') && can(t) && (
                  <div className="hs-actions"><Button size="sm" variant={t.status === 'scheduled' ? 'tint' : 'fill'} aria-label={`${t.status === 'scheduled' ? 'Depart' : 'Mark arrived'} ${t.no}`} onClick={() => act(t)}>{t.status === 'scheduled' ? 'Depart' : 'Arrived'}</Button></div>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!dialog} onClose={() => setDialog(null)} title={dialog?.kind === 'edit' ? `Edit ${dialog.trip.no}` : dialog?.kind === 'schedule' ? 'Schedule Trip' : dialog ? 'Log Trip' : ''}>
        {dialog && <TripForm key={dialog.kind + (dialog.kind === 'edit' ? dialog.trip.id : '')} dialog={dialog} vehicles={vehicles} onClose={() => setDialog(null)} />}
      </Sheet>
      <Sheet open={!!detailTrip} onClose={() => setDetail(null)} title={detailTrip ? `${detailTrip.no || 'New trip'} · ${detailTrip.vehicle}` : ''}>
        {detailTrip && <TripDetail trip={detailTrip} now={now} desk={desk} canMove={can(detailTrip)} onMove={() => { act(detailTrip); setDetail(null); }} onEdit={() => { setDetail(null); setDialog({ kind: 'edit', trip: detailTrip }); }} onClose={() => setDetail(null)} />}
      </Sheet>
    </Screen>
  );
}

function TripDetail({ trip: t, now, desk, canMove, onMove, onEdit, onClose }: { trip: Trip; now: number; desk: boolean; canMove: boolean; onMove: () => void; onEdit: () => void; onClose: () => void }) {
  const [sure, setSure] = useState(false);
  const rows: [string, string][] = [['Status', STATUS_LABEL[t.status]], ['Destination', t.dest], ['Driver', t.driver || '—'], ['Purpose', t.purpose || '—'], ['Passengers', t.passengers || '—'], [t.depAt ? 'Departed' : 'Due', leftAt(t, now)], ['Arrived', t.arrAt ? when(t.arrAt, now) : '—']];
  const live = t.status === 'scheduled' || t.status === 'en_route';
  return (
    <div>
      <dl className="tr-card" style={{ gridTemplateColumns: 'auto 1fr', marginTop: 4 }}>
        {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {sure ? (
        <div className="banner" role="alertdialog" aria-label="Cancel this trip" style={{ marginTop: 14, flexDirection: 'column' }}>
          <span><b>Cancel {t.no}?</b> It stays in the log as cancelled. This cannot be undone.</span>
          <span className="hs-actions"><Button variant="gray" onClick={() => setSure(false)}>Keep trip</Button><Button variant="bad" onClick={() => { cancelTrip(t.id); toast(`${t.no} cancelled`, 'success'); onClose(); }}>Cancel trip</Button></span>
        </div>
      ) : (
        <div className="hs-actions" style={{ marginTop: 16 }}>
          {live && canMove && <Button onClick={onMove}>{t.status === 'scheduled' ? 'Depart' : 'Arrived'}</Button>}
          {live && desk && <Button variant="gray" onClick={onEdit}>Edit</Button>}
          {t.status === 'scheduled' && desk && <Button variant="bad" onClick={() => setSure(true)}>Cancel trip</Button>}
          <Button variant="plain" onClick={onClose}>Close</Button>
        </div>
      )}
    </div>
  );
}

function TripForm({ dialog, vehicles, onClose }: { dialog: NonNullable<Dialog>; vehicles: Vehicle[]; onClose: () => void }) {
  const staff = useApp((s) => s.staff);
  const trip = dialog.kind === 'edit' ? dialog.trip : undefined;
  const scheduled = dialog.kind === 'schedule' || trip?.status === 'scheduled';
  const options = vehicles.filter((v) => v.active || v.key === trip?.vehicleKey);
  const now = useApp((s) => s.now);
  const today = hotelDate(now);
  const [v, setV] = useState<TripInput>({
    vehicle: trip?.vehicleKey ?? options[0]?.key ?? '',
    driver: trip?.driver ?? '', dest: trip?.dest ?? '', purpose: trip?.purpose ?? '', passengers: trip?.passengers ?? '',
    date: trip?.schedAt ? hotelDate(trip.schedAt) : addDays(today, 1), time: trip?.schedAt ? hotelTime(trip.schedAt) : '08:00',
  });
  const [problems, setProblems] = useState<Problems>({});
  const form = useRef<HTMLDivElement>(null);
  const names = useId();
  const set = (k: keyof TripInput) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  const submit = () => {
    const found = checkTrip(v, scheduled, vehicles, trip?.vehicleKey);
    setProblems(found);
    if (!clean(found)) return requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    if (trip) { editTrip(trip.id, v); toast(`${trip.no} saved`, 'success'); }
    else if (scheduled) { scheduleTrip(v); toast('Scheduled', 'success'); }
    else { logTrip(v); toast('Trip logged', 'success'); }
    onClose();
  };
  const when_ = hotelMoment(v.date ?? '', v.time ?? '');
  return (
    <div ref={form}>
      {options.length === 0 && <p className="field-help hs-error" role="alert">There are no vehicles to choose. Add them in Configuration, under Lists.</p>}
      <Field label="Vehicle" error={problems.vehicle}>
        {(p) => <select {...p} className="field" value={v.vehicle} onChange={set('vehicle')} data-autofocus>{options.map((o) => <option key={o.key} value={o.key}>{o.label}{o.active ? '' : ' (removed)'}</option>)}</select>}
      </Field>
      <Field label="Driver" error={problems.driver} help="Type a name or pick a staff member.">
        {(p) => <><input {...p} className="field" list={names} autoComplete="off" value={v.driver} onChange={set('driver')} /><datalist id={names}>{staff.map((s) => <option key={s.id} value={s.name} />)}</datalist></>}
      </Field>
      <Field label="Destination" required error={problems.dest}>
        {(p) => <input {...p} className="field" autoComplete="off" value={v.dest} onChange={set('dest')} />}
      </Field>
      <div className="tr-pair">
        <Field label="Purpose" error={problems.purpose}>{(p) => <input {...p} className="field" autoComplete="off" value={v.purpose} onChange={set('purpose')} />}</Field>
        <Field label="Passengers" error={problems.passengers}>{(p) => <input {...p} className="field" autoComplete="off" value={v.passengers} onChange={set('passengers')} />}</Field>
      </div>
      {scheduled && (
        <>
          <div className="tr-pair">
            <Field label="Date" required error={problems.when}>{(p) => <input {...p} className="field" type="date" min={addDays(today, -1)} value={v.date} onChange={set('date')} />}</Field>
            <Field label="Time" required>{(p) => <input {...p} className="field" type="time" value={v.time} onChange={set('time')} />}</Field>
          </div>
          {when_ !== null && <p className="field-help">{dayName(when_, now)}, hotel time.</p>}
        </>
      )}
      <div className="hs-foot">
        <Button variant="gray" onClick={onClose}>Cancel</Button>
        <Button feel="success" onClick={submit} disabled={options.length === 0}>{trip ? 'Save' : scheduled ? 'Schedule' : 'Depart'}</Button>
      </div>
    </div>
  );
}
