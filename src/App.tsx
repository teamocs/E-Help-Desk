import { Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { app, go, lock, myStaff, openComposer, setUI, syncPrefs, tick, useApp, useUI, type AccountRole, type UI } from './domain/store';
import type { State } from './domain/types';
import { staffApi } from './domain/staffApi';
import { haptic } from './lib/haptics';
import { springs } from './lib/motion';
import { MODULES, badgeText, visibleModules } from './modules/registry';
import type { ModuleDef } from './modules/types';
import { Announcer, Avatar, Button, ConnChip, Group, Icon, Row, Toasts, useTier } from './ui/kit';
import { Sheet } from './ui/sheet';
import { Composer } from './screens/Composer';
import { Safety } from './screens/Safety';

export const ROLE_NAME: Record<AccountRole, string> = { owner: 'Hotel owner', manager: 'Manager', supervisor: 'Supervisor', device: 'Shared phone' };

/** The modules this desk shows: the registry, filtered by the role matrix for this account or PIN person. */
export function useNav(): ModuleDef[] {
  const role = useUI((s) => s.account.role);
  const accountModules = useUI((s) => s.account.modules);
  const access = useUI((s) => s.access);
  const me = useApp(myStaff);
  const catalog = useApp((s) => s.catalog);
  return useMemo(() => visibleModules({ role, accountModules, access, me, catalog }), [role, accountModules, access, me, catalog]);
}

/** The module on screen: the chosen one when this viewer may see it, else the first they may. */
function useCurrent(nav: ModuleDef[]): ModuleDef | undefined {
  const tab = useUI((s) => s.tab);
  return nav.find((m) => m.id === tab) ?? nav[0];
}

/** The open record of the current module's detail pane, if any. */
function useDetail(mod: ModuleDef | undefined): string | undefined {
  return useUI((s: UI) => mod?.detail?.selected(s));
}

function Loading() {
  return <main className="screen" id="main" tabIndex={-1}><p className="c2" role="status" style={{ padding: '2rem 0' }}>Loading…</p></main>;
}

function Screens({ mod }: { mod: ModuleDef | undefined }) {
  if (!mod) {
    return <main className="screen" id="main" tabIndex={-1}><p className="c2" style={{ padding: '2rem 0' }}>This account has no screens on the desk. Ask your hotel owner or manager.</p></main>;
  }
  const View = mod.Screen;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={mod.id} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
        <Suspense fallback={<Loading />}><View /></Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

/** Every module's badge count, from one store read (a stable string, so the sidebar re-renders only when one changes). */
function useBadges(): Record<string, number> {
  const key = useApp((s: State) => MODULES.map((m) => (m.badge ? m.badge(s) : -1)).join(','));
  return useMemo(() => Object.fromEntries(key.split(',').map((n, i) => [MODULES[i].id, Number(n)])), [key]);
}

function Badge({ n, label, quiet }: { n: number | undefined; label: string; quiet?: boolean }) {
  const text = n == null || n < 0 ? null : badgeText(n);
  return text == null ? null : <span className={`badge ${quiet ? 'quiet' : ''}`} aria-label={`${text} ${label}`}>{text}</span>;
}

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
          <button type="button" className="usermenu-item" onClick={() => { setOpen(false); setUI({ sheet: 'paper' }); }}><Icon name="printer" size={20} /> Paper kit</button>
          <button type="button" className="usermenu-item" disabled={busy} onClick={async () => { setBusy(true); await staffApi.current?.logout(); setBusy(false); }}><Icon name="signout" size={20} /> {busy ? 'Signing out…' : 'Sign out'}</button>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ nav, current }: { nav: ModuleDef[]; current?: string }) {
  const badges = useBadges();
  return (
    <nav className="side" aria-label="Main">
      <Brand />
      <Button block icon="plus" feel="medium" onClick={() => openComposer()}>New request</Button>
      <div style={{ height: 8 }} />
      <ul className="side-list" role="list">
        {nav.map((m) => (
          <li key={m.id}>
            <button type="button" className="side-item" aria-current={current === m.id ? 'page' : undefined} onClick={() => { haptic('select'); go(m.id); }}>
              <Icon name={m.icon} weight={current === m.id ? 'fill' : 'regular'} />
              <span className="side-label">{m.label}</span>
              <Badge n={badges[m.id]} label={m.badgeLabel ?? 'open'} />
            </button>
          </li>
        ))}
      </ul>
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

export function TabBar({ nav, current }: { nav: ModuleDef[]; current?: string }) {
  const badges = useBadges();
  const main = nav.filter((m) => m.phoneTab);
  const more = !main.some((m) => m.id === current);
  return (
    <nav className="tabbar" aria-label="Main">
      {main.map((m) => (
        <button key={m.id} type="button" className="tab" aria-current={current === m.id ? 'page' : undefined} onClick={() => { haptic('select'); go(m.id); }}>
          <Icon name={m.icon} size={24} weight={current === m.id ? 'fill' : 'regular'} />
          <span className="tab-label">{m.label}</span>
          <Badge n={badges[m.id]} label={m.badgeLabel ?? 'open'} />
        </button>
      ))}
      <button type="button" className="tab" aria-current={more ? 'page' : undefined} aria-haspopup="dialog" onClick={() => { haptic('select'); setUI({ sheet: 'more' }); }}>
        <Icon name="list" size={24} weight={more ? 'fill' : 'regular'} />
        <span className="tab-label">More</span>
      </button>
    </nav>
  );
}

export function Sheets({ nav, mod, inspector }: { nav: ModuleDef[]; mod?: ModuleDef; inspector: boolean }) {
  const sheet = useUI((s) => s.sheet);
  const sel = useDetail(mod);
  const badges = useBadges();
  const close = () => setUI({ sheet: null });
  const Detail = mod?.detail?.View;
  return (
    <>
      <Composer />
      <Sheet open={!inspector && sheet === null && !!sel && !!Detail} title={mod?.detail?.title ?? ''} onClose={() => setUI({ selItem: undefined, selWo: undefined })}>
        {Detail && sel ? <Detail id={sel} /> : null}
      </Sheet>
      <Sheet open={sheet === 'more'} title="More" onClose={close}>
        <Group>
          {nav.filter((m) => !m.phoneTab).map((m) => {
            const n = badges[m.id];
            const text = n == null || n < 0 ? null : badgeText(n);
            return <Row key={m.id} icon={m.icon} tint="var(--accent-strong)" title={m.label} trailing={text == null ? undefined : <span className="badge" aria-label={`${text} ${m.badgeLabel ?? 'open'}`}>{text}</span>} chevron onClick={() => go(m.id)} />;
          })}
          <Row icon="printer" title="Paper kit" chevron onClick={() => setUI({ sheet: 'paper' })} />
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
  const nav = useNav();
  const mod = useCurrent(nav);
  const sel = useDetail(mod);
  const wide = tier === 'desktop' || tier === 'wide';
  const Detail = mod?.detail?.View;
  const inspector = wide && !!sel && !!Detail;
  const cols = [tier === 'phone' ? '' : '256px', 'minmax(0,1fr)', inspector ? 'minmax(340px,420px)' : ''].filter(Boolean).join(' ');

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!app.get().prefs.shortcuts) return;
      if (t.closest('input, textarea, select, [role="dialog"], [role="alertdialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n') { e.preventDefault(); openComposer(); }
      const i = Number(e.key);
      if (i >= 1 && i <= Math.min(9, nav.length)) go(nav[i - 1].id);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [nav]);

  return (
    <>
      <div className={`app ${wide ? 'wide' : ''}`} style={{ gridTemplateColumns: cols }}>
        {tier !== 'phone' && <Sidebar nav={nav} current={mod?.id} />}
        <div className="main">
          {tier === 'phone' && <TopBar />}
          <Screens mod={mod} />
          {tier === 'phone' && mod?.fab && (
            <motion.button type="button" className="fab" whileTap={{ scale: 0.94 }} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springs.gentle} onClick={() => { haptic('medium'); openComposer(); }}>
              <Icon name="plus" size={24} /> New request
            </motion.button>
          )}
          {tier === 'phone' && <TabBar nav={nav} current={mod?.id} />}
        </div>
        {inspector && Detail && sel && (
          <aside className="insp" aria-label="Details">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <button type="button" className="iconbtn" aria-label="Close details" onClick={() => setUI({ selItem: undefined, selWo: undefined })}><Icon name="x" /></button>
            </div>
            <Detail id={sel} />
          </aside>
        )}
      </div>
      <Sheets nav={nav} mod={mod} inspector={inspector} />
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
