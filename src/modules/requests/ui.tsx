import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from '../../ui/sheet';
import type { Item, Staff, State } from '../../domain/types';
import { dur, durWords, type Timer } from './logic';
import './requests.css';

export const STATUS_WORD: Record<Item['status'], string> = {
  new: 'New', relayed: 'Relayed', on_site: 'On site', on_hold: 'On hold', done: 'Done', transferred: 'Transferred',
  escalated: 'Work order', cant_do: "Can't do", duplicate: 'Duplicate', cancelled: 'Cancelled',
};

export const StatusBadge = ({ status }: { status: Item['status'] }) => <span className={`st st-${status}`}>{STATUS_WORD[status]}</span>;

/** A timer cell; "—" until the step happened, as the prototype prints it. */
export function TimerText({ t, label }: { t?: Timer; label: string }) {
  if (!t) return <span className="tm-none" aria-label={`${label}: not yet`}>—</span>;
  return (
    <span className={`tm ${t.live ? 'live' : ''} ${t.tone}`} aria-label={`${label}: ${durWords(t.ms)}${t.live ? ', running' : ''}${t.tone === 'bad' ? ', over target' : ''}`}>
      {dur(t.ms)}
    </span>
  );
}

/** A modal over everything (portalled, so it works from inside the drawer's own sheet). Bottom sheet on phones. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(<Sheet open={open} title={title} onClose={onClose}>{children}</Sheet>, document.body);
}

/** A labelled field with its help or error underneath, wired for screen readers. */
export function Field({ label, error, help, children }: { label: string; error?: string; help?: string; children: (a: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode }) {
  const id = useId();
  const note = `${id}-note`;
  return (
    <div className="rq-field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {children({ id, ...(error ? { 'aria-invalid': true as const } : {}), ...(error || help ? { 'aria-describedby': note } : {}) })}
      {error ? <p className="rq-err" id={note} role="alert">{error}</p> : help ? <p className="field-help" id={note}>{help}</p> : null}
    </div>
  );
}

/** People of a department, on shift first, then by name. */
export const deptStaff = (staff: Staff[], dept?: string) =>
  staff.filter((p) => dept && p.dept === dept && p.id !== 'member').sort((a, b) => Number(b.onShift) - Number(a.onShift) || a.name.localeCompare(b.name));

/** Who may be a ticket's help-desk officer (Azl_Commands::HDO_ROLES). */
export const hdoChoices = (staff: Staff[]) => staff.filter((p) => p.id !== 'member' && ['hdo', 'supervisor', 'manager', 'owner'].includes(p.role));

export const personName = (s: Pick<State, 'staff'>, id?: string) => (id ? s.staff.find((p) => p.id === id)?.name ?? 'Someone removed' : '');

const timeFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** A moment in the hotel's time: "Oct 30, 10:30 AM". */
export const hotelTime = (ms: number) => timeFmt.format(ms);
