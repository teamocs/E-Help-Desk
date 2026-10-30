// The Work Orders sheets, one at a time, as the prototype's modals (A.7.2 and A.7.4): Report, Assess, Update,
// Hold, Complete, Edit. Open one with openWoSheet(); WoSheets renders it.
import { useState, useSyncExternalStore } from 'react';
import { createStore, toast, useApp } from '../../domain/store';
import { activeDepartments, deptLabel } from '../../domain/catalog';
import type { Staff, State } from '../../domain/types';
import { Check, Choice, Field, FormPart, FormSheet, type Errors } from './form';
import {
  PRIORITIES, areasOf, assessWo, completeWo, dayOf, dayPlus, deadline, editWo, holdWo, priorityKey, priorityLabel, reportWo, today, updateWo, useWos,
  type Priority, type Wo,
} from './model';

export type WoSheetKind = 'report' | 'assess' | 'update' | 'hold' | 'complete' | 'edit';
export const woSheet = createStore<{ kind: WoSheetKind; id?: string } | null>(null);
export const openWoSheet = (kind: WoSheetKind, id?: string) => woSheet.set(() => ({ kind, id }));
const close = () => woSheet.set(() => null);

/** People who can be picked: real staff rows only (the signed-in manager account is not one). */
const people = (staff: Staff[]) => staff.filter((p) => p.id !== 'member');
const opts = (list: Staff[], blank?: string) => [...(blank != null ? [{ value: '', label: blank }] : []), ...list.map((p) => ({ value: p.id, label: p.name }))];
const HD_ROLES = ['hdo', 'supervisor', 'manager', 'owner'];
const hdStaff = (staff: Staff[]) => people(staff).filter((p) => HD_ROLES.includes(p.role));
const deptStaff = (staff: Staff[], dept: string) => people(staff).filter((p) => p.dept === dept);
/** The signed-in person when they are in the list, else the first one, else none. */
const defaultOf = (list: Staff[], me: string | null) => (list.some((p) => p.id === me) ? me! : list[0]?.id ?? '');
const money = (v: string): number | undefined | null => {
  if (v.trim() === '') return undefined;
  const n = Number(v.replace(/[,₱\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const COST_ERROR = 'Enter a cost of zero or more, in pesos.';

export function WoSheets() {
  const open = useStoreValue();
  const wos = useWos();
  const wo = open?.id ? wos.find((w) => w.id === open.id) : undefined;
  if (!open) return null;
  if (open.kind === 'report') return <ReportSheet />;
  if (!wo) return null;
  const P = { assess: AssessSheet, update: UpdateSheet, hold: HoldSheet, complete: CompleteSheet, edit: EditSheet }[open.kind];
  return <P key={`${open.kind}-${wo.id}`} wo={wo} />;
}

function useStoreValue() {
  return useSyncExternalStore(woSheet.sub, woSheet.get, woSheet.get);
}

/* ---------- Report Work Order ---------- */

function ReportSheet() {
  const s = useApp((x) => x);
  const depts = activeDepartments(s.catalog);
  const areas = areasOf(s.catalog);
  const repairs = depts.find((d) => d.repairs)?.key ?? depts[0]?.key ?? '';
  const meDept = s.staff.find((p) => p.id === s.me)?.dept;
  const [f, setF] = useState({
    area: areas[0] ?? '', loc: '', desc: '', priority: 'medium' as Priority, dept: repairs,
    reporterDept: meDept && depts.some((d) => d.key === meDept) ? meDept : depts[0]?.key ?? '', reporterId: '', encodedBy: defaultOf(hdStaff(s.staff), s.me),
    requestedDate: '', preventive: false, schedDate: dayPlus(7),
  });
  const [err, setErr] = useState<Errors>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const reporters = deptStaff(s.staff, f.reporterDept);
  const submit = (): Errors => {
    const e: Errors = {
      area: f.area ? undefined : 'Choose the area.',
      desc: f.desc.trim() ? (f.desc.length > 2000 ? 'Keep the description under 2000 characters.' : undefined) : 'Description required.',
      loc: f.loc.length > 80 ? 'Keep the location under 80 characters.' : undefined,
      dept: f.dept ? undefined : 'Choose the department to assign.',
      reporterDept: f.reporterDept ? undefined : "Choose the reporter's department.",
      requestedDate: f.requestedDate ? undefined : 'Date required.',
      schedDate: f.preventive && !f.schedDate ? 'Choose the date to schedule it for.' : undefined,
    };
    setErr(e);
    if (Object.values(e).some(Boolean)) return e;
    const no = reportWo({
      area: f.area, loc: f.loc.trim(), desc: f.desc.trim(), priority: f.priority, dept: f.dept, reporterDept: f.reporterDept,
      reporterId: f.reporterId || undefined, encodedBy: f.encodedBy || undefined, requestedDate: f.requestedDate, schedDate: f.preventive ? f.schedDate : undefined,
    }, s);
    toast(f.preventive ? `${no} scheduled for ${f.schedDate}` : `Created ${no}`, 'success');
    close();
    return {};
  };
  return (
    <FormSheet open title="Report Work Order" onClose={close} submitLabel="Submit" submit={submit}>
      <Field label="Area" error={err.area}>{(p) => <Choice {...p} value={f.area} onChange={(v) => set('area', v)} options={areas.map((a) => ({ value: a, label: a }))} />}</Field>
      <Field label="Location" error={err.loc}>{(p) => <input {...p} className="field" placeholder="Room 305, Lobby…" maxLength={80} value={f.loc} onChange={(e) => set('loc', e.target.value)} />}</Field>
      <Field label="Problem / Description" error={err.desc} wide>{(p) => <textarea {...p} className="field" rows={3} value={f.desc} onChange={(e) => set('desc', e.target.value)} data-autofocus />}</Field>
      <Field label="Priority">{(p) => <Choice {...p} value={f.priority} onChange={(v) => set('priority', v as Priority)} options={PRIORITIES.map((x) => ({ value: x, label: priorityLabel(x) }))} />}</Field>
      <Field label="Assign to Dept" error={err.dept}>{(p) => <Choice {...p} value={f.dept} onChange={(v) => set('dept', v)} options={depts.map((d) => ({ value: d.key, label: d.label }))} />}</Field>
      <FormPart>Reported by</FormPart>
      <Field label="Reporter Dept" error={err.reporterDept}>{(p) => <Choice {...p} value={f.reporterDept} onChange={(v) => setF((x) => ({ ...x, reporterDept: v, reporterId: '' }))} options={depts.map((d) => ({ value: d.key, label: d.label }))} />}</Field>
      <Field label="Reporter Name" help={reporters.length ? undefined : 'No staff listed for this department.'}>{(p) => <Choice {...p} value={f.reporterId} onChange={(v) => set('reporterId', v)} options={opts(reporters, 'Select…')} />}</Field>
      <Field label="Encoded by (HDO)">{(p) => <Choice {...p} value={f.encodedBy} onChange={(v) => set('encodedBy', v)} options={opts(hdStaff(s.staff), 'Me')} />}</Field>
      <Field label="Requested completion *" error={err.requestedDate}>{(p) => <input {...p} className="field" type="date" min={today()} value={f.requestedDate} onChange={(e) => set('requestedDate', e.target.value)} />}</Field>
      <Check checked={f.preventive} onChange={(v) => set('preventive', v)}>Preventive: schedule it, someone opens it on the day</Check>
      {f.preventive && <Field label="Scheduled for" error={err.schedDate}>{(p) => <input {...p} className="field" type="date" min={today()} value={f.schedDate} onChange={(e) => set('schedDate', e.target.value)} />}</Field>}
    </FormSheet>
  );
}

/* ---------- Assess ---------- */

function AssessSheet({ wo }: { wo: Wo }) {
  const s = useApp((x) => x);
  const team = deptStaff(s.staff, wo.dept);
  const [f, setF] = useState({ assessment: '', assignType: 'inhouse' as 'inhouse' | 'outsource', assigneeId: team[0]?.id ?? '', contractor: '', assessedById: defaultOf(team, s.me), targetStart: '', targetEnd: '', est: '' });
  const [err, setErr] = useState<Errors>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const findings = s.catalog.woFindings.filter((x) => x.active);
  const submit = (): Errors => {
    const est = money(f.est);
    const e: Errors = {
      assessment: f.assessment.trim() ? undefined : 'Assessment required.',
      contractor: f.assignType === 'outsource' && !f.contractor.trim() ? 'Contractor required.' : undefined,
      targetEnd: f.targetStart && f.targetEnd && f.targetEnd < f.targetStart ? 'The end date is before the start date.' : undefined,
      est: est === null ? COST_ERROR : undefined,
    };
    setErr(e);
    if (Object.values(e).some(Boolean)) return e;
    assessWo(wo.id, {
      assessment: f.assessment.trim(), assignType: f.assignType, assigneeId: f.assignType === 'inhouse' ? f.assigneeId || undefined : undefined,
      contractor: f.assignType === 'outsource' ? f.contractor.trim() : undefined, assessedById: f.assessedById || undefined,
      targetStart: f.targetStart || undefined, targetEnd: f.targetEnd || undefined, estCost: est ?? undefined,
    });
    toast(`${wo.no} assessed`, 'success');
    close();
    return {};
  };
  return (
    <FormSheet open title={`Assess ${wo.no}`} onClose={close} submitLabel="Submit" submit={submit} summary={<><b>{wo.no}</b> · {wo.desc}</>}>
      <Field label="Assessment / Findings" error={err.assessment} wide>{(p) => <textarea {...p} className="field" rows={3} value={f.assessment} onChange={(e) => set('assessment', e.target.value)} data-autofocus />}</Field>
      {findings.length > 0 && (
        <div className="wide mx-tabs" role="group" aria-label="Common findings">
          {findings.map((x) => <button key={x.key} type="button" className="chip" aria-pressed={f.assessment === x.label} onClick={() => set('assessment', x.label)}>{x.label}</button>)}
        </div>
      )}
      <Field label="Assignment">{(p) => <Choice {...p} value={f.assignType} onChange={(v) => set('assignType', v as 'inhouse' | 'outsource')} options={[{ value: 'inhouse', label: 'In-house' }, { value: 'outsource', label: 'Outsource' }]} />}</Field>
      {f.assignType === 'inhouse'
        ? <Field label="Assign to">{(p) => <Choice {...p} value={f.assigneeId} onChange={(v) => set('assigneeId', v)} options={opts(team, '—')} />}</Field>
        : <Field label="Contractor" error={err.contractor}>{(p) => <input {...p} className="field" maxLength={120} value={f.contractor} onChange={(e) => set('contractor', e.target.value)} />}</Field>}
      <Field label="Assessed by">{(p) => <Choice {...p} value={f.assessedById} onChange={(v) => set('assessedById', v)} options={opts(team, 'Me')} />}</Field>
      <FormPart>Target</FormPart>
      <Field label="Start date">{(p) => <input {...p} className="field" type="date" value={f.targetStart} onChange={(e) => set('targetStart', e.target.value)} />}</Field>
      <Field label="End date" error={err.targetEnd}>{(p) => <input {...p} className="field" type="date" min={f.targetStart || undefined} value={f.targetEnd} onChange={(e) => set('targetEnd', e.target.value)} />}</Field>
      <Field label="Est. cost (₱)" error={err.est} help="Leave empty when there is no estimate yet.">{(p) => <input {...p} className="field" inputMode="decimal" value={f.est} onChange={(e) => set('est', e.target.value)} />}</Field>
    </FormSheet>
  );
}

/* ---------- + Update: a progress note, extend the deadline, transfer to outsource ---------- */

function UpdateSheet({ wo }: { wo: Wo }) {
  const s = useApp((x) => x);
  const by = [...deptStaff(s.staff, wo.dept), ...hdStaff(s.staff).filter((p) => p.dept !== wo.dept)];
  const [f, setF] = useState({ text: '', byId: defaultOf(by, s.me), extend: false, newDeadline: '', reason: '', outsource: false, contractor: '', est: '' });
  const [err, setErr] = useState<Errors>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const current = deadline(wo);
  const submit = (): Errors => {
    const est = money(f.est);
    const e: Errors = {
      text: f.text.trim() ? undefined : 'Required.',
      newDeadline: f.extend && !f.newDeadline ? 'New deadline required.' : undefined,
      contractor: f.outsource && !f.contractor.trim() ? 'Contractor required.' : undefined,
      est: f.outsource && est === null ? COST_ERROR : undefined,
    };
    setErr(e);
    if (Object.values(e).some(Boolean)) return e;
    updateWo(wo.id, {
      text: f.text.trim(), byId: f.byId || undefined,
      ...(f.extend ? { newDeadline: f.newDeadline, extendReason: f.reason.trim() || undefined } : {}),
      ...(f.outsource ? { contractor: f.contractor.trim(), estCost: est ?? undefined } : {}),
    });
    toast(`${wo.no} updated`, 'success');
    close();
    return {};
  };
  return (
    <FormSheet open title={`Update ${wo.no}`} onClose={close} submitLabel="Save" submit={submit}>
      <Field label="Progress update" error={err.text} wide>{(p) => <textarea {...p} className="field" rows={3} value={f.text} onChange={(e) => set('text', e.target.value)} data-autofocus />}</Field>
      <Field label="By">{(p) => <Choice {...p} value={f.byId} onChange={(v) => set('byId', v)} options={opts(by, 'Me')} />}</Field>
      <Check checked={f.extend} onChange={(v) => set('extend', v)}>Extend deadline</Check>
      {f.extend && (
        <>
          <Field label="Current">{(p) => <input {...p} className="field" readOnly value={current == null ? 'None set' : dayOf(current)} />}</Field>
          <Field label="New deadline" error={err.newDeadline}>{(p) => <input {...p} className="field" type="date" value={f.newDeadline} onChange={(e) => set('newDeadline', e.target.value)} />}</Field>
          <Field label="Reason" wide>{(p) => <input {...p} className="field" placeholder="Parts delayed…" maxLength={200} value={f.reason} onChange={(e) => set('reason', e.target.value)} />}</Field>
        </>
      )}
      {wo.assignType !== 'outsource' && <Check checked={f.outsource} onChange={(v) => set('outsource', v)}>Transfer to Outsource</Check>}
      {f.outsource && (
        <>
          <Field label="Contractor" error={err.contractor}>{(p) => <input {...p} className="field" maxLength={120} value={f.contractor} onChange={(e) => set('contractor', e.target.value)} />}</Field>
          <Field label="Est. cost (₱)" error={err.est}>{(p) => <input {...p} className="field" inputMode="decimal" value={f.est} onChange={(e) => set('est', e.target.value)} />}</Field>
        </>
      )}
    </FormSheet>
  );
}

/* ---------- Hold ---------- */

function HoldSheet({ wo }: { wo: Wo }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<Errors>({});
  const submit = (): Errors => {
    const e: Errors = { reason: reason.trim() ? (reason.length > 255 ? 'Keep the reason under 255 characters.' : undefined) : 'Reason required.' };
    setErr(e);
    if (e.reason) return e;
    holdWo(wo.id, reason.trim());
    toast(`${wo.no} on hold`, 'success');
    close();
    return {};
  };
  return (
    <FormSheet open title={`Hold ${wo.no}`} onClose={close} submitLabel="Hold" tone="warn" submit={submit}>
      <Field label="Reason" error={err.reason} wide>{(p) => <textarea {...p} className="field" rows={2} placeholder="Waiting for parts, contractor not available…" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />}</Field>
    </FormSheet>
  );
}

/* ---------- Complete ---------- */

function CompleteSheet({ wo }: { wo: Wo }) {
  const s = useApp((x) => x);
  const team = deptStaff(s.staff, wo.dept);
  const [f, setF] = useState({ notes: '', cost: wo.estCost != null ? String(wo.estCost) : '', byId: defaultOf(team, s.me) });
  const [err, setErr] = useState<Errors>({});
  const submit = (): Errors => {
    const cost = money(f.cost);
    const e: Errors = { cost: cost == null ? 'Enter the actual cost (₱), zero or more.' : undefined };
    setErr(e);
    if (e.cost) return e;
    completeWo(wo.id, { actualCost: cost!, notes: f.notes.trim() || undefined, byId: f.byId || undefined });
    toast(wo.srcItemId ? `${wo.no} completed. The request item is closed too.` : `${wo.no} completed`, 'success');
    close();
    return {};
  };
  return (
    <FormSheet open title={`Complete ${wo.no}`} onClose={close} submitLabel="Complete" tone="ok" submit={submit}>
      <Field label="Completion notes" wide>{(p) => <textarea {...p} className="field" rows={2} value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} data-autofocus />}</Field>
      <Field label="Actual cost (₱)" error={err.cost}>{(p) => <input {...p} className="field" inputMode="decimal" value={f.cost} onChange={(e) => setF((x) => ({ ...x, cost: e.target.value }))} />}</Field>
      <Field label="By">{(p) => <Choice {...p} value={f.byId} onChange={(v) => setF((x) => ({ ...x, byId: v }))} options={opts(team, 'Me')} />}</Field>
    </FormSheet>
  );
}

/* ---------- Edit ---------- */

function EditSheet({ wo }: { wo: Wo }) {
  const s = useApp((x) => x);
  const depts = activeDepartments(s.catalog);
  const areas = areasOf(s.catalog);
  const out = wo.assignType === 'outsource';
  const start = {
    area: wo.area, loc: wo.loc, desc: wo.desc, priority: priorityKey(wo.priority), dept: wo.dept,
    assignee: wo.assignee ?? '', contractor: wo.contractor ?? '', requestedDate: wo.requestedDate == null ? '' : dayOf(wo.requestedDate),
  };
  const [f, setF] = useState(start);
  const [err, setErr] = useState<Errors>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const team = deptStaff(s.staff, f.dept);
  const submit = (): Errors => {
    const e: Errors = {
      desc: f.desc.trim() ? undefined : 'Description required.',
      contractor: out && !f.contractor.trim() ? 'Contractor required.' : undefined,
    };
    setErr(e);
    if (Object.values(e).some(Boolean)) return e;
    const ch: Parameters<typeof editWo>[1] = {};
    if (f.area !== start.area) ch.area = f.area;
    if (f.loc.trim() !== start.loc) ch.loc = f.loc.trim();
    if (f.desc.trim() !== start.desc) ch.desc = f.desc.trim();
    if (f.priority !== start.priority) ch.priority = f.priority as Priority;
    if (f.dept !== start.dept) ch.dept = f.dept;
    if (!out && f.assignee !== start.assignee) Object.assign(ch, f.assignee ? { assigneeId: f.assignee } : { clearAssignee: true });
    if (out && f.contractor.trim() !== start.contractor) ch.contractor = f.contractor.trim();
    if (f.requestedDate && f.requestedDate !== start.requestedDate) ch.requestedDate = f.requestedDate;
    if (!Object.keys(ch).length) {
      toast('Nothing to change.', 'info');
      close();
      return {};
    }
    editWo(wo.id, ch);
    toast(`${wo.no} saved`, 'success');
    close();
    return {};
  };
  const areaOpts = areas.includes(f.area) ? areas : [f.area, ...areas];
  return (
    <FormSheet open title={`Edit ${wo.no}`} onClose={close} submitLabel="Save" submit={submit}>
      <Field label="Area">{(p) => <Choice {...p} value={f.area} onChange={(v) => set('area', v)} options={areaOpts.map((a) => ({ value: a, label: a }))} />}</Field>
      <Field label="Location">{(p) => <input {...p} className="field" maxLength={80} value={f.loc} onChange={(e) => set('loc', e.target.value)} />}</Field>
      <Field label="Description" error={err.desc} wide>{(p) => <textarea {...p} className="field" rows={3} value={f.desc} onChange={(e) => set('desc', e.target.value)} />}</Field>
      <Field label="Priority">{(p) => <Choice {...p} value={f.priority} onChange={(v) => set('priority', v)} options={PRIORITIES.map((x) => ({ value: x, label: priorityLabel(x) }))} />}</Field>
      <Field label="Dept">{(p) => <Choice {...p} value={f.dept} onChange={(v) => set('dept', v)} options={(depts.some((d) => d.key === f.dept) ? depts : [{ key: f.dept, label: deptLabel(f.dept, s.catalog) }, ...depts]).map((d) => ({ value: d.key, label: d.label }))} />}</Field>
      {out
        ? <Field label="Assigned (contractor)" error={err.contractor}>{(p) => <input {...p} className="field" maxLength={120} value={f.contractor} onChange={(e) => set('contractor', e.target.value)} />}</Field>
        : <Field label="Assigned">{(p) => <Choice {...p} value={f.assignee} onChange={(v) => set('assignee', v)} options={opts(team.some((x) => x.id === f.assignee) || !f.assignee ? team : [...team, ...people(s.staff).filter((x) => x.id === f.assignee)], '—')} />}</Field>}
      <Field label="Requested date">{(p) => <input {...p} className="field" type="date" value={f.requestedDate} onChange={(e) => set('requestedDate', e.target.value)} />}</Field>
    </FormSheet>
  );
}

/** For the record pane: who a staff id is. Events from a manager's own account are by 'system'. */
export const nameOf = (s: Pick<State, 'staff'>, id?: string) => (!id ? '—' : id === 'system' || id === 'member' ? 'Manager' : s.staff.find((p) => p.id === id)?.name ?? 'Former staff');
