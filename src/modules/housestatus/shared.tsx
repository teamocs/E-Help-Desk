import { useId, type ReactNode } from 'react';
import { myStaff, useApp, useUI } from '../../domain/store';
import type { Staff } from '../../domain/types';
import { MATRIX, kindOfStaffRole, levelOf, type Level, type Matrix } from '../access';

/** This viewer's level on one module, as the server decides it (window.AZL.access, Azl_Access::level). */
export function useModuleLevel(id: string): Level {
  const role = useUI((s) => s.account.role);
  const accountModules = useUI((s) => s.account.modules);
  const access = useUI((s) => s.access);
  const me = useApp(myStaff);
  const matrix: Matrix = { ...MATRIX, ...access };
  const fromServer = accountModules && Object.keys(accountModules).length > 0 ? accountModules : null;
  if (role !== 'device') return fromServer ? (fromServer[id] ?? 'none') : levelOf(id, { kind: role }, matrix);
  return levelOf(id, { kind: kindOfStaffRole(me?.role), dept: me?.dept }, matrix);
}

/** The name behind a staff id; a manager's own account has no staff row, so it reads "Manager". */
export const nameOf = (id: string | undefined, staff: Pick<Staff, 'id' | 'name'>[]): string => staff.find((p) => p.id === id)?.name ?? 'Manager';

/** A labelled form field: the label, the control, the help text, and the inline error tied to the control for screen readers. */
export function Field({ label, error, help, required, children }: { label: string; error?: string; help?: string; required?: boolean; children: (p: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string; 'aria-required'?: boolean }) => ReactNode }) {
  const id = useId();
  const note = error ? `${id}-e` : help ? `${id}-h` : undefined;
  return (
    <div style={{ marginTop: 14 }}>
      <label className="field-label" htmlFor={id}>{label}{required ? <span className="c2" aria-hidden="true"> *</span> : null}</label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': note, 'aria-required': required || undefined })}
      {error ? <p id={`${id}-e`} className="field-help hs-error" role="alert">{error}</p> : help ? <p id={`${id}-h`} className="field-help">{help}</p> : null}
    </div>
  );
}
