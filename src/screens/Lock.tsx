import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ROLE_LABEL } from '../domain/rules';
import { setUI, unlock, useApp, useUI } from '../domain/store';
import { staffApi } from '../domain/staffApi';
import { haptic, tone } from '../lib/haptics';
import { springs, useSafeMotion } from '../lib/motion';
import { Avatar, Icon } from '../ui/kit';

/** Fast PIN sign-in on a shared device. One tap on a name, four digits, in. */
export function Lock() {
  const all = useApp((s) => s.staff);
  const isRemote = useUI((s) => s.remote);
  // On the real desk everyone active is listed (the owner or manager account is not a PIN person).
  const staff = isRemote ? all.filter((p) => p.id !== 'member') : all.filter((p) => p.onShift);
  const [who, setWho] = useState(staff[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const [msg, setMsg] = useState('');
  const enter = useSafeMotion(20);
  const person = staff.find((p) => p.id === who);

  const press = (k: string) => {
    haptic('select');
    tone('tick');
    setErr(false);
    setMsg('');
    setPin((p) => (k === '<' ? p.slice(0, -1) : p.length < 4 ? p + k : p));
  };

  useEffect(() => {
    if (pin.length !== 4 || !who) return;
    let stale = false;
    const t = setTimeout(async () => {
      if (isRemote) {
        const r = await staffApi.current?.signIn(who, pin);
        if (stale) return;
        if (!r?.ok) {
          haptic('error');
          setErr(true);
          setMsg(r?.error ?? 'Could not check the PIN. Try again.');
          setPin('');
          return;
        }
      }
      haptic('success');
      tone('success');
      unlock(who);
    }, 220);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [pin, who, isRemote]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') press('<');
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  return (
    <main className="lockwrap" id="main">
      <motion.div {...enter} style={{ width: 'min(440px, 100%)', textAlign: 'center' }}>
        <div className="brand-mark" style={{ margin: '0 auto 14px', width: 48, height: 48, borderRadius: 14, background: 'var(--accent)', color: 'var(--on-accent)', display: 'grid', placeItems: 'center' }}><Icon name="bell" size={26} weight="fill" /></div>
        <h1 className="t-title1">Who’s on shift?</h1>
        <p className="t-sub c2" style={{ margin: '4px 0 0' }}>Pick your name, then enter your PIN.{!isRemote && ' Demo: any four digits work.'}</p>

        {staff.length === 0 && (
          <p className="t-body c2" style={{ margin: '24px 0' }}>No staff have been added yet. A manager can add people in Settings.</p>
        )}

        <div className="people" role="group" aria-label="Staff on shift">
          {staff.map((p) => (
            <button key={p.id} type="button" className="person" aria-pressed={p.id === who} onClick={() => { haptic('select'); setWho(p.id); setPin(''); }}>
              <Avatar staff={p} large />
              <span className="t-sub" style={{ fontWeight: 600 }}>{p.name.split(' ')[0]}</span>
              <span className="t-cap c2">{ROLE_LABEL[p.role]}</span>
            </button>
          ))}
        </div>

        <p className="t-head" aria-live="polite" style={{ margin: '6px 0 0' }}>{person?.name ?? ''}</p>
        <p className="t-sub" role="alert" style={{ margin: '4px 0 0', minHeight: '1.4em', color: 'var(--bad)' }}>{msg}</p>
        <span className="sr" role="status" aria-live="polite">{pin.length} of 4 digits entered</span>
        <motion.div className="pins" animate={err ? { x: [0, -8, 8, -6, 6, 0] } : {}} transition={{ duration: 0.3 }} role="img" aria-label={`${pin.length} of 4 digits entered`}>
          {[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
        </motion.div>
        <div className="keys" role="group" aria-label="PIN pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <motion.button key={k} type="button" className="key" whileTap={{ scale: 0.92 }} transition={springs.instant} onClick={() => press(k)}>{k}</motion.button>
          ))}
          <button type="button" className="key ghost" onClick={() => setUI({ screen: isRemote ? 'app' : 'cover' })}>{isRemote ? 'Back' : 'Cover'}</button>
          <motion.button type="button" className="key" whileTap={{ scale: 0.92 }} transition={springs.instant} onClick={() => press('0')}>0</motion.button>
          <button type="button" className="key ghost" aria-label="Delete" onClick={() => press('<')}><Icon name="undo" /></button>
        </div>
        <p className="t-foot c2" style={{ marginTop: 22 }}>Sessions stay open all shift. You only enter a PIN to switch people.</p>
      </motion.div>
    </main>
  );
}
