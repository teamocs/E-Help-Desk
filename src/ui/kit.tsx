import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowClockwise, ArrowsLeftRight, Bed, BeerBottle, Bell, Broadcast, Broom, ChartBar, Check, CheckCircle, ClipboardText, Clock, CloudCheck, CloudSlash,
  CaretRight, Drop, Ear, Flame, Gear, Hourglass, Info, Lightbulb, Lock, Plus, Printer, ShieldWarning, Shower, Snowflake, Tray, Television, Warning,
  WifiHigh, WifiSlash, Wrench, X, Pause, Play, Prohibit, Sparkle, HouseLine, Copy, Lightning, BatteryWarning, BatteryFull, Moon, Sun, TextAa, Siren,
  UserSwitch, Phone, List, ArrowUUpLeft, ArrowRight, Cpu, Handshake, Receipt, DeviceMobile, Waves, Thermometer,
} from '@phosphor-icons/react';
import { haptic, hapticBus, type Haptic } from '../lib/haptics';
import { springs, motionTokens } from '../lib/motion';
import { app, useApp, paperMode } from '../domain/store';
import { DEPTS } from '../domain/rules';
import type { Dept, Staff } from '../domain/types';

const ICONS = {
  towel: Shower, bed: Bed, drop: Drop, broom: Broom, check: CheckCircle, snow: Snowflake, bulb: Lightbulb, flame: Flame, wifi: WifiHigh, tv: Television,
  bottle: BeerBottle, tray: Tray, clock: Clock, ear: Ear, plus: Plus, wrench: Wrench, clip: ClipboardText, chart: ChartBar, gear: Gear, lock: Lock,
  shield: ShieldWarning, wifioff: WifiSlash, cloudoff: CloudSlash, cloud: CloudCheck, battery: BatteryFull, batterylow: BatteryWarning, warn: Warning,
  chev: CaretRight, x: X, tick: Check, hourglass: Hourglass, swap: ArrowsLeftRight, undo: ArrowUUpLeft, play: Play, pause: Pause, sparkle: Sparkle,
  broadcast: Broadcast, siren: Siren, user: UserSwitch, phone: Phone, list: List, arrow: ArrowRight, cpu: Cpu, hand: Handshake, receipt: Receipt,
  bell: Bell, printer: Printer, info: Info, home: HouseLine, copy: Copy, bolt: Lightning, moon: Moon, sun: Sun, text: TextAa, refresh: ArrowClockwise,
  prohibit: Prohibit, device: DeviceMobile, waves: Waves, temp: Thermometer,
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, weight = 'regular' }: { name: string; size?: number; weight?: 'regular' | 'bold' | 'fill' }) {
  const C = ICONS[name as IconName] ?? Info;
  return <C size={size} weight={weight} aria-hidden="true" />;
}

/* ---------- responsive tier ---------- */
export type Tier = 'phone' | 'tablet' | 'desktop' | 'wide';
const tierOf = (w: number): Tier => (w >= 1360 ? 'wide' : w >= 1100 ? 'desktop' : w >= 768 ? 'tablet' : 'phone');
export function useTier(): Tier {
  const [t, setT] = useState<Tier>(() => tierOf(typeof window === 'undefined' ? 390 : window.innerWidth));
  useEffect(() => {
    const on = () => setT(tierOf(window.innerWidth));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return t;
}

/* ---------- buttons ---------- */
type BtnProps = Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'title' | 'aria-label' | 'aria-pressed' | 'id' | 'className' | 'children'> & {
  variant?: 'fill' | 'tint' | 'gray' | 'plain' | 'bad';
  size?: 'lg' | 'md' | 'sm';
  block?: boolean;
  feel?: Haptic;
  onClick?: () => void;
  icon?: string;
};
export function Button({ variant = 'fill', size = 'md', block, feel = 'light', onClick, icon, children, className = '', ...rest }: BtnProps) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: motionTokens.scale.press }}
      transition={springs.instant}
      className={`btn btn-${variant} ${size === 'lg' ? 'btn-lg' : size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`}
      onClick={() => {
        haptic(feel);
        onClick?.();
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={20} />}
      {children}
    </motion.button>
  );
}

export function IconButton({ name, label, onClick }: { name: string; label: string; onClick: () => void }) {
  return (
    <motion.button type="button" className="iconbtn" aria-label={label} whileTap={{ scale: 0.9 }} onClick={() => { haptic('select'); onClick(); }}>
      <Icon name={name} />
    </motion.button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    const root = e.currentTarget;
    haptic('select');
    onChange(options[n].value);
    requestAnimationFrame(() => (root.querySelectorAll('button')[n] as HTMLElement | undefined)?.focus());
  };
  return (
    <div className="seg" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      <motion.span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 4px) / ${options.length})` }} animate={{ x: `${i * 100}%` }} transition={springs.snappy} />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} onClick={() => { haptic('select'); onChange(o.value); }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => { haptic(checked ? 'light' : 'medium'); onChange(!checked); }}>
      <motion.i layout transition={springs.snappy} />
    </button>
  );
}

/* ---------- lists ---------- */
export function Group({ title, children, note }: { title?: string; children: ReactNode; note?: string }) {
  return (
    <section>
      {title && <h2 className="group-title">{title}</h2>}
      <div className="group">{children}</div>
      {note && <p className="t-foot c2" style={{ padding: '8px 16px 0', margin: 0 }}>{note}</p>}
    </section>
  );
}

export function Row({ icon, tint, title, sub, trailing, onClick, chevron }: { icon?: string; tint?: string; title: ReactNode; sub?: ReactNode; trailing?: ReactNode; onClick?: () => void; chevron?: boolean }) {
  const body = (
    <>
      {icon && (
        <span className="lead" style={{ background: tint ? `color-mix(in srgb, ${tint} 14%, transparent)` : 'var(--fill)', color: tint ?? 'var(--fg-2)' }}>
          <Icon name={icon} size={19} />
        </span>
      )}
      <span className="grow">
        <span style={{ display: 'block' }}>{title}</span>
        {sub && <span className="t-foot c2" style={{ display: 'block' }}>{sub}</span>}
      </span>
      {trailing}
      {chevron && <span className="c3"><Icon name="chev" size={16} /></span>}
    </>
  );
  return onClick ? (
    <button type="button" className="row tap" onClick={() => { haptic('select'); onClick(); }}>{body}</button>
  ) : (
    <div className="row">{body}</div>
  );
}

export const Pill = ({ tone = '', children }: { tone?: '' | 'ok' | 'warn' | 'bad' | 'accent'; children: ReactNode }) => <span className={`pill ${tone}`}>{children}</span>;
export const DeptChip = ({ dept }: { dept: Dept }) => <span className={`dept dept-${dept}`}>{DEPTS[dept].short}</span>;
export const Avatar = ({ staff, large }: { staff?: Staff; large?: boolean }) => (
  <span className={`avatar ${large ? 'lg' : ''}`} aria-hidden="true">{staff?.initials ?? '?'}</span>
);

export function Ring({ ratio, size = 34, tone, children }: { ratio: number; size?: number; tone: 'ok' | 'warn' | 'bad'; children?: ReactNode }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0.04, Math.min(1, ratio));
  return (
    <span style={{ position: 'relative', width: size, height: size, display: 'inline-grid', placeItems: 'center', flex: 'none' }}>
      <svg className="ring" width={size} height={size} aria-hidden="true">
        <circle className="bg" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="4" />
        <circle className="fg" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="4" strokeLinecap="round" stroke={`var(--${tone})`} strokeDasharray={c} strokeDashoffset={c * (1 - v)} />
      </svg>
      {children && <span style={{ position: 'absolute', display: 'grid', placeItems: 'center', color: `var(--${tone})` }}>{children}</span>}
    </span>
  );
}

/* ---------- global feedback ---------- */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const icon = { info: 'info', success: 'tick', warn: 'warn', error: 'warn' } as const;
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div key={t.id} className={`toast ${t.tone}`} initial={{ opacity: 0, y: -24, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.97 }} transition={springs.sheet}>
            <Icon name={icon[t.tone]} size={20} weight="fill" />
            <span>{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Announcer() {
  const msg = useApp((s) => s.announce);
  return <div className="sr" role="status" aria-live="polite">{msg}</div>;
}

/** Shows what a phone would feel. Real vibration still fires where the platform allows it. */
export function HapticHud() {
  const show = useApp((s) => s.prefs.showHaptics && s.prefs.haptics);
  const [k, setK] = useState<{ kind: Haptic; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const on = (e: Event) => {
      setK((p) => ({ kind: (e as CustomEvent<Haptic>).detail, n: (p?.n ?? 0) + 1 }));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setK(null), 900);
    };
    hapticBus.addEventListener('haptic', on);
    return () => hapticBus.removeEventListener('haptic', on);
  }, []);
  return (
    <AnimatePresence>
      {show && k && (
        <motion.div key={k.n} className="hud" aria-hidden="true" initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={springs.instant}>
          <motion.i animate={{ scale: [1, 1.7, 1] }} transition={{ duration: 0.3 }} />
          haptic: {k.kind}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function NetPill() {
  const s = useApp((x) => x);
  const paper = paperMode(s);
  const pend = s.ops.filter((o) => !o.synced).length;
  const up = s.net.tier === 'resilient' ? s.net.power || s.net.ups > 0 : s.net.internet && s.net.power;
  const reach = up && s.net.deviceWifi;
  let cls = '';
  let text = '';
  let ic = 'cloud';
  if (paper) { cls = 'bad'; text = 'Paper mode'; ic = 'printer'; }
  else if (!reach) { cls = 'warn'; text = pend ? `Offline · ${pend} waiting` : 'Offline · saved on device'; ic = 'cloudoff'; }
  else if (s.reconciling) { cls = 'warn'; text = 'Catching up…'; ic = 'refresh'; }
  else { text = s.net.tier === 'resilient' ? 'Edge node · on LAN' : 'Cloud · online'; ic = 'cloud'; }
  return (
    <span className={`netpill ${cls}`} role="status" aria-label={`Connection: ${text}`}>
      {reach && !s.reconciling && !paper ? <span className="live" aria-hidden="true" /> : <Icon name={ic} size={16} weight="fill" />}
      {text}
    </span>
  );
}

export const useScrolled = () => {
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setScrolled(el.scrollTop > 36);
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);
  return { ref, scrolled };
};

export const readState = () => app.get();

/** Large-title screen: the compact title fades into a glass bar as the list scrolls. */
export function Screen({ title, subtitle, trailing, children }: { title: string; subtitle?: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  const { ref, scrolled } = useScrolled();
  return (
    <main className="screen" ref={ref} id="main" tabIndex={-1}>
      <header className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="nav-in nav-row">
          <span className="nav-title-sm" aria-hidden="true">{title}</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>{trailing}</span>
        </div>
      </header>
      <div className="inner">
        <div className="page-head">
          <h1 className="t-large">{title}</h1>
          {subtitle && <p className="t-sub c2" style={{ margin: 0 }}>{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}
