import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../ui/sheet';
import { AnimatePresence, motion } from 'motion/react';
import { HAZARDS } from '../domain/rules';
import { downgradeIncident, record911, resolveIncident, setUI, useApp, useUI } from '../domain/store';
import { haptic, tone } from '../lib/haptics';
import { springs } from '../lib/motion';
import { Button, Icon } from '../ui/kit';

/** Full-screen local alert. It never depends on the internet and it never replaces the radio or 911. */
export function Safety() {
  const sheet = useUI((s) => s.sheet);
  const id = useUI((s) => s.focusSafetyId);
  const open = sheet === 'safety' || sheet === 'incident';
  const inc = useApp((s) => s.incidents.find((i) => i.id === id));
  const me = useApp((s) => s.staff.find((p) => p.id === s.me));
  const live = inc?.status === 'active';

  useEffect(() => {
    if (!open || !live) return;
    const t = setInterval(() => { tone('alert'); haptic('error'); }, 5000);
    return () => clearInterval(t);
  }, [open, live]);

  const canSign = me?.role === 'manager' || me?.role === 'owner';
  const close = () => setUI({ sheet: null });
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open && !!inc, close);

  return (
    <AnimatePresence>
      {open && inc && (
        <motion.div key="takeover" ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="sf-title" aria-describedby="sf-desc" className={`takeover ${live ? '' : 'calm'}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <div className="takeover-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="siren" size={30} weight="fill" />
              <span className="t-head">{inc.no} · {HAZARDS[inc.hazard].label} · {inc.rooms.length > 1 ? `Rooms ${inc.rooms.join(', ')}` : `Room ${inc.rooms[0]}`}</span>
            </div>
            <h1 id="sf-title" className={`big ${live ? 'flash' : ''}`}>CALL 911 / RADIO FIRST, THEN LOG.</h1>
            <p id="sf-desc" className="t-body" style={{ margin: 0 }}>{HAZARDS[inc.hazard].call}</p>
            {inc.rooms.length > 1 && (
              <p className="t-sub" style={{ margin: 0 }}><b>{inc.rooms.length} rooms reported the same hazard within 15 minutes.</b> Treated as one incident, not {inc.rooms.length} tickets.</p>
            )}

            <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...springs.gentle, delay: 0.1 }} style={{ background: live ? 'rgba(255,255,255,0.14)' : 'var(--surface)', borderRadius: 16, padding: '14px 16px' }}>
              <p className="t-head" style={{ margin: 0 }}>Staff notified (not BFP/911)</p>
              <p className="t-sub" style={{ margin: '4px 0 0' }}>Everyone signed in to the help desk sees this alert within seconds. The help desk does not call BFP or 911 for you.</p>
              <hr style={{ border: 0, borderTop: '0.5px solid currentColor', opacity: 0.3, margin: '12px 0' }} />
              <p className="t-head" style={{ margin: 0 }}>BFP / 911 called by ____ at ____</p>
              {inc.called911 ? (
                <p className="t-sub" style={{ margin: '4px 0 0' }}>Recorded: {inc.called911.by} at {inc.called911.at}.</p>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <Button variant="fill" feel="medium" onClick={() => record911(inc.id, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}>I called 911 just now</Button>
                </div>
              )}
            </motion.div>

            <ul className="t-foot" style={{ margin: 0, paddingLeft: 18, opacity: 0.9 }}>
              {inc.log.slice(-3).map((l, i) => <li key={i}>{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {l.what}</li>)}
            </ul>

            <div style={{ display: 'grid', gap: 10 }}>
              <Button size="lg" variant="fill" feel="medium" onClick={close}>{live ? 'Acknowledge and keep open' : 'Close'}</Button>
              {live && <Button variant="gray" onClick={() => { downgradeIncident(inc.id); close(); }}>Downgrade to false alarm (logged)</Button>}
              {live && <Button variant="gray" disabled={!canSign} onClick={() => { resolveIncident(inc.id); close(); }}>{canSign ? 'Resolve with sign-off' : 'Resolve (manager sign-off required)'}</Button>}
            </div>
            <p className="t-foot" style={{ margin: 0, opacity: 0.85 }}>This app is a logbook and notifier. It is not a fire or life-safety system. Radios, the fire panel and written protocols stay primary.</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
