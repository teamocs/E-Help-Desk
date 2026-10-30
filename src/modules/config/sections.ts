// The Configuration page's sections: which ones a viewer sees, in which order, and which they may change. Kept apart
// from the screen so it can be tested without a browser.
import type { ListDef } from '../../domain/catalog';
import type { AccountRole } from '../../domain/store';
import type { Level } from '../access';

export type SectionKind = 'profile' | 'list' | 'hdo' | 'staff' | 'logins' | 'display' | 'feel';

export interface Section {
  /** Unique: the list key for a list, else the kind. Also the element id (`cfg-<id>`). */
  id: string;
  kind: SectionKind;
  title: string;
  /** The viewer may change it here. */
  edit: boolean;
  /** For a list: its definition from the server. */
  def?: ListDef;
}

export interface ConfigViewer {
  /** The viewer's level on the config module (Azl_Access): own = this device's preferences only. */
  level: Level;
  role: AccountRole;
  /** On their own account, not acting as a PIN person. */
  asAccount: boolean;
}

/**
 * The client prototype's five sections first, in its order and wording (Hotel Profile, Departments & Staff, Service
 * Items, Crisis Codes, Vehicles), then the lists it keeps in code, then ours. A list the desk does not know (a new
 * module's) follows the known ones under its own label, so it needs no desk code.
 */
export const LIST_ORDER = ['departments', 'requestTypes', 'crisisCodes', 'vehicles', 'woAreas', 'cleaningTypes', 'complaintCategories', 'crisisLocations', 'involvedTypes', 'jobTitles', 'holdReasons', 'bundles', 'woFindings'];

export const TITLES: Record<string, string> = {
  profile: 'Hotel Profile',
  departments: 'Departments & Staff',
  requestTypes: 'Service Items',
  crisisCodes: 'Crisis Codes',
  vehicles: 'Vehicles',
  woAreas: 'Areas',
  cleaningTypes: 'Cleaning Types',
  complaintCategories: 'Complaint Categories',
  crisisLocations: 'Crisis Locations',
  involvedTypes: 'Involved Types',
  jobTitles: 'Job Titles',
  holdReasons: 'Hold Reasons',
  bundles: 'Bundles',
  woFindings: 'Work-Order Findings',
  hdo: 'Help-Desk Staff',
  staff: 'Staff (PINs)',
  logins: 'Logins',
  display: 'Display',
  feel: 'Feel',
};

/** The lists the owner and managers change: on their own account, not while acting as a PIN person. */
export const canEditLists = (v: ConfigViewer) => v.asAccount && (v.role === 'owner' || v.role === 'manager');

/** The sections this viewer sees, in page order. */
export function sectionsFor(defs: ListDef[], v: ConfigViewer): Section[] {
  const prefs: Section[] = [
    { id: 'display', kind: 'display', title: TITLES.display!, edit: true },
    { id: 'feel', kind: 'feel', title: TITLES.feel!, edit: true },
  ];
  if (v.level === 'none') return [];
  if (v.level === 'own') return prefs; // B.3 "own prefs only": this device's preferences
  const admin = canEditLists(v);
  const rank = (k: string) => (LIST_ORDER.includes(k) ? LIST_ORDER.indexOf(k) : LIST_ORDER.length);
  const lists = defs
    .map((def, i) => ({ def, i }))
    .sort((a, b) => rank(a.def.key) - rank(b.def.key) || a.i - b.i)
    .map(({ def }): Section => ({ id: def.key, kind: 'list', title: TITLES[def.key] ?? def.label, edit: admin, def }));
  const out: Section[] = [
    { id: 'profile', kind: 'profile', title: TITLES.profile!, edit: v.asAccount && v.role === 'owner' },
    ...lists,
    { id: 'hdo', kind: 'hdo', title: TITLES.hdo!, edit: admin },
  ];
  if (admin) out.push({ id: 'staff', kind: 'staff', title: TITLES.staff!, edit: true });
  if (v.asAccount && v.role === 'owner') out.push({ id: 'logins', kind: 'logins', title: TITLES.logins!, edit: true });
  return [...out, ...prefs];
}
