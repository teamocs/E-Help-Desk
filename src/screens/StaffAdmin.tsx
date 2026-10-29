import { useState } from 'react';
import { DEPTS, ROLE_LABEL } from '../domain/rules';
import { remote } from '../domain/remote';
import { staffApi } from '../domain/staffApi';
import { toast, useApp } from '../domain/store';
import type { Dept } from '../domain/types';
import { Avatar, Button, Group } from '../ui/kit';

const ROLES = ['hdo', 'staff', 'supervisor'] as const;

/** Real desk only: the owner or manager adds staff, sets their PINs and removes them. */
export function StaffAdmin() {
  const staff = useApp((s) => s.staff).filter((p) => p.id !== 'member');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('staff');
  const [dept, setDept] = useState<Dept | ''>('');
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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(() => api!.add({ name, title, role, dept: dept || null }, pin), `${name.trim()} added.`);
    if (ok) {
      setName('');
      setTitle('');
      setPin('');
    }
  }

  return (
    <>
      <Group title="Staff" note="Staff sign in on a shared phone with a four-digit PIN. PINs are never shown again; set a new one if it is forgotten.">
        {staff.length === 0 && <div className="row c2">No staff yet. Add the first person below.</div>}
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
        <h2 className="group-title">Add a person</h2>
        <div className="group" style={{ padding: 16, display: 'grid', gap: 14 }}>
          <div><label className="field-label" htmlFor="st-name">Full name</label><input id="st-name" className="field" autoComplete="off" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div><label className="field-label" htmlFor="st-title">Job title</label><input id="st-title" className="field" placeholder="e.g. Room attendant" autoComplete="off" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
          <div>
            <label className="field-label" htmlFor="st-role">Role</label>
            <select id="st-role" className="field" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="st-dept">Department</label>
            <select id="st-dept" className="field" value={dept} onChange={(e) => setDept(e.target.value as Dept | '')}>
              <option value="">No department</option>
              {(Object.keys(DEPTS) as Dept[]).map((d) => <option key={d} value={d}>{DEPTS[d].label}</option>)}
            </select>
          </div>
          <div><label className="field-label" htmlFor="st-pin">Four-digit PIN</label><input id="st-pin" className="field" type="password" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required /></div>
          {error && <p className="field-help" role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
          <button type="submit" className="btn btn-fill btn-block" disabled={busy || !name.trim() || !title.trim() || pin.length !== 4}>Add person</button>
        </div>
      </form>
    </>
  );
}
