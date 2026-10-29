import { createElement, useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { haptic, type Haptic } from '../lib/haptics';
import { springs, motionTokens } from '../lib/motion';
import { useApp, useUI } from '../domain/store';
import { DEPTS } from '../domain/rules';
import type { Dept, Staff } from '../domain/types';
import { ICONS } from './icons';

export function Icon({ name, size = 22, weight = 'regular' }: { name: string; size?: number; weight?: 'regular' | 'bold' | 'fill' }) {
  const set = ICONS[name] ?? ICONS.info;
  const els = set[weight === 'fill' ? 1 : 0];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      {els.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
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
      <motion.span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${options.length})` }} animate={{ x: `${i * 100}%` }} transition={springs.snappy} />
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
      {note && <p className="t-foot c2" style={{ padding: '8px 4px 0', margin: 0 }}>{note}</p>}
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

/** A real empty state: what this place is for, and the one thing to do next. */
export function Empty({ icon, text, action, onAction }: { icon: string; text: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="empty">
      <span className="empty-ico" aria-hidden="true"><Icon name={icon} size={26} /></span>
      <p>{text}</p>
      {action && onAction && <Button size="sm" onClick={onAction}>{action}</Button>}
    </div>
  );
}

export const Pill = ({ tone = '', children }: { tone?: '' | 'ok' | 'warn' | 'bad' | 'accent' | 'gold'; children: ReactNode }) => <span className={`pill ${tone}`}>{children}</span>;
export const DeptChip = ({ dept }: { dept: Dept }) => <span className={`dept dept-${dept}`} title={DEPTS[dept].label}>{DEPTS[dept].short}</span>;
export const Avatar = ({ staff, large }: { staff?: Pick<Staff, 'initials'>; large?: boolean }) => (
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

/* ---------- connection ---------- */
const subOnline = (f: () => void) => {
  window.addEventListener('online', f);
  window.addEventListener('offline', f);
  return () => {
    window.removeEventListener('online', f);
    window.removeEventListener('offline', f);
  };
};
const useBrowserOnline = () => useSyncExternalStore(subOnline, () => navigator.onLine, () => true);

/** Online, Syncing or Offline, from the browser, the poller and the outbox. Pure function for tests. */
export function connState(online: boolean, sync: { pending: number; offline: boolean }, pollDown: boolean): { tone: 'ok' | 'warn'; text: string } {
  const n = sync.pending;
  if (!online || sync.offline || pollDown) return { tone: 'warn', text: n ? `Offline · ${n} waiting` : 'Offline' };
  if (n) return { tone: 'ok', text: `Syncing ${n}` };
  return { tone: 'ok', text: 'Online' };
}

export function ConnChip() {
  const online = useBrowserOnline();
  const sync = useUI((s) => s.sync);
  const pollDown = useUI((s) => s.pollDown);
  const { tone, text } = connState(online, sync, pollDown);
  const icon = tone === 'warn' ? 'cloudoff' : sync.pending ? 'cloud' : '';
  const long = tone === 'warn' ? (sync.pending ? `${sync.pending} change${sync.pending === 1 ? ' is' : 's are'} saved on this device and will send when the connection returns.` : 'Changes are saved on this device.') : '';
  return (
    <span className={`conn ${tone === 'warn' ? 'warn' : ''}`} role="status" aria-live="polite" title={long || undefined}>
      {icon ? <Icon name={icon} size={16} weight="fill" /> : <span className="dot" aria-hidden="true" />}
      <span>{text}</span>
      {long && <span className="sr">{long}</span>}
    </span>
  );
}

/** One header for every screen: the title and its line, then the actions. */
export function Screen({ title, subtitle, trailing, children }: { title: string; subtitle?: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  const tier = useTier();
  return (
    <main className="screen" id="main" tabIndex={-1}>
      <div className="inner">
        <header className="page-head">
          <div>
            <h1 className="t-large">{title}</h1>
            {subtitle && <p className="t-sub c2" style={{ margin: 0 }}>{subtitle}</p>}
          </div>
          {(tier !== 'phone' || trailing) && (
            <div className="page-actions">
              {tier !== 'phone' && <ConnChip />}
              {trailing}
            </div>
          )}
        </header>
        {children}
      </div>
    </main>
  );
}
