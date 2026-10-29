import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { activeOf } from '../domain/catalog';
import { HAZARDS, detectSafety } from '../domain/rules';
import { logRequest, raiseSafety, setUI, toast, ui, useApp, useUI } from '../domain/store';
import { haptic, tone } from '../lib/haptics';
import { springs } from '../lib/motion';
import { Button, Group, Icon } from '../ui/kit';
import { Sheet } from '../ui/sheet';

function Body() {
  const seed = useUI((s) => s.composerSeed);
  const requests = useApp((s) => s.requests);
  const catalog = useApp((s) => s.catalog);
  const types = useMemo(() => activeOf(catalog.requestTypes), [catalog]);
  const bundles = useMemo(() => activeOf(catalog.bundles), [catalog]);
  // The rooms of the latest tickets, newest first, for one-tap repeat requests.
  const recent = useMemo(() => [...new Set([...requests].sort((a, b) => b.createdAt - a.createdAt).map((r) => r.room))].slice(0, 5), [requests]);
  const [room, setRoom] = useState(seed?.room ?? '');
  const [vip, setVip] = useState(false);
  const [presets, setPresets] = useState<string[]>(seed?.preset && types.some((t) => t.key === seed.preset) ? [seed.preset] : []);
  const [bundle, setBundle] = useState<string | undefined>();
  const [remarks, setRemarks] = useState(seed?.text ?? '');

  const hazard = useMemo(() => detectSafety(remarks), [remarks]);
  const ready = room.length >= 3 && (presets.length > 0 || !!bundle);
  const key = (k: string) => {
    haptic('select');
    tone('tick');
    if (k === 'C') setRoom('');
    else if (k === '<') setRoom((r) => r.slice(0, -1));
    else setRoom((r) => (r.length < 4 ? r + k : r));
  };

  const finish = (later: boolean) => {
    logRequest({ room, presets: later ? [] : presets, bundle: later ? undefined : bundle, remarks: remarks.trim() || undefined, later, vip });
    haptic('success');
    tone('success');
    toast(later ? `Room ${room} saved. Add what they need from Finish logging.` : `Room ${room} logged and sent to the right teams.`, 'success');
    setUI({ sheet: null, selItem: undefined });
  };

  const raise = () => {
    if (!hazard) return;
    const r = raiseSafety(room || '—', remarks, hazard);
    setUI({ sheet: 'safety', focusSafetyId: r.id });
  };

  return (
    <div onKeyDown={(e) => { if (/^[0-9]$/.test(e.key) && (e.target as HTMLElement).tagName !== 'TEXTAREA') key(e.key); if (e.key === 'Backspace' && (e.target as HTMLElement).tagName !== 'TEXTAREA') key('<'); }}>
      <p className="t-sub c2" style={{ margin: 0 }}>Room, then what they need. No typing required.</p>

      <Group title="Room">
        <div className="row" style={{ justifyContent: 'center', minHeight: '4.2rem' }}>
          <output className="t-large" aria-live="polite" aria-label={room ? `Room ${room}` : 'No room entered'} style={{ letterSpacing: '0.06em', color: room ? 'var(--fg)' : 'var(--fg-2)' }}>{room || '– – –'}</output>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {recent.length > 0 && <span className="t-foot c2" id="recent-rooms">Recent</span>}
          {recent.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={room === r} aria-describedby="recent-rooms" onClick={() => { haptic('select'); setRoom(r); }}>{r}</button>
          ))}
          <button type="button" className="chip" aria-pressed={vip} style={{ marginLeft: 'auto' }} onClick={() => { haptic('select'); setVip((v) => !v); }}><Icon name="star" size={16} weight={vip ? 'fill' : 'regular'} /> VIP guest</button>
        </div>
        <div className="keys" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: 0, padding: '10px 16px 14px', maxWidth: 340, marginInline: 'auto' }} role="group" aria-label="Room number pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <motion.button key={k} type="button" className="key" style={{ width: '100%', height: '3.3rem', borderRadius: 14, fontSize: '1.4rem' }} whileTap={{ scale: 0.94 }} onClick={() => key(k)}>{k}</motion.button>
          ))}
          <motion.button type="button" className="key ghost" style={{ width: '100%', height: '3.3rem' }} whileTap={{ scale: 0.94 }} onClick={() => key('C')} aria-label="Clear room">Clear</motion.button>
          <motion.button type="button" className="key" style={{ width: '100%', height: '3.3rem', borderRadius: 14, fontSize: '1.4rem' }} whileTap={{ scale: 0.94 }} onClick={() => key('0')}>0</motion.button>
          <motion.button type="button" className="key ghost" style={{ width: '100%', height: '3.3rem' }} whileTap={{ scale: 0.94 }} onClick={() => key('<')} aria-label="Delete last digit"><Icon name="backspace" /></motion.button>
        </div>
      </Group>

      <Group title="What they need">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {types.length === 0 && bundles.length === 0 && <span className="t-sub c2">No request types yet. A manager adds them in Settings, Lists. You can still log the room now.</span>}
          {bundles.map((b) => (
            <button key={b.key} type="button" className="chip" style={{ background: bundle === b.key ? undefined : 'var(--accent-soft)', color: bundle === b.key ? undefined : 'var(--accent-strong)' }} aria-pressed={bundle === b.key} onClick={() => { haptic('medium'); setBundle(bundle === b.key ? undefined : b.key); }} title={b.hint}>
              <Icon name="bolt" size={16} weight="fill" /> {b.label} bundle
            </button>
          ))}
          {types.map((p) => (
            <button key={p.key} type="button" className="chip" aria-pressed={presets.includes(p.key)} onClick={() => { haptic('select'); setPresets((x) => (x.includes(p.key) ? x.filter((k) => k !== p.key) : [...x, p.key])); }}>
              <Icon name={p.icon} size={16} /> {p.label}
            </button>
          ))}
        </div>
        {(() => {
          const b = bundles.find((x) => x.key === bundle);
          if (!b) return null;
          const waits = b.parts.some((p) => p.after != null);
          return <p className="row t-foot c2" style={{ margin: 0 }}>{[b.hint, waits ? 'Later steps wait until the earlier ones are done.' : ''].filter(Boolean).join('. ').replace(/\.\./g, '.')}</p>;
        })()}
      </Group>

      <Group title="Remark (optional)" note="Safety words in English, Tagalog and Bikol are checked on this device, with or without internet.">
        <div className="row">
          <textarea className="field" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add detail only if it helps." aria-label="Remark" />
        </div>
      </Group>

      <AnimatePresence>
        {hazard && (
          <motion.div initial={{ opacity: 0, y: 10, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={springs.snappy} style={{ overflow: 'hidden' }} role="alert">
            <div className="banner bad" style={{ marginTop: 14 }}>
              <Icon name="siren" weight="fill" />
              <div>
                <b>Possible safety issue: {HAZARDS[hazard].label.toLowerCase()}.</b>
                <p className="t-sub" style={{ margin: '4px 0 0' }}>CALL 911 / RADIO FIRST, THEN LOG. {HAZARDS[hazard].call}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <Button variant="fill" feel="error" onClick={raise}>Raise safety alert</Button>
                  <Button variant="gray" onClick={() => setRemarks('')}>False alarm, clear</Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
        <Button size="lg" block feel="success" disabled={!ready || !!hazard} onClick={() => finish(false)}>Log request</Button>
        <Button size="lg" block variant="gray" disabled={room.length < 3} onClick={() => finish(true)}>Log it later (room only)</Button>
      </div>
    </div>
  );
}

export function Composer() {
  const open = useUI((s) => s.sheet === 'composer');
  return (
    <Sheet open={open} title="New request" onClose={() => ui.set((s) => ({ ...s, sheet: null }))}>
      <Body />
    </Sheet>
  );
}
