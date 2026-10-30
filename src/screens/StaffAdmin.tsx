import { useState } from 'react';
import { activeDepartments, activeOf, MAX } from '../domain/catalog';
import { ROLE_LABEL } from '../domain/rules';
import { remote } from '../domain/remote';
import { staffApi } from '../domain/staffApi';
import { toast, useApp } from '../domain/store';
import { Avatar, Button, Group } from '../ui/kit';

const ROLES = ['hdo', 'staff', 'supervisor'] as const;

/**
 * Real desk only: the owner or manager adds staff, sets their PINs and removes them. `only="hdo"`: the help-desk
 * officers alone (Configuration, Help-Desk Staff), adding people with that job role.
 */
export function StaffAdmin({ only }: { only?: 'hdo' } = {}) {
  const staff = useApp((s) => s.staff).filter((p) => p.id !== 'member' && (!only || p.role === only));
  const px = only ? `st-${only}` : 'st';
  const [name, setName] = useState('');
  const [title, setTitle] = useState(only === 'hdo' ? 'Head Desk Officer' : '');
  const [role, setRole] = useState<(typeof ROLES)[number]>(only ?? 'staff');
  const [dept, setDept] = useState('');
  const catalog = useApp((s) => s.catalog);
  const [savingTitle, setSavingTitle] = useState(false);
  const [pin, setPin] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const api = staffApi.current;
  if (!api) return null;

  async function run(job: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(true);
    setError('');
    const r = await job();
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'Something went wrong.');
      return false;
    }
    toast(done, 'success');
    await remote.refresh(true);
    return true;
  }

  const typed = title.trim();
  const knownTitle = catalog.jobTitles.some((t) => t.label.toLowerCase() === typed.toLowerCase());
  const canAddTitle = typed.length > 0 && typed.length <= 40 && !knownTitle && catalog.jobTitles.length < MAX.jobTitles;

  /** One tap: the typed title joins the hotel's job titles (Settings, Lists), so it is suggested next time. */
  async function addTitle() {
    setSavingTitle(true);
    setError('');
    const items = [...catalog.jobTitles, { label: typed, active: true }];
    const r = await api!.saveList('jobTitles', items, catalog.catalogRev);
    setSavingTitle(false);
    if (r.ok) toast(`“${typed}” added to the job titles.`, 'success');
    else setError(r.error);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(() => api!.add({ name, title, role, dept: dept || null }, pin), `${name.trim()} added.`);
    if (ok) {
      setName('');
      setTitle(only === 'hdo' ? 'Head Desk Officer' : '');
      setPin('');
    }
  }

  return (
    <>
      <Group note={only ? 'Help-desk officers sign in with a PIN like everyone else. They are the people under Staff (PINs) whose role is Desk officer; a change here shows there too.' : 'Staff sign in on a shared phone with a four-digit PIN. PINs are never shown again; set a new one if it is forgotten.'}>
        {staff.length === 0 && <div className="row c2">{only ? 'No help-desk officers yet. Add the first one below.' : 'No staff yet. Add the first person below.'}</div>}
        {staff.map((p) => (
          <div key={p.id} className="row" style={{ flexWrap: 'wrap' }}>
            <Avatar staff={p} />
            <span className="grow">
              <span style={{ display: 'block' }}>{p.name}</span>
              <span className="t-foot c2">{p.title} · {ROLE_LABEL[p.role]}</span>
            </span>
            {editing === p.id ? (
              <form
                style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await run(() => api.setPin(p.id, newPin), `New PIN set for ${p.name}.`)) {
                    setEditing(null);
                    setNewPin('');
                  }
                }}
              >
                <input className="field" type="password" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={4} placeholder="New PIN" aria-label={`New PIN for ${p.name}`} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} style={{ width: '6.5rem' }} />
                <button type="submit" className="btn btn-fill btn-sm" disabled={busy || newPin.length !== 4}>Save</button>
              </form>
            ) : (
              <span style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="gray" aria-label={`Set a new PIN for ${p.name}`} onClick={() => { setEditing(p.id); setNewPin(''); setError(''); }}>Set PIN</Button>
                <Button size="sm" variant="gray" aria-label={`Remove ${p.name}`} onClick={() => { if (window.confirm(`Remove ${p.name}? They will no longer be able to sign in.`)) void run(() => api.remove(p.id), `${p.name} removed.`); }}>Remove</Button>
              </span>
            )}
          </div>
        ))}
      </Group>

      <form onSubmit={add}>
        <h3 className="group-title">{only ? 'Add a help-desk officer' : 'Add a person'}</h3>
        <div className="group" style={{ padding: 16, display: 'grid', gap: 14 }}>
          <div><label className="field-label" htmlFor={`${px}-name`}>Full name</label><input id={`${px}-name`} className="field" autoComplete="off" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div>
            <label className="field-label" htmlFor={`${px}-title`}>Job title</label>
            <input id={`${px}-title`} className="field" list={`${px}-titles`} placeholder="Pick or type a title" autoComplete="off" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby={`${px}-title-help`} required />
            <datalist id={`${px}-titles`}>{activeOf(catalog.jobTitles).map((t) => <option key={t.key} value={t.label} />)}</datalist>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <p className="field-help" id={`${px}-title-help`} style={{ margin: 0, flex: 1, minWidth: '12rem' }}>Suggestions come from Job Titles on this page. Any title works.</p>
              {canAddTitle && <button type="button" className="btn btn-plain btn-sm" disabled={savingTitle} onClick={() => void addTitle()}>{savingTitle ? 'Adding…' : `Add “${typed.length > 18 ? `${typed.slice(0, 18)}…` : typed}” to the list`}</button>}
            </div>
          </div>
          {!only && (
            <div>
              <label className="field-label" htmlFor="st-role">Role</label>
              <select id="st-role" className="field" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="field-label" htmlFor={`${px}-dept`}>Department</label>
            <select id={`${px}-dept`} className="field" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">No department</option>
              {activeDepartments(catalog).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
          <div><label className="field-label" htmlFor={`${px}-pin`}>Four-digit PIN</label><input id={`${px}-pin`} className="field" type="password" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required /></div>
          {error && <p className="field-help" role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
          <button type="submit" className="btn btn-fill btn-block" disabled={busy || !name.trim() || !title.trim() || pin.length !== 4}>{only ? 'Add help-desk officer' : 'Add person'}</button>
        </div>
      </form>
    </>
  );
}
