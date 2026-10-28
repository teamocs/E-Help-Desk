import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { isOpen } from './domain/rules';
import { app, go, lock, myStaff, openComposer, paperMode, setUI, syncPrefs, tick, useApp, useUI, type Tab } from './domain/store';
import type { State } from './domain/types';
import { staffApi } from './domain/staffApi';
import { haptic } from './lib/haptics';
import { springs } from './lib/motion';
import { Guide, STEP_COUNT } from './demo/Guide';
import { Announcer, Avatar, Button, Group, HapticHud, Icon, Row, Toasts, useTier } from './ui/kit';
import { Sheet } from './ui/sheet';
import { Composer } from './screens/Composer';
import { Cover } from './screens/Cover';
import { RequestDetail } from './screens/Detail';
import { Handover } from './screens/Handover';
import { Housekeeping } from './screens/Housekeeping';
import { Insights } from './screens/Insights';
import { Lock } from './screens/Lock';
import { Maintenance, WoDetail } from './screens/Maintenance';
import { Network } from './screens/Network';
import { Requests } from './screens/Requests';
import { Safety } from './screens/Safety';
import { Settings } from './screens/Settings';

const NAV: { tab: Tab; label: string; icon: string }[] = [
  { tab: 'requests', label: 'Requests', icon: 'list' },
  { tab: 'maintenance', label: 'Work orders', icon: 'wrench' },
  { tab: 'housekeeping', label: 'Housekeeping', icon: 'broom' },
  { tab: 'handover', label: 'Handover', icon: 'hand' },
  { tab: 'insights', label: 'Insights', icon: 'chart' },
  { tab: 'network', label: 'Network', icon: 'broadcast' },
  { tab: 'settings', label: 'Settings', icon: 'gear' },
];

function Screens() {
  const tab = useUI((s) => s.tab);
  const view: Record<Tab, ReactNode> = {
    requests: <Requests />, maintenance: <Maintenance />, housekeeping: <Housekeeping />, handover: <Handover />,
    insights: <Insights />, network: <Network />, settings: <Settings />,
  };
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={tab} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
        {view[tab]}
      </motion.div>
    </AnimatePresence>
  );
}

const openRequests = (s: State) => s.requests.filter((r) => r.itemIds.some((id) => s.items[id] && isOpen(s.items[id]))).length;

/** Server-backed mode hides the demo-only Network simulator. */
const visibleNav = (isRemote: boolean) => (isRemote ? NAV.filter((n) => n.tab !== 'network') : NAV);
const leave = () => window.location.assign('/dashboard');
/** Back to the PIN screen. On a shared phone the previous person is signed out first, so nobody inherits their name. */
async function switchPerson(deviceOnly: boolean) {
  if (deviceOnly) {
    await staffApi.current?.signOut();
    app.set((s) => ({ ...s, me: null }));
  }
  lock();
}

function Sidebar() {
  const tab = useUI((s) => s.tab);
  const open = useApp(openRequests);
  const acked = useApp((s) => !!s.handover.ackAt);
  const me = useApp(myStaff);
  const guide = useUI((s) => s.guide);
  const isRemote = useUI((s) => s.remote);
  const deviceOnly = useUI((s) => s.deviceOnly);
  return (
    <nav className="side" aria-label="Main">
      <div className="brand">
        <span className="brand-mark"><Icon name="bell" size={20} weight="fill" /></span>
        <span><span className="t-head" style={{ display: 'block' }}>Azalea</span><span className="t-foot c2">e-Helpdesk</span></span>
      </div>
      <Button block icon="plus" feel="medium" onClick={() => openComposer()}>New request</Button>
      <div style={{ height: 8 }} />
      {visibleNav(isRemote).map((n) => (
        <button key={n.tab} type="button" className="side-item" aria-current={tab === n.tab ? 'page' : undefined} onClick={() => { haptic('select'); go(n.tab); }}>
          <Icon name={n.icon} /> {n.label}
          {n.tab === 'requests' && <span className="badge quiet">{open}</span>}
          {n.tab === 'handover' && !acked && !isRemote && <span className="dot" style={{ marginLeft: 'auto' }} role="img" aria-label="Not yet acknowledged" />}
        </button>
      ))}
      <span className="side-gap" />
      {!isRemote && (
        <button type="button" className="side-item" onClick={() => { haptic('select'); setUI({ guide: true, sheet: 'demo' }); }} aria-pressed={guide}>
          <Icon name="play" /> Guided demo
        </button>
      )}
      <button type="button" className="side-item" onClick={() => { haptic('select'); void switchPerson(deviceOnly); }}>
        <Avatar staff={me} />
        <span style={{ textAlign: 'left', minWidth: 0 }}><span className="t-sub ellip" style={{ display: 'block', fontWeight: 600 }}>{me?.name}</span><span className="t-cap c2">Switch person</span></span>
      </button>
      {isRemote && (
        <button type="button" className="side-item" onClick={() => { haptic('select'); leave(); }}>
          <Icon name="home" /> Hotel account
        </button>
      )}
    </nav>
  );
}

function TabBar() {
  const tab = useUI((s) => s.tab);
  const open = useApp(openRequests);
  const main = NAV.slice(0, 4);
  const more = !main.some((n) => n.tab === tab);
  return (
    <nav className="tabbar" aria-label="Main">
      {main.map((n) => (
        <button key={n.tab} type="button" className="tab" aria-current={tab === n.tab ? 'page' : undefined} onClick={() => { haptic('select'); go(n.tab); }}>
          <Icon name={n.icon} size={26} weight={tab === n.tab ? 'fill' : 'regular'} />
          {n.label.split(' ')[0]}
          {n.tab === 'requests' && open > 0 && <span className="badge">{open}</span>}
        </button>
      ))}
      <button type="button" className="tab" aria-current={more ? 'page' : undefined} onClick={() => { haptic('select'); setUI({ sheet: 'more' }); }}>
        <Icon name="list" size={26} weight={more ? 'fill' : 'regular'} />
        More
      </button>
    </nav>
  );
}

function PaperBanner() {
  const paper = useApp(paperMode);
  return (
    <AnimatePresence>
      {paper && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
          <button type="button" className="banner bad" style={{ width: 'calc(100% - 24px)', margin: '8px 12px 0', textAlign: 'left' }} onClick={() => setUI({ sheet: 'paper' })}>
            <Icon name="printer" weight="fill" />
            <span className="t-sub"><b>Paper mode.</b> Battery is empty. Use the paper kit and re-enter entries when power returns. Tap for the kit.</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Sheets({ inspector }: { inspector: boolean }) {
  const isRemote = useUI((s) => s.remote);
  const deviceOnly = useUI((s) => s.deviceOnly);
  const sheet = useUI((s) => s.sheet);
  const selItem = useUI((s) => s.selItem);
  const selWo = useUI((s) => s.selWo);
  const tab = useUI((s) => s.tab);
  const tier = useTier();
  const close = () => setUI({ sheet: null });
  const detailOpen = !inspector && sheet === null && ((tab === 'requests' && !!selItem) || (tab === 'maintenance' && !!selWo));
  return (
    <>
      <Composer />
      <Sheet open={detailOpen} title={tab === 'maintenance' ? 'Work order' : 'Ticket'} onClose={() => setUI({ selItem: undefined, selWo: undefined })}>
        {tab === 'maintenance' && selWo ? <WoDetail id={selWo} /> : selItem ? <RequestDetail id={selItem} /> : null}
      </Sheet>
      <Sheet open={sheet === 'more'} title="More" onClose={close}>
        <Group>
          {visibleNav(isRemote).slice(4).map((n) => <Row key={n.tab} icon={n.icon} tint="var(--accent)" title={n.label} chevron onClick={() => go(n.tab)} />)}
          {!isRemote && <Row icon="play" tint="var(--accent)" title="Guided demo" chevron onClick={() => setUI({ guide: true, sheet: 'demo' })} />}
          <Row icon="printer" title="Paper kit" chevron onClick={() => setUI({ sheet: 'paper' })} />
          <Row icon="user" title="Switch person" chevron onClick={() => void switchPerson(deviceOnly)} />
          {isRemote && <Row icon="home" title="Hotel account" chevron onClick={leave} />}
        </Group>
      </Sheet>
      <Sheet open={sheet === 'demo' && tier !== 'wide'} title="Guided demo" onClose={close}><Guide /></Sheet>
      <Sheet open={sheet === 'paper'} title="Paper kit" onClose={close}><Paper /></Sheet>
      <Safety />
    </>
  );
}

function Paper() {
  return (
    <div>
      <p className="t-body c2" style={{ marginTop: 0 }}>When power and battery are gone, work continues on paper. The forms mirror the app, so re-entry is a straight copy.</p>
      <Group title="In the drawer">
        <Row icon="clip" title="Request and call log" sub="Time, room, item, who, done at" />
        <Row icon="home" title="In-house manifest" sub="Printed each morning from the booking system" />
        <Row icon="siren" title="Crisis code card" sub="CALL 911 / RADIO FIRST, THEN LOG" />
        <Row icon="hand" title="Shift handover sheet" sub="Open, overdue and promised to guests" />
      </Group>
      <Group title="Request log (sample)">
        <div style={{ padding: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }} className="t-sub">
            <thead><tr>{['Time', 'Room', 'What', 'Who', 'Done'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--sep)' }} className="t-foot c2">{h}</th>)}</tr></thead>
            <tbody>{[0, 1, 2, 3].map((r) => <tr key={r}>{[0, 1, 2, 3, 4].map((c) => <td key={c} style={{ padding: '14px 8px', borderBottom: '1px dashed var(--sep)' }}>&nbsp;</td>)}</tr>)}</tbody>
          </table>
        </div>
      </Group>
      <Group title="When power returns">
        <Row title="1. Enter paper entries in time order" sub="Use the real time written on the sheet" />
        <Row title="2. Mark each entry as re-entered" sub="So nothing is entered twice" />
        <Row title="3. File the sheets with the shift report" sub="Paper periods are never data holes" />
      </Group>
    </div>
  );
}

export function Shell() {
  const tier = useTier();
  const tab = useUI((s) => s.tab);
  const selItem = useUI((s) => s.selItem);
  const selWo = useUI((s) => s.selWo);
  const guide = useUI((s) => s.guide);
  const step = useUI((s) => s.step);
  const wide = tier === 'desktop' || tier === 'wide';
  const inspector = wide && ((tab === 'requests' && !!selItem) || (tab === 'maintenance' && !!selWo));
  const docked = tier === 'wide' && guide;
  const cols = [tier === 'phone' ? '' : '248px', 'minmax(0,1fr)', inspector ? 'minmax(340px,420px)' : '', docked ? '340px' : ''].filter(Boolean).join(' ');

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!app.get().prefs.shortcuts) return;
      if (t.closest('input, textarea, [role="dialog"], [role="alertdialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n') { e.preventDefault(); openComposer(); }
      const i = Number(e.key);
      if (i >= 1 && i <= NAV.length) go(NAV[i - 1].tab);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  return (
    <>
      <div className={`app ${wide ? 'wide' : ''}`} style={{ gridTemplateColumns: cols }}>
        {tier !== 'phone' && <Sidebar />}
        <div className="main">
          <PaperBanner />
          <Screens />
          {tier === 'phone' && tab === 'requests' && (
            <motion.button type="button" className="fab" aria-label="New request" whileTap={{ scale: 0.94 }} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springs.gentle} onClick={() => { haptic('medium'); openComposer(); }}>
              <Icon name="plus" size={24} weight="bold" /> New
            </motion.button>
          )}
          {tier === 'phone' && <TabBar />}
          {guide && tier !== 'wide' && (
            <button type="button" className="chip" style={{ position: 'absolute', left: 16, bottom: tier === 'phone' ? 'calc(5.2rem + env(safe-area-inset-bottom))' : 16, zIndex: 8, background: 'var(--surface)', boxShadow: 'var(--shadow)', minHeight: '2.5rem' }} onClick={() => setUI({ sheet: 'demo' })}>
              <Icon name="play" size={16} weight="fill" /> Demo {step + 1}/{STEP_COUNT}
            </button>
          )}
        </div>
        {inspector && (
          <aside className="insp" aria-label="Details">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <button type="button" className="iconbtn" aria-label="Close details" onClick={() => setUI({ selItem: undefined, selWo: undefined })}><Icon name="x" /></button>
            </div>
            {tab === 'maintenance' && selWo ? <WoDetail id={selWo} /> : selItem ? <RequestDetail id={selItem} /> : null}
          </aside>
        )}
        {docked && <Guide docked />}
      </div>
      <Sheets inspector={inspector} />
    </>
  );
}

/** When hosted inside a viewer that sets its own theme, "Automatic" defers to it. */
const HOST_THEME = typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme');

/** Server-backed app only: says when changes are saved on this device but not yet on the server. */
function SyncBar() {
  const { pending, offline } = useUI((s) => s.sync);
  if (!pending && !offline) return null;
  const n = pending === 1 ? '1 change' : `${pending} changes`;
  const text = offline ? (pending ? `Offline. ${n} saved on this device and will send when you are back online.` : 'Offline. Changes are saved on this device.') : `Saving ${n}…`;
  return (
    <div role="status" aria-live="polite" style={{ position: 'fixed', top: 'max(env(safe-area-inset-top), 10px)', left: 0, right: 0, display: 'flex', justifyContent: 'center', padding: '0 16px', zIndex: 60, pointerEvents: 'none' }}>
      <div className={`toast ${offline ? 'warn' : ''}`}>{text}</div>
    </div>
  );
}

/** Theme, text size, motion, the clock and the global toasts. Shared by the demo and the server-backed app. */
export function AppChrome({ children }: { children: ReactNode }) {
  const prefs = useApp((s) => s.prefs);

  useEffect(() => {
    syncPrefs(prefs);
    const r = document.documentElement;
    r.style.setProperty('--ts', String(prefs.textScale));
    if (prefs.theme !== 'auto') r.setAttribute('data-theme', prefs.theme);
    else if (HOST_THEME) r.setAttribute('data-theme', HOST_THEME);
    else r.removeAttribute('data-theme');
    if (prefs.contrast) r.setAttribute('data-contrast', 'more'); else r.removeAttribute('data-contrast');
    if (prefs.motion === 'reduce') r.setAttribute('data-motion', 'reduce'); else r.removeAttribute('data-motion');
  }, [prefs]);

  useEffect(() => {
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <MotionConfig reducedMotion={prefs.motion === 'reduce' ? 'always' : 'user'}>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      {children}
      <SyncBar />
      <Toasts />
      <Announcer />
      <HapticHud />
    </MotionConfig>
  );
}

export function App() {
  const screen = useUI((s) => s.screen);
  return (
    <AppChrome>
      {screen === 'cover' && <Cover />}
      {screen === 'lock' && <Lock />}
      {screen === 'app' && <Shell />}
    </AppChrome>
  );
}
