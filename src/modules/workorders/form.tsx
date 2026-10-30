// Form pieces for the Work Orders and Cleaning sheets: labelled fields with inline errors (aria-invalid,
// aria-describedby), a sheet whose footer has Cancel and the primary action with a saving state, and a choice list.
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Sheet } from '../../ui/sheet';
import { Button } from '../../ui/kit';
import './workorders.css';

export type Errors = Record<string, string | undefined>;

/** A labelled control. `children` gets the id and aria props to spread on the input, select or textarea. */
export function Field({ label, error, help, wide, children }: { label: string; error?: string; help?: string; wide?: boolean; children: (p: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode }) {
  const id = useId();
  const desc = [error ? `${id}-err` : '', help ? `${id}-help` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`fm-field ${wide ? 'wide' : ''}`}>
      <label className="field-label" htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': desc })}
      {help && <p className="field-help" id={`${id}-help`}>{help}</p>}
      {error && <p className="fm-error" id={`${id}-err`}>{error}</p>}
    </div>
  );
}

export function Choice({ value, onChange, options, ...p }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)} {...p}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="le-check fm-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** A section heading inside a form (the prototype's "REPORTED BY", "TARGET"). */
export const FormPart = ({ children }: { children: ReactNode }) => <h3 className="fm-part">{children}</h3>;

/**
 * A form in a sheet. `submit` validates and returns the errors (an empty object sends); the first invalid field gets
 * the focus. While `busy`, the primary button shows "Saving…" and cannot be pressed twice.
 */
export function FormSheet({ open, title, onClose, submitLabel, tone = 'fill', submit, summary, children }: {
  open: boolean; title: string; onClose: () => void; submitLabel: string; tone?: 'fill' | 'ok' | 'warn' | 'bad';
  submit: () => Errors | Promise<Errors>; summary?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const errs = await submit();
      if (Object.values(errs).some(Boolean)) requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <form ref={ref} className="fm" onSubmit={onSubmit} noValidate>
        {summary && <p className="fm-summary t-sub">{summary}</p>}
        <div className="fm-grid">{children}</div>
        <div className="fm-foot">
          <Button variant="gray" onClick={onClose}>Cancel</Button>
          <button type="submit" className={`btn btn-${tone}`} disabled={busy} aria-busy={busy || undefined}>{busy ? 'Saving…' : submitLabel}</button>
        </div>
      </form>
    </Sheet>
  );
}
