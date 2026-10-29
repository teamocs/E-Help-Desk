import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { isOpen } from './domain/rules';
import { app, go, lock, myStaff, openComposer, setUI, syncPrefs, tick, useApp, useUI, type AccountRole, type Tab } from './domain/store';
import type { State } from './domain/types';
import { staffApi } from './domain/staffApi';
import { haptic } from './lib/haptics';
import { springs } from './lib/motion';
import { Announcer, Avatar, Button, ConnChip, Group, Icon, Row, Toasts, useTier } from './ui/kit';
import { Sheet } from './ui/sheet';
import { Composer } from './screens/Composer';
import { RequestDetail } from './screens/Detail';
import { Handover } from './screens/Handover';
import { Housekeeping } from './screens/Housekeeping';
import { Insights } from './screens/Insights';
import { Maintenance, WoDetail } from './screens/Maintenance';
import { Requests } from './screens/Requests';
import { Safety } from './screens/Safety';
import { Settings } from './screens/Settings';

const NAV: { tab: Tab; label: string; icon: string }[] = [
  { tab: 'requests', label: 'Requests', icon: 'list' },
  { tab: 'maintenance', label: 'Work orders', icon: 'wrench' },
  { tab: 'housekeeping', label: 'Housekeeping', icon: 'broom' },
  { tab: 'handover', label: 'Handover', icon: 'hand' },
  { tab: 'insights', label: 'Insights', icon: 'chart' },
  { tab: 'settings', label: 'Settings', icon: 'gear' },
];

/** A shared phone sees the four work screens only; everyone else sees everything (Settings hides staff admin by role). */
export const tabsFor = (role: AccountRole) => (role === 'device' ? NAV.filter((n) => n.tab !== 'insights' && n.tab !== 'settings') : NAV);
export const ROLE_NAME: Record<AccountRole, string> = { owner: 'Hotel owner', manager: 'Manager', supervisor: 'Supervisor', device: 'Shared phone' };

const useNav = () => tabsFor(useUI((s) => s.account.role));

function Screens() {
  const tab = useUI((s) => s.tab);
  const nav = useNav();
  const shown = nav.some((n) => n.tab === tab) ? tab : 'requests';
  const view: Record<Tab, ReactNode> = {
    requests: <Requests />, maintenance: <Maintenance />, housekeeping: <Housekeeping />, handover: <Handover />,
    insights: <Insights />, settings: <Settings />,
  };
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={shown} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
        {view[shown]}
      </motion.div>
    </AnimatePresence>
  );
}

const openRequests = (s: State) => s.requests.filter((r) => r.itemIds.some((id) => s.items[id] && isOpen(s.items[id]))).length;

/** Back to the PIN screen. On a shared phone the previous person is signed out first, so nobody inherits their name. */
async function switchPerson(deviceOnly: boolean) {
  if (deviceOnly) {
    await staffApi.current?.signOut();
    app.set((s) => ({ ...s, me: null }));
  }
  lock();
}

/** The hotel's logo and name, with the product as the subtitle. Falls back to the bell mark. */
export function Brand({ sub = 'E-Help Desk' }: { sub?: string }) {
  const { hotel, logoUrl } = useUI((s) => s.account);
  const [broken, setBroken] = useState(false);
  return (
    <div className="brand">
      <span className="brand-mark">
        {logoUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Vite bundle inside WordPress: there is no next/image
          <img src={logoUrl} alt="" width={40} height={40} decoding="async" onError={() => setBroken(true)} />
        ) : <Icon name="bell" size={22} weight="fill" />}
      </span>
      <span>
        <span className="brand-name ellip">{hotel || 'Help desk'}</span>
        <span className="brand-sub">{sub}</span>
      </span>
    </div>
  );
}

/** Who is signed in, and the ways out: switch person (PIN) or sign out of WordPress. */
function UserMenu({ compact }: { compact?: boolean }) {
  const account = useUI((s) => s.account);
  const deviceOnly = useUI((s) => s.deviceOnly);
  const me = useApp(myStaff);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const person = me && me.id !== 'member' ? me : undefined;
  const name = deviceOnly ? (person?.name ?? 'No one signed in') : account.name;

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('.usermenu-item')?.focus();
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const close = () => { setOpen(false); btn.current?.focus(); };
  return (
    <div className="usermenu" ref={box} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(); } }}>
      <button ref={btn} type="button" className="usermenu-btn" aria-expanded={open} aria-controls={id} aria-label={compact ? `Account: ${name}, ${ROLE_NAME[account.role]}` : undefined} onClick={() => setOpen((v) => !v)}>
        <Avatar staff={deviceOnly ? person : me} />
        {!compact && (
          <span style={{ minWidth: 0 }}>
            <span className="t-sub ellip" style={{ display: 'block', fontWeight: 600, color: '#fff' }}>{name}</span>
            <span className="t-cap" style={{ display: 'block' }}>{ROLE_NAME[account.role]}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="usermenu-panel" id={id} role="group" aria-label="Account">
          <div className="usermenu-who">
            <span className="t-head" style={{ display: 'block', overflowWrap: 'anywhere' }}>{account.name || name}</span>
            <span className="t-foot c2">{ROLE_NAME[account.role]}{person && !deviceOnly ? ` · acting as ${person.name}` : ''}{person && deviceOnly ? ` · ${person.name} signed in` : ''}</span>
          </div>
          <button type="button" className="usermenu-item" onClick={() => { setOpen(false); void switchPerson(deviceOnly); }}><Icon name="user" size={20} /> Switch person</button>
          <button type="button" className="usermenu-item" disabled={busy} onClick={async () => { setBusy(true); await staffApi.current?.logout(); setBusy(false); }}><Icon name="signout" size={20} /> {busy ? 'Signing out…' : 'Sign out'}</button>
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  const tab = useUI((s) => s.tab);
  const open = useApp(openRequests);
  const nav = useNav();
  return (
    <nav className="side" aria-label="Main">
      <Brand />
      <Button block icon="plus" feel="medium" onClick={() => openComposer()}>New request</Button>
      <div style={{ height: 8 }} />
      {nav.map((n) => (
        <button key={n.tab} type="button" className="side-item" aria-current={tab === n.tab ? 'page' : undefined} onClick={() => { haptic('select'); go(n.tab); }}>
          <Icon name={n.icon} weight={tab === n.tab ? 'fill' : 'regular'} /> {n.label}
          {n.tab === 'requests' && open > 0 && <span className="badge quiet" aria-label={`${open} open`}>{open}</span>}
        </button>
      ))}
      <span className="side-gap" />
      <UserMenu />
    </nav>
  );
}

function TopBar() {
  return (
    <header className="topbar">
      <Brand />
      <ConnChip />
      <UserMenu compact />
    </header>
  );
}

function TabBar() {
  const tab = useUI((s) => s.tab);
  const open = useApp(openRequests);
  const nav = useNav();
  const main = nav.slice(0, 4);
  const more = !main.some((n) => n.tab === tab);
  return (
    <nav className="tabbar" aria-label="Main">
      {main.map((n) => (
        <button key={n.tab} type="button" className="tab" aria-current={tab === n.tab ? 'page' : undefined} onClick={() => { haptic('select'); go(n.tab); }}>
          <Icon name={n.icon} size={24} weight={tab === n.tab ? 'fill' : 'regular'} />
          {n.label.split(' ')[0]}
          {n.tab === 'requests' && open > 0 && <span className="badge" aria-label={`${open} open`}>{open}</span>}
        </button>
      ))}
      <button type="button" className="tab" aria-current={more ? 'page' : undefined} aria-haspopup="dialog" onClick={() => { haptic('select'); setUI({ sheet: 'more' }); }}>
        <Icon name="list" size={24} weight={more ? 'fill' : 'regular'} />
        More
      </button>
    </nav>
  );
}

function Sheets({ inspector }: { inspector: boolean }) {
  const deviceOnly = useUI((s) => s.deviceOnly);
  const sheet = useUI((s) => s.sheet);
  const selItem = useUI((s) => s.selItem);
  const selWo = useUI((s) => s.selWo);
  const tab = useUI((s) => s.tab);
  const nav = useNav();
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
          {nav.slice(4).map((n) => <Row key={n.tab} icon={n.icon} tint="var(--accent-strong)" title={n.label} chevron onClick={() => go(n.tab)} />)}
          <Row icon="printer" title="Paper kit" chevron onClick={() => setUI({ sheet: 'paper' })} />
          <Row icon="user" title="Switch person" chevron onClick={() => void switchPerson(deviceOnly)} />
          <Row icon="signout" title="Sign out" onClick={() => void staffApi.current?.logout()} />
        </Group>
      </Sheet>
      <Sheet open={sheet === 'paper'} title="Paper kit" onClose={close}><Paper /></Sheet>
      <Safety />
    </>
  );
}

function Paper() {
  return (
    <div>
      <p className="t-body c2" style={{ marginTop: 0 }}>When power and battery are gone, work continues on paper. The forms mirror the desk, so re-entry is a straight copy.</p>
      <Group title="In the drawer">
        <Row icon="clip" title="Request and call log" sub="Time, room, item, who, done at" />
        <Row icon="home" title="In-house list" sub="Printed each morning from the booking system" />
        <Row icon="siren" title="Emergency card" sub="CALL 911 / RADIO FIRST, THEN LOG" />
        <Row icon="hand" title="Shift handover sheet" sub="Open, overdue and promised to guests" />
      </Group>
      <Group title="Request log">
        <div style={{ padding: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }} className="t-sub">
            <thead><tr>{['Time', 'Room', 'What', 'Who', 'Done'].map((h) => <th key={h} scope="col" style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--sep)' }} className="t-foot c2">{h}</th>)}</tr></thead>
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
  const nav = useNav();
  const wide = tier === 'desktop' || tier === 'wide';
  const inspector = wide && ((tab === 'requests' && !!selItem) || (tab === 'maintenance' && !!selWo));
  const cols = [tier === 'phone' ? '' : '256px', 'minmax(0,1fr)', inspector ? 'minmax(340px,420px)' : ''].filter(Boolean).join(' ');

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!app.get().prefs.shortcuts) return;
      if (t.closest('input, textarea, select, [role="dialog"], [role="alertdialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n') { e.preventDefault(); openComposer(); }
      const i = Number(e.key);
      if (i >= 1 && i <= nav.length) go(nav[i - 1].tab);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [nav]);

  return (
    <>
      <div className={`app ${wide ? 'wide' : ''}`} style={{ gridTemplateColumns: cols }}>
        {tier !== 'phone' && <Sidebar />}
        <div className="main">
          {tier === 'phone' && <TopBar />}
          <Screens />
          {tier === 'phone' && tab === 'requests' && (
            <motion.button type="button" className="fab" whileTap={{ scale: 0.94 }} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springs.gentle} onClick={() => { haptic('medium'); openComposer(); }}>
              <Icon name="plus" size={24} /> New request
            </motion.button>
          )}
          {tier === 'phone' && <TabBar />}
        </div>
        {inspector && (
          <aside className="insp" aria-label="Details">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <button type="button" className="iconbtn" aria-label="Close details" onClick={() => setUI({ selItem: undefined, selWo: undefined })}><Icon name="x" /></button>
            </div>
            {tab === 'maintenance' && selWo ? <WoDetail id={selWo} /> : selItem ? <RequestDetail id={selItem} /> : null}
          </aside>
        )}
      </div>
      <Sheets inspector={inspector} />
    </>
  );
}

/** Text size, contrast, motion, the clock and the global toasts. Light theme only. */
export function AppChrome({ children }: { children: ReactNode }) {
  const prefs = useApp((s) => s.prefs);

  useEffect(() => {
    syncPrefs(prefs);
    const r = document.documentElement;
    r.style.setProperty('--ts', String(prefs.textScale));
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
      <Toasts />
      <Announcer />
    </MotionConfig>
  );
}
