import { motion } from 'motion/react';
import { isOpen } from '../domain/rules';
import {
  app, assessWo, ackHandover, completeWo, escalate, finishItem, go, logRequest, onSite, openComposer, raiseSafety, relay, resetApp, returnOrphans,
  setNet, setPref, setUI, startWo, toast, ui, unlock, useUI,
} from '../domain/store';
import { haptic } from '../lib/haptics';
import { springs } from '../lib/motion';
import { Button, Icon } from '../ui/kit';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => app.get();
let lastReq: string | undefined;
const itemsOf = (rid: string) => st().requests.find((r) => r.id === rid)?.itemIds.map((i) => st().items[i]).filter(Boolean) ?? [];

interface Step {
  title: string;
  blurb: string;
  watch: string;
  play: () => Promise<void>;
  alt?: { label: string; run: () => Promise<void> };
  tryIt?: { label: string; run: () => void };
}

export const STEPS: Step[] = [
  {
    title: 'Log a request in seconds',
    blurb: 'A guest asks for towels. The desk officer taps a room and what they need. No typing. Both teams are told at once.',
    watch: 'The timer in the corner of the composer, and the new ticket at the top.',
    play: async () => {
      go('requests');
      await sleep(300);
      lastReq = logRequest({ room: '412', presets: ['towels', 'water'] });
      haptic('success');
      toast('Logged in 2.1 s. Housekeeping and F&B were told.', 'success');
      setUI({ selItem: lastReq });
    },
    tryIt: { label: 'Open the composer', run: () => { go('requests'); openComposer({ room: '412' }); } },
  },
  {
    title: 'Route it and close the loop',
    blurb: 'Each team has its own item, owner and clock. They tap Relay, On site and Done on their own phones, so the desk is not the data clerk.',
    watch: 'Each item moving through its steps, and the ring that tracks its target time.',
    play: async () => {
      go('requests');
      if (!lastReq) lastReq = logRequest({ room: '412', presets: ['towels', 'water'] });
      const rid = lastReq;
      setUI({ selItem: rid });
      await sleep(500);
      for (const it of itemsOf(rid)) {
        if (!isOpen(it)) continue;
        relay(it.id); await sleep(650);
        onSite(it.id); await sleep(650);
        finishItem(it.id); await sleep(500);
      }
    },
  },
  {
    title: 'Pull the internet',
    blurb: 'The ISP goes down. In the Resilient tier the hotel network still shares tickets between stations.',
    watch: 'The Station B card stays in sync. The header still says Edge node on LAN.',
    play: async () => {
      go('network');
      setNet({ tier: 'resilient', internet: true, deviceWifi: true, power: true });
      await sleep(500);
      setNet({ internet: false }, 'Internet lost (ISP outage)');
      await sleep(900);
      logRequest({ room: '220', presets: ['bulb'] });
      haptic('success');
    },
  },
  {
    title: 'Same outage, cloud-only tier',
    blurb: 'Without an on-site node, a cloud-only setup cannot share tickets during an outage. This device keeps working and catches up later.',
    watch: 'The header shows waiting changes and Station B falls behind. When the internet returns it catches up on its own.',
    play: async () => {
      go('network');
      setNet({ tier: 'standard', internet: false, deviceWifi: true, power: true }, 'Switched to Standard tier');
      await sleep(700);
      logRequest({ room: '221', presets: ['ac'] });
      await sleep(2200);
      setNet({ internet: true }, 'Internet restored');
    },
  },
  {
    title: 'A dead zone in the stairwell',
    blurb: 'A staff phone loses Wi-Fi. It saves every tap with the time they were made and sends them when it reconnects. No false alarms for the person who was out of range.',
    watch: 'The “waiting” count rises, then clears with a Caught up message.',
    play: async () => {
      go('requests');
      setNet({ tier: 'resilient', internet: true, power: true, deviceWifi: true });
      await sleep(400);
      setNet({ deviceWifi: false }, 'Device left Wi-Fi range');
      await sleep(900);
      logRequest({ room: '331', presets: ['towels'] });
      await sleep(700);
      logRequest({ room: '332', presets: ['wifi'] });
      await sleep(1800);
      setNet({ deviceWifi: true }, 'Device back in Wi-Fi range');
    },
  },
  {
    title: 'A power cut',
    blurb: 'Battery backup keeps the edge node and Wi-Fi alive. When the battery runs out, the team switches to the paper kit.',
    watch: 'The battery level on the Network screen. Run it down to see paper mode.',
    play: async () => {
      go('network');
      setNet({ tier: 'resilient', internet: true, deviceWifi: true, power: false }, 'Power cut. Running on UPS');
      await sleep(6000);
      setNet({ power: true }, 'Mains power restored');
    },
    alt: { label: 'Run the battery down to paper mode', run: async () => { go('network'); setNet({ tier: 'resilient', power: false }, 'Power cut. Running on UPS'); } },
  },
  {
    title: 'Safety words',
    blurb: 'Words like “usok” or “amoy gas” are caught on the device itself, before any AI. The screen says to call 911 and use the radio first, and sounds a local alert even offline.',
    watch: 'The red takeover, the line “Staff notified (not BFP/911)”, and the manual 911 field.',
    play: async () => {
      go('requests');
      openComposer({ room: '612', text: 'May usok sa hallway po' });
      await sleep(1700);
      const r = raiseSafety('612', 'May usok sa hallway po', 'smoke');
      setUI({ sheet: 'safety', focusSafetyId: r.id });
    },
    alt: { label: 'A second room reports it', run: async () => { const r = raiseSafety('614', 'usok din dito', 'smoke'); setUI({ sheet: 'safety', focusSafetyId: r.id }); } },
    tryIt: { label: 'Type it yourself', run: () => { go('requests'); openComposer({ room: '612' }); } },
  },
  {
    title: 'A leak becomes a work order',
    blurb: 'One tap on “Leak” creates the repair and the cleanup, with the cleanup waiting for the fix. An engineer escalates it to a tracked work order with cost and contractor.',
    watch: 'The waiting cleanup item, then the work order and its link back to the ticket.',
    play: async () => {
      go('requests');
      const rid = logRequest({ room: '320', bundle: 'leak' });
      await sleep(600);
      setUI({ selItem: rid });
      const fix = itemsOf(rid).find((i) => i.dept === 'engineering');
      if (!fix) return;
      onSite(fix.id); await sleep(900);
      escalate(fix.id); await sleep(700);
      const wo = st().items[fix.id]?.woId;
      go('maintenance');
      if (wo) setUI({ selWo: wo });
    },
    alt: {
      label: 'Complete the work order',
      run: async () => {
        const w = st().wos.find((x) => x.srcItemId && x.status !== 'done');
        if (!w) { toast('Escalate a ticket first.', 'warn'); return; }
        go('maintenance'); setUI({ selWo: w.id });
        if (w.status === 'reported') { assessWo(w.id, { assessment: 'Joint reseal needed', assignType: 'inhouse', estCost: 2400 }); await sleep(700); }
        startWo(w.id); await sleep(700);
        completeWo(w.id, 2650);
      },
    },
  },
  {
    title: 'Checkout turns the room ready',
    blurb: 'When the checkout inspection is done, the room flips to Ready on the housekeeping board. Nobody radios it in.',
    watch: 'Room 305 moving up to Ready to clean.',
    play: async () => {
      const it = Object.values(st().items).find((i) => isOpen(i) && /inspection|checkout/i.test(i.name));
      if (!it) { toast('That step already ran. Reset the demo to replay it.', 'info'); go('housekeeping'); return; }
      go('requests');
      await sleep(300);
      finishItem(it.id);
      await sleep(900);
      go('housekeeping');
    },
  },
  {
    title: 'Shift handover',
    blurb: 'One screen for the next officer: what is open, what is overdue, and the promises made to guests. Items owned by someone who went off shift go back to the department queue.',
    watch: 'The orphaned item, then the acknowledgement that releases the outgoing officer.',
    play: async () => { go('handover'); await sleep(800); ackHandover(); },
    alt: { label: 'Return orphaned items to the queue', run: async () => { go('handover'); await sleep(300); returnOrphans(); } },
  },
  {
    title: 'Reports that stay fair',
    blurb: 'The duty manager sees departments, never personal rankings. In shadow mode even the timers stay hidden until the team trusts the data.',
    watch: 'The shadow mode card, then the department scorecards when timers are revealed.',
    play: async () => { setPref('shadow', true); unlock('s-ana'); go('insights'); toast('Now viewing as Ana, Duty Manager.', 'info'); },
    alt: { label: 'Reveal the timers', run: async () => { setPref('shadow', false); go('insights'); } },
  },
  {
    title: 'Made for everyone',
    blurb: 'Larger text, higher contrast, reduced motion, haptics, dark mode and full keyboard use. Every control is at least 44 points.',
    watch: 'The whole app scaling, then returning to normal.',
    play: async () => {
      go('settings');
      const p = st().prefs;
      setPref('textScale', 1.28); setPref('contrast', true);
      await sleep(3800);
      setPref('textScale', p.textScale); setPref('contrast', p.contrast);
    },
    alt: { label: 'Toggle dark mode', run: async () => { setPref('theme', st().prefs.theme === 'dark' ? 'light' : 'dark'); } },
  },
];

export function Guide({ docked }: { docked?: boolean }) {
  const step = useUI((s) => s.step);
  const done = useUI((s) => s.doneSteps);
  const running = useUI((s) => s.running);
  const cur = STEPS[step];

  const exec = async (fn: () => Promise<void>) => {
    if (ui.get().running) return;
    setUI({ running: true });
    try { await fn(); } finally { setUI({ running: false, doneSteps: Array.from(new Set([...ui.get().doneSteps, step])) }); }
  };

  const body = (
    <>
      <div className={docked ? 'guide-head' : ''}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 className="t-title3">Guided demo</h2>
          <span className="t-sub c2">Step {step + 1} of {STEPS.length}</span>
        </div>
        <div className="track" style={{ marginTop: 10 }} role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={done.length} aria-label="Demo progress">
          <motion.i animate={{ width: `${(done.length / STEPS.length) * 100}%` }} transition={springs.snappy} />
        </div>
      </div>

      <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={springs.snappy} style={{ padding: docked ? '14px 16px' : '14px 0' }}>
        <h3 className="t-title2">{cur.title}</h3>
        <p className="t-body" style={{ margin: '6px 0 8px' }}>{cur.blurb}</p>
        <p className="t-sub c2" style={{ margin: '0 0 14px' }}><b>Watch for:</b> {cur.watch}</p>
        <div style={{ display: 'grid', gap: 8 }}>
          <Button block size="lg" feel="medium" disabled={running} icon={running ? 'hourglass' : 'play'} onClick={() => exec(cur.play)}>{running ? 'Playing…' : 'Play it for me'}</Button>
          {cur.alt && <Button block variant="tint" disabled={running} onClick={() => exec(cur.alt!.run)}>{cur.alt.label}</Button>}
          {cur.tryIt && <Button block variant="gray" disabled={running} onClick={cur.tryIt.run}>{cur.tryIt.label}</Button>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <Button variant="plain" disabled={step === 0} onClick={() => setUI({ step: step - 1 })}>Back</Button>
          <Button variant="plain" disabled={step === STEPS.length - 1} onClick={() => setUI({ step: step + 1 })}>Next step</Button>
        </div>
      </motion.div>

      <ol className={docked ? 'guide-list' : ''} style={{ listStyle: 'none', margin: 0, padding: docked ? undefined : 0, display: 'grid', gap: 6 }}>
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button type="button" className={`gstep ${done.includes(i) ? 'done' : ''}`} aria-current={i === step ? 'step' : undefined} onClick={() => { haptic('select'); setUI({ step: i }); }}>
              <span className="gnum">{done.includes(i) ? <Icon name="tick" size={14} weight="bold" /> : i + 1}</span>
              <span className="t-sub" style={{ fontWeight: i === step ? 600 : 400 }}>{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div style={{ padding: docked ? '0 16px 20px' : '12px 0 0' }}>
        <Button block variant="gray" size="sm" onClick={() => { resetApp(); setUI({ doneSteps: [], step: 0 }); lastReq = undefined; toast('Demo data reset.', 'info'); }}>Reset demo data</Button>
      </div>
    </>
  );
  return docked ? <aside className="guide" aria-label="Guided demo" style={{ overflowY: 'auto' }}>{body}</aside> : <div>{body}</div>;
}

export const STEP_COUNT = STEPS.length;
