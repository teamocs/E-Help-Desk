import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { staffApi, type Login } from '../domain/staffApi';
import { toast } from '../domain/store';
import { Button, Group, Pill } from '../ui/kit';

type NewRole = 'manager' | 'supervisor' | 'device';
const ROLE: Record<Login['role'], string> = { owner: 'Hotel owner', manager: 'Manager', supervisor: 'Supervisor', device: 'Shared phone' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Hotel owner only: the people who sign in with their own email and password (not PIN staff). */
export function Logins() {
  const [list, setList] = useState<Login[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<NewRole>('manager');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const show = useCallback((r: Awaited<ReturnType<NonNullable<typeof staffApi.current>['logins']>>) => {
    if (r.ok) { setList(r.accounts); setLoadErr(''); } else setLoadErr(r.error);
  }, []);
  const load = useCallback(() => void staffApi.current?.logins().then(show), [show]);
  useEffect(() => {
    let live = true;
    void staffApi.current?.logins().then((r) => { if (live) show(r); });
    return () => { live = false; };
  }, [show]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    setError('');
    const r = await staffApi.current?.addLogin({ name, email, role });
    setBusy(false);
    if (!r?.ok) { setError(r?.error ?? 'Could not add the login.'); return; }
    toast(`${name.trim()} added. They get an email to set their password.`, 'success');
    setName('');
    setEmail('');
    void load();
  }

  async function toggle(a: Login) {
    const off = !a.disabled;
    if (off && !window.confirm(`Switch off ${a.name}'s login? They are signed out everywhere and cannot sign in until you switch it on again.`)) return;
    setBusy(true);
    const r = await staffApi.current?.setLoginDisabled(a.id, off);
    setBusy(false);
    if (!r?.ok) { toast(r?.error ?? 'Could not change the login.', 'error'); return; }
    toast(off ? `${a.name} can no longer sign in.` : `${a.name} can sign in again.`, 'success');
    void load();
  }

  return (
    <>
      <Group note="People who sign in with their own email: managers, supervisors and shared phones. Staff who use a PIN are listed under Staff.">
        {loadErr && <div className="row" role="alert"><span className="grow" style={{ color: 'var(--bad)' }}>{loadErr}</span><Button size="sm" variant="gray" onClick={() => void load()}>Try again</Button></div>}
        {!list && !loadErr && <div className="row c2" role="status">Loading logins…</div>}
        {list?.filter((a) => !a.self).length === 0 && <div className="row c2">No other logins yet. Add the first one below.</div>}
        {list?.map((a) => (
          <div key={a.id} className="row" style={{ flexWrap: 'wrap' }}>
            <span className="grow">
              <span style={{ display: 'block', fontWeight: 600 }}>{a.name}{a.self ? ' (you)' : ''}</span>
              <span className="t-foot c2" style={{ display: 'block' }}>{a.email} · {ROLE[a.role]}</span>
            </span>
            {a.disabled && <Pill tone="warn">Switched off</Pill>}
            {!a.self && <Button size="sm" variant={a.disabled ? 'tint' : 'gray'} disabled={busy} aria-label={`${a.disabled ? 'Switch on' : 'Switch off'} ${a.name}`} onClick={() => void toggle(a)}>{a.disabled ? 'Switch on' : 'Switch off'}</Button>}
          </div>
        ))}
      </Group>

      <form onSubmit={add} noValidate>
        <h3 className="group-title">Add login</h3>
        <div className="group" style={{ padding: 16, display: 'grid', gap: 14 }}>
          <div>
            <label className="field-label" htmlFor="lg-name">Name</label>
            <input id="lg-name" className="field" autoComplete="off" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="field-label" htmlFor="lg-email">Email</label>
            <input id="lg-email" className="field" type="email" inputMode="email" autoComplete="off" spellCheck={false} maxLength={100} value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby="lg-help" required />
            <p className="field-help" id="lg-help">They get an email to set their password.</p>
          </div>
          <div>
            <label className="field-label" htmlFor="lg-role">Role</label>
            <select id="lg-role" className="field" value={role} onChange={(e) => setRole(e.target.value as NewRole)}>
              <option value="manager">Manager: runs the desk and the staff list</option>
              <option value="supervisor">Supervisor: runs the desk, no staff list</option>
              <option value="device">Shared phone: every action needs a staff PIN</option>
            </select>
          </div>
          {error && <p className="field-help" role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
          <button type="submit" className="btn btn-fill btn-block" disabled={busy || !name.trim() || !email.trim()}>{busy ? 'Adding…' : 'Add login'}</button>
        </div>
      </form>
    </>
  );
}
