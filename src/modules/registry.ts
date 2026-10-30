// The desk's modules, in sidebar order: the client prototype's 11 items. App.tsx builds the sidebar, the phone bar,
// the More sheet and the routing from this list only. Add a module: see README.md in this folder.
import type { Catalog } from '../domain/catalog';
import type { AccountRole } from '../domain/store';
import type { Staff } from '../domain/types';
import { MATRIX, kindOfStaffRole, levelOf, type Level, type Matrix } from './access';
import type { ModuleDef } from './types';
import dashboard from './dashboard';
import requests from './requests';
import inquiries from './inquiries';
import cleaning from './cleaning';
import workorders from './workorders';
import housestatus from './housestatus';
import crisis from './crisis';
import transport from './transport';
import reminders from './reminders';
import reports from './reports';
import config from './config';

export const MODULES: ModuleDef[] = [dashboard, requests, inquiries, cleaning, workorders, housestatus, crisis, transport, reminders, reports, config];

/** The prototype shows every badge, "0" included. Set to true to hide a badge at zero. */
export const HIDE_ZERO_BADGES = false;
/** A badge to show for this count, or null. */
export const badgeText = (n: number): string | null => (n > 0 || (!HIDE_ZERO_BADGES && n === 0) ? String(n) : null);

export interface Viewer {
  role: AccountRole;
  /** The account's own levels from the server (window.AZL.user.modules); used for owner, manager and supervisor. */
  accountModules?: Record<string, Level>;
  /** On a shared phone, the person signed in with a PIN. */
  me?: Pick<Staff, 'role' | 'dept'>;
  catalog: Catalog;
  /** The server's matrix (window.AZL.access); the desk's copy when missing. */
  access?: Matrix;
}

/** One module's level for this viewer, as the server decides it (Azl_Access::level). */
export function levelFor(m: ModuleDef, v: Viewer): Level {
  const matrix: Matrix = { ...MATRIX, ...(m.access ? { [m.id]: m.access } : {}), ...v.access };
  const repairs = (dept: string) => v.catalog.departments.some((d) => d.key === dept && d.active && d.repairs);
  // The server leaves out the modules an account may not see, so a missing id is none once it sent any.
  const fromServer = v.accountModules && Object.keys(v.accountModules).length > 0 ? v.accountModules : null;
  if (v.role !== 'device') return fromServer ? (fromServer[m.id] ?? 'none') : levelOf(m.id, { kind: v.role }, matrix, repairs);
  return levelOf(m.id, { kind: kindOfStaffRole(v.me?.role), dept: v.me?.dept }, matrix, repairs);
}

/** The modules this viewer may see, in sidebar order. */
export const visibleModules = (v: Viewer, mods: ModuleDef[] = MODULES): ModuleDef[] => mods.filter((m) => levelFor(m, v) !== 'none');
