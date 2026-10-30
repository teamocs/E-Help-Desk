import { useSyncExternalStore, type ReactNode } from 'react';
import { createStore } from '../../domain/store';
import './modules.css';

/** A labelled form control with its inline error (read out when it appears) and hint. The control carries the id. */
export function Field({ id, label, error, hint, optional, children }: { id: string; label: string; error?: string; hint?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="mod-field">
      <label className="field-label" htmlFor={id}>{label}{optional && <span className="c2" style={{ fontWeight: 400 }}> (optional)</span>}</label>
      {children}
      {hint && !error && <p className="field-help" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="mod-error" id={`${id}-err`} role="alert">{error}</p>}
    </div>
  );
}

/** The props that tie a control to its Field's error and hint. */
export const aria = (id: string, error?: string, hint?: boolean) => ({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined });

/** Reads a small store made with createStore. */
export function useStore<S>(store: ReturnType<typeof createStore<S>>): S {
  return useSyncExternalStore(store.sub, store.get, store.get);
}
