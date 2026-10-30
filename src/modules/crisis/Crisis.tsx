import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { HAZARDS } from '../../domain/rules';
import { myStaff, record911, setUI, toast, useApp, useUI } from '../../domain/store';
import type { Incident } from '../../domain/types';
import { Button, Empty, Icon, Pill, Screen } from '../../ui/kit';
import { Sheet } from '../../ui/sheet';
import { MATRIX, kindOfStaffRole, levelOf, type Level, type Matrix } from '../access';
import {
  callTime, casesOf, closeCase, codeLabel, crisisUI, editCase, emptyFields, entryOf, fieldsOf, isOpenCase, labelOf, linkAlert, listOf, logCase,
  monitorCase, openCase, openCaseFromAlert, problemOf, recordCase911, reopenCase, updateCase, when, whereText,
  type CaseFields, type CaseStatus, type CrisisCase, type ListEntry, type ListKey,
} from './model';
import './crisis.css';

const FIRST_LINE = 'CALL 911 / RADIO FIRST, THEN LOG.';
const ALERT_STATUS: Record<Incident['status'], { text: string; tone: 'bad' | 'ok' | '' }> = {
  active: { text: 'Active', tone: 'bad' },
  downgraded: { text: 'False alarm', tone: '' },
  resolved: { text: 'Resolved', tone: 'ok' },
};
const CASE_STATUS: Record<CaseStatus, { text: string; tone: 'warn' | 'accent' | 'ok' }> = {
  active: { text: 'Active', tone: 'warn' },
  monitoring: { text: 'Monitoring', tone: 'accent' },
  resolved: { text: 'Closed', tone: 'ok' },
};
type Filter = 'open' | 'monitoring' | 'resolved' | 'all';
const FILTERS: { value: Filter; label: string; keep: (c: CrisisCase) => boolean }[] = [
  { value: 'open', label: 'Open', keep: isOpenCase },
  { value: 'monitoring', label: 'Monitoring', keep: (c) => c.status === 'monitoring' },
  { value: 'resolved', label: 'Closed', keep: (c) => c.status === 'resolved' },
  { value: 'all', label: 'All', keep: () => true },
];
const rooms = (r: string[]) => (r.length > 1 ? `Rooms ${r.join(', ')}` : `Room ${r[0]}`);

/** This viewer's level on Crisis Mgmt, as the server decides it (window.AZL.access, Azl_Access::level). */
function useCrisisLevel(): Level {
  const role = useUI((s) => s.account.role);
  const accountModules = useUI((s) => s.account.modules);
  const access = useUI((s) => s.access);
  const me = useApp(myStaff);
  const matrix: Matrix = { ...MATRIX, ...access };
  const fromServer = accountModules && Object.keys(accountModules).length > 0 ? accountModules : null;
  if (role !== 'device') return fromServer ? (fromServer.crisis ?? 'none') : levelOf('crisis', { kind: role }, matrix);
  return levelOf('crisis', { kind: kindOfStaffRole(me?.role), dept: me?.dept }, matrix);
}

const useList = (key: ListKey) => useApp((s) => listOf(s, key));
const useOpenId = () => useSyncExternalStore(crisisUI.sub, () => crisisUI.get().open, () => crisisUI.get().open);

/** The first line of every Crisis screen (brief section 6). Calm, never a button: nothing stands before the radio. */
function FirstLine({ compact }: { compact?: boolean }) {
  return (
    <div className={`cr-first ${compact ? 'compact' : ''}`} role="note">
      <Icon name="phone" weight="fill" size={compact ? 18 : 22} />
      <span><b>{FIRST_LINE}</b>{!compact && ' This desk is a logbook and notifier. Radios, the fire panel and written protocols stay primary.'}</span>
    </div>
  );
}

/**
 * Crisis Mgmt: the safety alerts first (each opens the full-screen alert with its 911 recording and sign-off, as
 * before), then the crisis case log by radio code: cards, filters, "Log a case", and each case's details, updates,
 * Monitor, Close with a resolution, Reopen and Edit.
 */
export function Crisis() {
  const incidents = useApp((s) => s.incidents);
  const cases = useApp(casesOf);
  const codes = useList('crisisCodes');
  const cats = useList('complaintCategories');
  const locations = useList('crisisLocations');
  const level = useCrisisLevel();
  const canChange = level === 'own' || level === 'full';
  const [filter, setFilter] = useState<Filter>('open');
  const [logging, setLogging] = useState<number | null>(null); // when the form opened: its default time
  const openId = useOpenId();
  const live = incidents.filter((i) => i.status === 'active').length;
  const shown = cases.filter(FILTERS.find((f) => f.value === filter)!.keep);
  const caseFor = (inc: Incident) => cases.find((c) => c.incidentId === inc.id);

  return (
    <Screen title="Crisis Management" subtitle="Safety alerts and crisis cases">
      <FirstLine />

      {incidents.length > 0 && (
        <section aria-labelledby="alerts-title" className="dash-panel">
          <div className="dash-head">
            <h2 id="alerts-title" className="dash-h">Safety alerts</h2>
            <span className="t-sub c2">{live ? `${live} active` : 'None active'}</span>
          </div>
          <ul className="cards" role="list">
            {incidents.map((inc) => {
              const st = ALERT_STATUS[inc.status];
              const last = inc.log[inc.log.length - 1];
              const linked = caseFor(inc);
              return (
                <li key={inc.id} className={`cr-alert ${inc.status}`}>
                  <button type="button" className="cr-alert-main" onClick={() => setUI({ sheet: 'incident', focusSafetyId: inc.id })} aria-label={`${inc.no}, ${HAZARDS[inc.hazard].label}, ${st.text}. Open the alert`}>
                    <span className="case-top">
                      <span className="t-head">{inc.no} · {HAZARDS[inc.hazard].label}</span>
                      <Pill tone={st.tone}>{st.text}</Pill>
                    </span>
                    <span className="t-sub">{rooms(inc.rooms)} · {when(inc.createdAt)}</span>
                    <span className="t-body case-text">“{inc.text}”</span>
                    <span className="t-foot c2">
                      Staff notified (not BFP/911) · {inc.called911 ? `BFP/911 called by ${inc.called911.by} at ${callTime(inc.called911.at)}` : 'BFP/911 call not recorded'}
                      {last ? ` · Last: ${last.what}` : ''}
                    </span>
                    <span className="case-open t-sub">{inc.status === 'active' ? 'Open the alert' : 'View'} <Icon name="chev" size={16} /></span>
                  </button>
                  {(linked || canChange) && (
                    <div className="cr-alert-foot">
                      {linked ? (
                        <Button size="sm" variant="gray" onClick={() => openCase(linked.id)} aria-label={`Open case ${linked.no}, logged from ${inc.no}`}>Case {linked.no}</Button>
                      ) : (
                        <Button size="sm" variant="gray" icon="note" onClick={() => openCaseFromAlert(inc)} aria-label={`Open a case from ${inc.no}`}>Open a case</Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="cases-title" className="dash-panel">
        <div className="dash-head">
          <h2 id="cases-title" className="dash-h">Crisis cases</h2>
          {cases.length > 0 && <span className="t-sub c2">{cases.filter(isOpenCase).length} open</span>}
        </div>
        <div className="modbar" role="group" aria-label="Crisis case actions and filter">
          {canChange && <Button size="sm" icon="plus" onClick={() => setLogging(Date.now())}>Log a case</Button>}
          {cases.length > 0 && (
            <span className="cr-filters" role="group" aria-label="Show">
              {FILTERS.map((f) => (
                <button key={f.value} type="button" className="chip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                  {f.label} <span className="tnum">{cases.filter(f.keep).length}</span>
                </button>
              ))}
            </span>
          )}
        </div>
        {cases.length === 0 ? (
          <Empty
            icon="siren"
            text={incidents.length === 0
              ? 'No crisis cases and no safety alerts in the last 7 days. Log a case by radio code (10-9 medical, 10-28 guest complaint, 10-1 fire and the rest) after you have called for help. When a request mentions smoke, gas, flooding, a medical emergency, a threat or someone stuck in a lift, the safety alert appears here by itself.'
              : 'No crisis cases yet. Log one by radio code after you have called for help, or open one from a safety alert above.'}
            action={canChange ? 'Log a case' : undefined}
            onAction={() => setLogging(Date.now())}
          />
        ) : shown.length === 0 ? (
          <p className="t-sub c2 cr-none">{filter === 'resolved' ? 'No cases closed in the last 30 days.' : filter === 'monitoring' ? 'No case is being monitored.' : 'No open cases. Every case is closed.'}</p>
        ) : (
          <ul className="cards" role="list">
            {shown.map((c) => (
              <li key={c.id}>
                <CaseCard c={c} codes={codes} cats={cats} locations={locations} alertNo={c.incidentId ? c.incident?.no ?? incidents.find((i) => i.id === c.incidentId)?.no ?? "Safety alert" : undefined} />
              </li>
            ))}
          </ul>
        )}
        {!canChange && <p className="t-foot c2">You can read the crisis log. The help desk, supervisors and managers log cases.</p>}
      </section>

      <Sheet open={logging !== null} onClose={() => setLogging(null)} title="Log a case">
        {logging !== null && (
          <CaseForm
            initial={emptyFields(logging)}
            submit="Log case"
            onSubmit={(f) => {
              const id = logCase(f);
              setLogging(null);
              toast('Case logged. Add updates as it goes.', 'success');
              openCase(id);
            }}
          />
        )}
      </Sheet>
      <CaseSheet id={openId} level={level} />
    </Screen>
  );
}

function CaseCard({ c, codes, cats, locations, alertNo }: { c: CrisisCase; codes: ListEntry[]; cats: ListEntry[]; locations: ListEntry[]; alertNo?: string }) {
  const st = CASE_STATUS[c.status];
  const where = whereText(locations, c);
  const last = c.updates[c.updates.length - 1];
  const title = c.code ? codeLabel(codes, c.code) : 'Guest complaint';
  return (
    <button type="button" className={`cr-card ${c.status}`} onClick={() => openCase(c.id)} aria-label={`${c.no}, ${title}, ${st.text}. Open the case`}>
      <span className="case-top">
        <span className="t-head">{c.no} · {title}</span>
        <Pill tone={st.tone}>{st.text}</Pill>
      </span>
      <span className="t-sub c2">
        {[c.category && labelOf(cats, c.category), where, when(c.occurredAt)].filter(Boolean).join(' · ')}
        {alertNo && <span className="cr-chip"><Icon name="siren" size={14} /> {alertNo}</span>}
      </span>
      {c.what ? <span className="t-body case-text">{c.what}</span> : <span className="t-body c2">What happened: not written yet</span>}
      <span className="t-foot c2">
        Reported by {c.reportedBy || c.loggedBy}
        {c.status === 'resolved' && c.resolution ? ` · Resolution: ${c.resolution}` : last ? ` · Last: ${last.text}` : ''}
      </span>
    </button>
  );
}

/* ---------- one case ---------- */

type Mode = 'view' | 'update' | 'monitor' | 'close' | 'edit';

function CaseSheet({ id, level }: { id?: string; level: Level }) {
  const c = useApp((s) => casesOf(s).find((x) => x.id === id));
  const [mode, setMode] = useState<Mode>('view');
  const close = () => { setMode('view'); openCase(undefined); };
  const title = c ? (mode === 'view' ? c.no : `${c.no} · ${MODE_TITLE[mode]}`) : '';
  return (
    <Sheet open={!!c} onClose={close} title={title}>
      {c && (mode === 'view'
        ? <CaseView c={c} level={level} setMode={setMode} />
        : mode === 'edit'
          ? <CaseForm initial={fieldsOf(c)} hasAlert={!!c.incidentId} submit="Save changes" onCancel={() => setMode('view')} onSubmit={(f) => { editCase(c.id, f); toast('Case updated.', 'success'); setMode('view'); }} />
          : <NoteForm c={c} mode={mode} done={() => setMode('view')} />)}
    </Sheet>
  );
}
const MODE_TITLE: Record<Exclude<Mode, 'view'>, string> = { update: 'Add an update', monitor: 'Monitor', close: 'Close case', edit: 'Edit' };

function Line({ k, children }: { k: string; children: ReactNode }) {
  return <div className="cr-line"><dt className="c2">{k}</dt><dd>{children}</dd></div>;
}

function CaseView({ c, level, setMode }: { c: CrisisCase; level: Level; setMode: (m: Mode) => void }) {
  const codes = useList('crisisCodes');
  const cats = useList('complaintCategories');
  const types = useList('involvedTypes');
  const locations = useList('crisisLocations');
  const incidents = useApp((s) => s.incidents);
  const alert = useApp((s) => s.incidents.find((i) => i.id === c.incidentId));
  const [linking, setLinking] = useState('');
  const canChange = level === 'own' || level === 'full';
  const canClose = level === 'full';
  const st = CASE_STATUS[c.status];
  const linkable = incidents.filter((i) => i.id !== c.incidentId);
  // The alert's live record (this desk's copy) wins over the summary that came with the case.
  const linked = c.incident ? { ...c.incident, ...(alert ? { status: alert.status, called911: alert.called911 ?? null } : {}) } : null;
  const who = [c.who, c.whoType && labelOf(types, c.whoType)].filter(Boolean);

  return (
    <div className="cr-view">
      <FirstLine compact />
      <div className="cr-view-head">
        <h3 className="t-title3">{c.code ? codeLabel(codes, c.code) : 'Guest complaint'}</h3>
        <Pill tone={st.tone}>{st.text}</Pill>
      </div>
      <dl className="cr-lines">
        {c.category && <Line k="Category">{labelOf(cats, c.category)}</Line>}
        <Line k="When">{when(c.occurredAt)}</Line>
        <Line k="Where">{whereText(locations, c) || 'Not given'}</Line>
        <Line k="Who">{who.length ? (who.length === 2 ? `${who[0]} (${who[1]})` : who[0]) : 'Not given'}</Line>
        <Line k="Reported by">{c.reportedBy || 'Not given'}</Line>
        <Line k="Logged by">{c.loggedBy} · {when(c.createdAt)}</Line>
        <Line k="What happened">{c.what || <span className="c2">Not written yet{canChange && c.status !== 'resolved' ? '. Use Edit to add it.' : '.'}</span>}</Line>
        {c.resolution && <Line k="Resolution">{c.resolution}</Line>}
      </dl>

      {linked ? (
        <section className="cr-box" aria-label={`Safety alert ${linked.no}`}>
          <p className="t-head" style={{ margin: 0 }}>
            <Icon name="siren" size={18} /> Safety alert {linked.no} · {HAZARDS[linked.hazard].label} · {rooms(linked.rooms)}
          </p>
          <p className="t-sub" style={{ margin: 0 }}>{ALERT_STATUS[linked.status].text} · started {when(linked.createdAt)} · Staff notified (not BFP/911)</p>
          <p className="t-sub" style={{ margin: 0 }}>
            {linked.called911 ? <>BFP/911 called by <b>{linked.called911.by}</b> at <b>{callTime(linked.called911.at)}</b></> : 'BFP/911 called by ____ at ____ (not recorded yet)'}
          </p>
          <div className="cr-row">
            <Button size="sm" variant="gray" onClick={() => setUI({ sheet: 'incident', focusSafetyId: linked.id })}>Open the alert</Button>
            {!linked.called911 && alert && canChange && (
              <Button size="sm" variant="gray" onClick={() => { record911(linked.id, new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })); toast(`911 call recorded on ${linked.no}.`, 'success'); }}>I called 911 just now</Button>
            )}
          </div>
        </section>
      ) : (
        <section className="cr-box" aria-label="911 call">
          <p className="t-head" style={{ margin: 0 }}>BFP / 911 called by ____ at ____</p>
          {c.called911 ? (
            <p className="t-sub" style={{ margin: 0 }}>Recorded: <b>{c.called911.by}</b> at <b>{callTime(c.called911.at)}</b>.</p>
          ) : (
            <>
              <p className="t-sub c2" style={{ margin: 0 }}>The help desk does not call BFP or 911 for you. Record the call here once it is made.</p>
              {canChange && <div className="cr-row"><Button size="sm" variant="gray" onClick={() => { recordCase911(c.id); toast('911 call recorded.', 'success'); }}>I called 911 just now</Button></div>}
            </>
          )}
          {canChange && linkable.length > 0 && (
            <LinkPicker incidents={linkable} value={linking} onChange={setLinking} onLink={() => {
              const inc = linkable.find((i) => i.id === linking);
              if (inc) { linkAlert(c.id, inc); toast(`Linked to ${inc.no}.`, 'success'); setLinking(''); }
            }} />
          )}
        </section>
      )}

      <section aria-labelledby={`upd-${c.id}`}>
        <h3 id={`upd-${c.id}`} className="group-title">Updates ({c.updates.length})</h3>
        {c.updates.length === 0 ? (
          <p className="t-sub c2" style={{ margin: '0 4px' }}>No updates yet.</p>
        ) : (
          <ol className="cr-thread">
            {c.updates.map((u, i) => (
              <li key={i}><span className="t-foot c2">{when(u.at)} · {u.by}</span><span className="t-body case-text">{u.text}</span></li>
            ))}
          </ol>
        )}
      </section>

      {canChange && (
        <div className="cr-actions">
          {c.status !== 'resolved' && <Button size="sm" icon="plus" onClick={() => setMode('update')}>Update</Button>}
          {c.status === 'active' && <Button size="sm" variant="gray" onClick={() => setMode('monitor')}>Monitor</Button>}
          {c.status !== 'resolved' && (canClose
            ? <Button size="sm" variant="gray" onClick={() => setMode('close')}>Close</Button>
            : <Button size="sm" variant="gray" disabled title="A supervisor or manager closes a case">Close (supervisor or manager)</Button>)}
          {c.status === 'resolved' && <Button size="sm" variant="gray" icon="undo" onClick={() => { reopenCase(c.id); toast(`${c.no} reopened, under monitoring.`, 'success'); }}>Reopen</Button>}
          <Button size="sm" variant="gray" onClick={() => setMode('edit')}>Edit</Button>
        </div>
      )}
      {canChange && !canClose && c.status !== 'resolved' && <p className="t-foot c2" style={{ margin: 0 }}>Closing a case needs a supervisor or manager: they sign in with their PIN on this phone.</p>}
    </div>
  );
}

function LinkPicker({ incidents, value, onChange, onLink }: { incidents: Incident[]; value: string; onChange: (v: string) => void; onLink: () => void }) {
  const fid = useId();
  return (
    <div className="cr-link">
      <label className="field-label" htmlFor={fid}>Link a safety alert</label>
      <div className="cr-row">
        <select id={fid} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose an alert…</option>
          {incidents.map((i) => <option key={i.id} value={i.id}>{i.no} · {HAZARDS[i.hazard].label} · {rooms(i.rooms)} · {when(i.createdAt)}</option>)}
        </select>
        <Button size="sm" variant="gray" disabled={!value} onClick={onLink}>Link</Button>
      </div>
    </div>
  );
}

function NoteForm({ c, mode, done }: { c: CrisisCase; mode: 'update' | 'monitor' | 'close'; done: () => void }) {
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const fid = useId();
  const label = mode === 'close' ? 'Final resolution' : mode === 'monitor' ? 'Monitoring note' : 'Update';
  const missing = !text.trim();
  const save = () => {
    setTried(true);
    if (missing) return;
    if (mode === 'close') { closeCase(c.id, text); toast(`${c.no} closed.`, 'success'); }
    else if (mode === 'monitor') { monitorCase(c.id, text); toast(`${c.no} under monitoring.`, 'success'); }
    else { updateCase(c.id, text); toast('Update added.', 'success'); }
    done();
  };
  return (
    <form className="cr-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
      <FirstLine compact />
      <label className="field-label" htmlFor={fid}>{label}<span className="c2" aria-hidden="true"> *</span></label>
      <textarea id={fid} className="field" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} data-autofocus autoFocus aria-required="true" aria-invalid={tried && missing} aria-describedby={`${fid}-h`}
        placeholder={mode === 'close' ? 'e.g. Guest released from hospital, back in the room' : mode === 'monitor' ? 'e.g. Guest resting, nurse checks every 30 minutes' : 'e.g. Ambulance arrived 10:12'} />
      <p id={`${fid}-h`} className={`field-help ${tried && missing ? 'cr-error' : ''}`} role={tried && missing ? 'alert' : undefined}>
        {tried && missing ? `Write the ${label.toLowerCase()}.` : mode === 'close' ? 'A case closes only with its resolution. It stays in the log and can be reopened.' : 'Added to the case log with your name and the time.'}
      </p>
      <div className="cr-actions">
        <Button variant="gray" onClick={done}>Cancel</Button>
        <button type="submit" className="btn btn-fill">{mode === 'close' ? 'Close case' : mode === 'monitor' ? 'Monitor' : 'Add update'}</button>
      </div>
    </form>
  );
}

/* ---------- the case form: log and edit ---------- */

function Select({ label, value, onChange, list, none, keep, first }: { label: string; value: string; onChange: (v: string) => void; list: ListEntry[]; none: string; keep?: string; first?: boolean }) {
  const fid = useId();
  // Archived entries are not offered, except the one this case already has.
  const options = list.filter((e) => e.active || e.key === keep);
  return (
    <div className="cr-field">
      <label className="field-label" htmlFor={fid}>{label}</label>
      <select id={fid} className="field" value={value} autoFocus={first} data-autofocus={first || undefined} onChange={(e) => onChange(e.target.value)}>
        <option value="">{none}</option>
        {options.map((e) => <option key={e.key} value={e.key}>{e.code ? `${e.code} ${e.label}` : e.label}</option>)}
      </select>
    </div>
  );
}
function Text({ label, value, onChange, max, help, placeholder, area }: { label: string; value: string; onChange: (v: string) => void; max: number; help?: string; placeholder?: string; area?: boolean }) {
  const fid = useId();
  return (
    <div className={`cr-field ${area ? 'wide' : ''}`}>
      <label className="field-label" htmlFor={fid}>{label}</label>
      {area
        ? <textarea id={fid} className="field" rows={3} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-describedby={help ? `${fid}-h` : undefined} />
        : <input id={fid} className="field" maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-describedby={help ? `${fid}-h` : undefined} />}
      {help && <p id={`${fid}-h`} className="field-help">{help}</p>}
    </div>
  );
}

export function CaseForm({ initial, submit, onSubmit, onCancel, hasAlert = false }: { initial: CaseFields; submit: string; onSubmit: (f: CaseFields) => void; onCancel?: () => void; hasAlert?: boolean }) {
  const codes = useList('crisisCodes');
  const cats = useList('complaintCategories');
  const types = useList('involvedTypes');
  const locations = useList('crisisLocations');
  const [f, setF] = useState(initial);
  const [tried, setTried] = useState(false);
  const timeId = useId();
  const set = (p: Partial<CaseFields>) => setF((x) => ({ ...x, ...p }));
  const code = entryOf(codes, f.code);
  const showCategory = !f.code || !!code?.complaint;
  const detail = entryOf(locations, f.location)?.detail;
  const problem = problemOf(f, codes, hasAlert);
  return (
    <form className="cr-form" onSubmit={(e) => { e.preventDefault(); setTried(true); if (!problem) onSubmit(f); }} noValidate>
      <FirstLine compact />
      <p className="t-sub c2" style={{ margin: 0 }}>Only the radio code (or a complaint category) is needed now. Fill in the rest when the situation allows.</p>
      <div className="cr-grid">
        <Select first label="Radio code" value={f.code} none="Choose a radio code…" list={codes} keep={initial.code} onChange={(v) => set({ code: v, category: v && !entryOf(codes, v)?.complaint ? '' : f.category })} />
        {showCategory && <Select label="Complaint category" value={f.category} none={f.code ? 'Choose a category…' : 'None'} list={cats} keep={initial.category} onChange={(v) => set({ category: v })} />}
        <Text label="Reported by" value={f.reportedBy} max={120} placeholder="e.g. FO Staff 2" onChange={(v) => set({ reportedBy: v })} />
        <Select label="Involved (type)" value={f.whoType} none="Not given" list={types} keep={initial.whoType} onChange={(v) => set({ whoType: v })} />
        <Text label="Involved (name)" value={f.who} max={120} placeholder="e.g. Mr. Park" onChange={(v) => set({ who: v })} />
        <Select label="Where" value={f.location} none="Not specified" list={locations} keep={initial.location} onChange={(v) => set({ location: v, place: entryOf(locations, v)?.detail ? f.place : '' })} />
        {detail && <Text label={detail} value={f.place} max={80} placeholder={f.location === 'room' ? 'e.g. 405' : undefined} onChange={(v) => set({ place: v })} />}
        <div className="cr-field">
          <label className="field-label" htmlFor={timeId}>When</label>
          <input id={timeId} className="field" type="datetime-local" value={f.occurred} onChange={(e) => set({ occurred: e.target.value })} aria-describedby={`${timeId}-h`} />
          <p id={`${timeId}-h`} className="field-help">Hotel time (Manila).</p>
        </div>
        <Text area label="What happened" value={f.what} max={2000} help="Optional now. Add it when you can." placeholder="e.g. Guest fainted in the lobby" onChange={(v) => set({ what: v })} />
      </div>
      {tried && problem && <p className="field-help cr-error" role="alert">{problem}.</p>}
      <div className="cr-actions">
        {onCancel && <Button variant="gray" onClick={onCancel}>Cancel</Button>}
        <button type="submit" className="btn btn-fill" aria-disabled={!!problem || undefined}>{submit}</button>
      </div>
    </form>
  );
}
