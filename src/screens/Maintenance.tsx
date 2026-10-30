// Work Orders (sidebar id workorders), the client prototype's module 5 (docs/MODULES-SPEC.md A.7): the table with
// filters, "+ Report Work Order", row actions, and the record pane (WoDetail) with its buttons. Forms are in
// src/modules/workorders/forms.tsx, data and actions in src/modules/workorders/model.ts.
import { useMemo, useState, type ReactNode } from 'react';
import { activeDepartments, deptLabel } from '../domain/catalog';
import { setUI, toast, useApp, useUI } from '../domain/store';
import type { State } from '../domain/types';
import { Button, Empty, Icon, Pill, Screen, useTier } from '../ui/kit';
import { Choice, Field } from '../modules/workorders/form';
import { WoSheets, nameOf, openWoSheet } from '../modules/workorders/forms';
import {
  NO_FILTERS, PRIORITIES, STATUS_LABEL, STATUS_TONE, applyFilters, can, deadline, fmtDay, fmtStamp, openWo, overdue, peso, priorityLabel, priorityTone, reopenWo, startWo,
  useLevel, useWos, type Filters, type StatusFilter, type Wo, type WoStatus,
} from '../modules/workorders/model';

const TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'reported', label: 'Reported' },
  { value: 'assessed', label: 'Assessed' }, { value: 'in_progress', label: 'In Progress' }, { value: 'on_hold', label: 'On Hold' }, { value: 'done', label: 'Done' },
];

const select = (id: string) => setUI({ selWo: id, selItem: undefined, sheet: null });

/** The prototype's row actions for a status: Assess, Start, Hold and Complete, Resume, Reopen, Open. */
function actions(w: Wo, size: 'sm' | 'md' = 'sm'): ReactNode[] {
  const out: ReactNode[] = [];
  const b = (key: string, label: string, run: () => void, variant: 'fill' | 'tint' | 'gray' = 'tint', cls = '') => (
    <Button key={key} size={size === 'sm' ? 'sm' : 'md'} variant={variant} className={cls} aria-label={`${label} ${w.no}`} onClick={run}>{label}</Button>
  );
  if (can('openWo', w.status)) out.push(b('open', 'Open', () => { openWo(w.id); toast(`${w.no} opened`, 'success'); }));
  if (can('assessWo', w.status)) out.push(b('assess', 'Assess', () => openWoSheet('assess', w.id)));
  if (w.status === 'assessed') out.push(b('start', 'Start', () => { startWo(w.id, false); toast(`${w.no} started`, 'success'); }));
  if (can('holdWo', w.status)) out.push(b('hold', 'Hold', () => openWoSheet('hold', w.id), 'gray', 'btn-warn'));
  if (w.status === 'on_hold') out.push(b('resume', 'Resume', () => { startWo(w.id, true); toast(`${w.no} resumed`, 'success'); }));
  if (w.status === 'in_progress') out.push(b('complete', 'Complete', () => openWoSheet('complete', w.id), 'fill', 'btn-ok'));
  if (can('reopenWo', w.status)) out.push(b('reopen', 'Reopen', () => { reopenWo(w.id); toast(`${w.no} reopened`, 'success'); }, 'gray'));
  return out;
}

const Status = ({ st }: { st: WoStatus }) => <Pill tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Pill>;
const Priority = ({ p }: { p: string }) => <Pill tone={priorityTone(p)}>{priorityLabel(p)}</Pill>;

function Assigned({ w, s }: { w: Wo; s: State }) {
  if (w.assignType === 'outsource') return <span className="mx-out">Outsourced: {w.contractor ?? 'contractor'}</span>;
  return <>{w.assignee ? nameOf(s, w.assignee) : <span className="c-muted">—</span>}</>;
}

function Reporter({ w, s }: { w: Wo; s: State }) {
  const dept = w.reporterDept ? deptLabel(w.reporterDept, s.catalog) : w.srcItemId ? 'Help desk' : '';
  return <>{w.reportedBy ? nameOf(s, w.reportedBy) : '—'}{dept && <span className="mx-sub">{dept}</span>}</>;
}

function Deadline({ w, now }: { w: Wo; now: number }) {
  const d = deadline(w);
  if (w.status === 'scheduled') return <span>{fmtDay(w.schedDate)} <span className="c-muted">(scheduled)</span></span>;
  if (d == null) return <span className="c-muted">—</span>;
  return overdue(w, now)
    ? <span className="mx-late"><Icon name="warn" size={16} weight="fill" />{fmtDay(d)}<span className="sr"> (overdue)</span></span>
    : <span className="nowrap">{fmtDay(d)}</span>;
}

export function Maintenance() {
  const all = useWos();
  const s = useApp((x) => x);
  const sel = useUI((x) => x.selWo);
  const level = useLevel('workorders');
  const tier = useTier();
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const list = useMemo(() => applyFilters(all, f, s.now), [all, f, s.now]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.value, applyFilters(all, { ...NO_FILTERS, status: t.value }, s.now).length])), [all, s.now]);
  const late = all.filter((w) => overdue(w, s.now)).length;
  const write = level === 'full' || level === 'own';
  const depts = activeDepartments(s.catalog);
  const filtered = f.status !== 'all' || f.priority || f.dept || f.overdueOnly;

  return (
    <Screen title="Work Orders" subtitle="Maintenance">
      {write && (
        <div className="mx-actions">
          <Button icon="plus" onClick={() => openWoSheet('report')}>Report Work Order</Button>
        </div>
      )}

      {all.length === 0 ? (
        <Empty icon="wrench" text={write ? 'No work orders yet. Report one here, or escalate an on-site request item of a department that handles repairs.' : 'No work orders yet.'} />
      ) : (
        <>
          <div className="mx-filters">
            <div className="mx-tabs" role="group" aria-label="Filter by status">
              {TABS.map((t) => (
                <button key={t.value} type="button" className="chip" aria-pressed={f.status === t.value} onClick={() => setF((x) => ({ ...x, status: t.value }))}>
                  {t.label} <span className="n">{counts[t.value]}</span>
                </button>
              ))}
            </div>
            <div className="mx-selects">
              <Field label="Priority">{(p) => <Choice {...p} value={f.priority} onChange={(v) => setF((x) => ({ ...x, priority: v }))} options={[{ value: '', label: 'Any priority' }, ...PRIORITIES.map((x) => ({ value: x, label: priorityLabel(x) }))]} />}</Field>
              <Field label="Department">{(p) => <Choice {...p} value={f.dept} onChange={(v) => setF((x) => ({ ...x, dept: v }))} options={[{ value: '', label: 'All departments' }, ...depts.map((d) => ({ value: d.key, label: d.label }))]} />}</Field>
              <button type="button" className="chip" aria-pressed={f.overdueOnly} onClick={() => setF((x) => ({ ...x, overdueOnly: !x.overdueOnly }))}>
                <Icon name="warn" size={18} /> Overdue <span className="n">{late}</span>
              </button>
              {filtered && <Button size="sm" variant="plain" onClick={() => setF(NO_FILTERS)}>Clear filters</Button>}
            </div>
          </div>
          <p className="mx-count t-sub" role="status" aria-live="polite">{list.length === all.length ? `${all.length} work order${all.length === 1 ? '' : 's'}` : `Showing ${list.length} of ${all.length}`}</p>

          {list.length === 0 ? (
            <Empty icon="wrench" text="No work orders match these filters." action="Clear filters" onAction={() => setF(NO_FILTERS)} />
          ) : tier === 'phone' ? (
            <ul className="mx-cards" aria-label="Work orders">
              {list.map((w) => (
                <li key={w.id} className="mx-card" aria-current={sel === w.id}>
                  <button type="button" className="mx-card-open" onClick={() => select(w.id)} aria-label={`${w.no}, ${STATUS_LABEL[w.status]}: ${w.desc}. Open details`}>
                    <span className="mx-card-top"><span className="t-head">{w.no}</span><Status st={w.status} /></span>
                    <span className="t-body">{w.desc}</span>
                  </button>
                  <dl>
                    <dt>Where</dt><dd>{w.area}{w.loc ? ` · ${w.loc}` : ''}</dd>
                    <dt>Priority</dt><dd><Priority p={w.priority} /></dd>
                    <dt>Dept</dt><dd>{deptLabel(w.dept, s.catalog)}</dd>
                    <dt>Assigned</dt><dd><Assigned w={w} s={s} /></dd>
                    <dt>Reporter</dt><dd><Reporter w={w} s={s} /></dd>
                    <dt>Deadline</dt><dd><Deadline w={w} now={s.now} /></dd>
                  </dl>
                  {write && actions(w).length > 0 && <div className="act">{actions(w)}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="dt" role="region" aria-label="Work orders" tabIndex={0}>
              <table>
                <thead>
                  <tr>{['WO#', 'Area', 'Location', 'Description', 'Pri', 'Dept', 'Assigned', 'Reporter', 'Deadline', 'Status', ...(write ? ['Action'] : [])].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {list.map((w) => (
                    <tr key={w.id} aria-current={sel === w.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) select(w.id); }}>
                      <td><button type="button" className="no" onClick={() => select(w.id)} aria-label={`${w.no}: open details`}>{w.no}</button></td>
                      <td className="nowrap">{w.area}</td>
                      <td>{w.loc || <span className="c-muted">—</span>}</td>
                      <td><div className="desc" title={w.desc}>{w.desc}</div></td>
                      <td><Priority p={w.priority} /></td>
                      <td className="nowrap">{deptLabel(w.dept, s.catalog)}</td>
                      <td><Assigned w={w} s={s} /></td>
                      <td><Reporter w={w} s={s} /></td>
                      <td><Deadline w={w} now={s.now} /></td>
                      <td><Status st={w.status} /></td>
                      {write && <td><div className="act">{actions(w)}</div></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <WoSheets />
    </Screen>
  );
}

const Item = ({ k, children }: { k: string; children: ReactNode }) => <div><dt>{k}</dt><dd>{children}</dd></div>;

/** The record pane: everything the prototype's drawer shows, the progress notes and the audit trail, then the buttons. */
export function WoDetail({ id }: { id: string }) {
  const w = useWos().find((x) => x.id === id);
  const s = useApp((x) => x);
  const level = useLevel('workorders');
  if (!w) return <p className="c2">This work order is no longer available.</p>;
  const write = level === 'full' || level === 'own';
  const src = w.srcItemId ? s.items[w.srcItemId] : undefined;
  const ticket = src ? s.requests.find((r) => r.id === src.requestId) : undefined;
  const late = overdue(w, s.now);
  return (
    <div>
      <div className="wo-head">
        <h2 className="t-title2">{w.no}{w.loc ? ` · ${w.loc}` : ''}</h2>
        <Status st={w.status} />
        {late && <Pill tone="bad">Overdue</Pill>}
      </div>

      <section className="wo-sec" aria-label="Work order">
        <dl className="wo-grid">
          <Item k="Area">{w.area}</Item>
          <Item k="Location">{w.loc || '—'}</Item>
          <Item k="Priority"><Priority p={w.priority} /></Item>
          <Item k="Dept">{deptLabel(w.dept, s.catalog)}</Item>
          <Item k="Assigned"><Assigned w={w} s={s} /></Item>
          <Item k="Reporter"><Reporter w={w} s={s} /></Item>
          <Item k="Encoded">{nameOf(s, w.encodedBy)}</Item>
          <Item k="Requested">{w.requestedDate == null ? '—' : fmtDay(w.requestedDate)}</Item>
          {w.targetEnd != null && <Item k="Deadline"><Deadline w={w} now={s.now} /></Item>}
          {w.status === 'scheduled' && <Item k="Scheduled for">{fmtDay(w.schedDate)}</Item>}
          <Item k="Reported">{fmtStamp(w.createdAt)}</Item>
        </dl>
        <p className="wo-box" style={{ marginTop: 10 }}>{w.desc}</p>
        {ticket && (
          <p className="t-sub" style={{ margin: '8px 0 0' }}>
            <Icon name="clip" size={16} /> From request {ticket.ticket}, room {ticket.room}.{' '}
            <button type="button" className="btn btn-plain btn-sm" onClick={() => setUI({ tab: 'requests', selItem: w.srcItemId, selWo: undefined, sheet: null })}>Open the request</button>
            <span className="t-foot c2" style={{ display: 'block' }}>Completing this work order closes that request item.</span>
          </p>
        )}
      </section>

      {w.holdReason && w.status === 'on_hold' && <p className="wo-box warn wo-sec"><b>On hold:</b> {w.holdReason}</p>}

      {w.assessment && (
        <section className="wo-sec">
          <h3>Assessment</h3>
          <p className="wo-box accent" style={{ margin: 0 }}>{w.assessment}</p>
          <dl className="wo-grid" style={{ marginTop: 8 }}>
            <Item k="By">{nameOf(s, w.assessedBy)}</Item>
            <Item k="Date">{fmtStamp(w.assessedAt)}</Item>
            <Item k="Target">{w.targetStart == null && w.targetEnd == null ? '—' : `${fmtDay(w.targetStart)} → ${fmtDay(w.targetEnd)}`}</Item>
          </dl>
        </section>
      )}

      {(w.estCost != null || w.actualCost != null) && (
        <section className="wo-sec">
          <h3>Cost</h3>
          <div className={`wo-box wo-cost ${w.actualCost != null && w.estCost != null && w.actualCost > w.estCost ? 'warn' : 'ok'}`}>
            <span>Estimated</span><b>{peso(w.estCost)}</b>
            <span>Actual</span><b>{peso(w.actualCost)}</b>
          </div>
        </section>
      )}

      {(w.actualStart != null || w.actualEnd != null) && (
        <section className="wo-sec">
          <h3>Actual</h3>
          <dl className="wo-grid">
            <Item k="Started">{fmtStamp(w.actualStart)}</Item>
            <Item k="Completed">{fmtStamp(w.actualEnd)}</Item>
          </dl>
          {w.completionNotes && <p className="wo-box ok" style={{ marginTop: 8 }}>{w.completionNotes}</p>}
        </section>
      )}

      <section className="wo-sec">
        <h3>Updates ({w.updates?.length ?? 0})</h3>
        {w.updates?.length ? (
          <ol className="wo-log">
            {w.updates.map((u, i) => <li key={i}><span className="meta">{fmtStamp(u.at)} · {nameOf(s, u.by)}</span><span className="text">{u.text}</span></li>)}
          </ol>
        ) : <p className="t-sub c2" style={{ margin: 0 }}>No progress updates yet.</p>}
      </section>

      <section className="wo-sec">
        <h3>Audit trail</h3>
        <ol className="wo-log wo-audit" tabIndex={0} aria-label="Audit trail">
          {w.audit.map((a, i) => <li key={i}><span className="meta">{fmtStamp(a.at)} · {nameOf(s, a.by)}</span><span className="text">{a.what}</span></li>)}
        </ol>
      </section>

      {write && (
        <div className="wo-buttons">
          <Button variant="gray" icon="note" onClick={() => openWoSheet('edit', w.id)}>Edit</Button>
          {can('updateWo', w.status) && <Button variant="tint" icon="plus" onClick={() => openWoSheet('update', w.id)}>Update</Button>}
          {actions(w, 'md')}
        </div>
      )}
    </div>
  );
}
