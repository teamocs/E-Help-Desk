// Each hotel's own lists, as the server keeps them (azalea-ehelpdesk/includes/Catalog.php, option azl_catalog).
// The desk gets them inside every snapshot (`catalog`) and falls back to SEED_CATALOG (the factory lists) before
// the first snapshot and in tests. Records keep keys: an item's or a person's department, a held item's reason.
// An archived entry is hidden from new choices but its label still shows on old records; an unknown key shows as
// itself. Plain TypeScript with no imports: scripts/mock-wp.mjs loads this file directly.

/** `repairs`: the department handles repairs, so its on-site items can be escalated to a work order. */
export interface Department { key: string; label: string; short: string; repairs: boolean; active: boolean }
export interface RequestType { key: string; label: string; dept: string; slaMin: number; icon: string; active: boolean }
export interface BundlePart { name: string; dept: string; slaMin: number; after?: number }
export interface Bundle { key: string; label: string; hint: string; parts: BundlePart[]; active: boolean }
export interface Choice { key: string; label: string; active: boolean }

export interface Catalog {
  /** Goes up by one on every save. Sent back as baseRev; a different value means someone else saved. */
  catalogRev: number;
  departments: Department[];
  requestTypes: RequestType[];
  bundles: Bundle[];
  holdReasons: Choice[];
  jobTitles: Choice[];
  woFindings: Choice[];
  /** Every list's definition (Azl_Catalog::defs()), sent with the lists; missing before the first snapshot. */
  defs?: ListDef[];
}

/** One field of a list entry besides key, label and active. dept, icon and parts are the built-in lists' own. */
export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'bool' | 'int' | 'dept' | 'icon' | 'parts';
  max?: number;
  min?: number;
  required?: boolean;
  default?: unknown;
}

/**
 * How to edit one list, from the server (catalog.defs): a module's list arrives with its definition, so the
 * Configuration page edits it with no desk code. `usedBy`: the records that store its keys (singular, plural).
 */
export interface ListDef {
  key: string;
  label: string;
  noun: [string, string];
  help: string;
  maxItems: number;
  fields: FieldDef[];
  module?: string;
  usedBy?: [string, string];
}

/** The hotel profile (Azl_Profile, option azl_settings): the name is the one every page prints. */
export interface HotelProfile { name: string; short: string; contact: string; address: string; timeZone: string }
export const PROFILE_MAX = { name: 80, short: 20, contact: 120, address: 200 } as const;

/** A module list entry: key, label, active and its declared fields. */
export type ModuleEntry = Choice & Record<string, unknown>;

export type ListName = 'departments' | 'requestTypes' | 'bundles' | 'holdReasons' | 'jobTitles' | 'woFindings';
export type Entry = Department | RequestType | Bundle | Choice;
/** What the editor sends: a new entry has no key yet (the server makes one from the label). */
export type Draft<T extends Entry = Entry> = T extends Entry ? Omit<T, 'key'> & { key?: string } : never;

/** How many records use a department or hold reason (GET /catalog). People counts removed staff too. */
export interface Usage {
  departments: Record<string, { people?: number; requests?: number; workOrders?: number }>;
  holdReasons: Record<string, { requests?: number }>;
  /** Work orders not done yet. */
  openWorkOrders?: number;
  /** Module lists whose keys records store: list => key => number of records. */
  lists?: Record<string, Record<string, number>>;
}

/** The lists and how much each department and hold reason is used. */
export interface CatalogView { catalog: Catalog; usage: Usage }
/**
 * Saving one list. A refusal says why; `index` points at the entry the server objected to. `stale`: someone else
 * saved first; `catalog` and `usage` then hold the fresh lists to reload the editor with.
 */
export type CatalogSave = ({ ok: true } & CatalogView) | { ok: false; error: string; index?: number; stale?: boolean; catalog?: Catalog; usage?: Usage };
export const STALE_LIST = 'Someone else changed this list. Your screen was refreshed; try again.';

export const LISTS: ListName[] = ['departments', 'requestTypes', 'bundles', 'holdReasons', 'jobTitles', 'woFindings'];
export const LIMITS = { label: 40, short: 6, hint: 120, slaMin: 1440, parts: 6 } as const;
export const MAX: Record<ListName, number> = { departments: 40, requestTypes: 80, bundles: 20, holdReasons: 20, jobTitles: 60, woFindings: 20 };

/** Titles and one line of plain-language help for the Lists screen. */
export const LIST_META: Record<ListName, { title: string; one: string; help: string }> = {
  departments: { title: 'Departments', one: 'department', help: 'The teams that receive requests, like Housekeeping or Spa. Each has a short code for the badges.' },
  requestTypes: { title: 'Service items', one: 'service item', help: 'The buttons on a new request. Each goes to one department with a target time.' },
  bundles: { title: 'Bundles', one: 'bundle', help: 'One tap that sends several steps to different teams, like a leak: fix, then clean.' },
  holdReasons: { title: 'Hold reasons', one: 'hold reason', help: 'Why a job is waiting. The clock pauses while it is on hold.' },
  jobTitles: { title: 'Job titles', one: 'job title', help: 'Suggestions when you add a person. You can still type any title.' },
  woFindings: { title: 'Work-order findings', one: 'finding', help: 'Quick answers when someone assesses a repair. They can still type their own.' },
};

const NOUNS: Record<ListName, [string, string]> = {
  departments: ['department', 'departments'], requestTypes: ['request type', 'request types'], bundles: ['bundle', 'bundles'],
  holdReasons: ['hold reason', 'hold reasons'], jobTitles: ['job title', 'job titles'], woFindings: ['finding', 'findings'],
};
const BUILTIN_FIELDS: Partial<Record<ListName, FieldDef[]>> = {
  departments: [{ name: 'short', label: 'badge', type: 'text', max: LIMITS.short, required: true }, { name: 'repairs', label: 'handles repairs', type: 'bool', default: false }],
  requestTypes: [{ name: 'dept', label: 'department', type: 'dept', required: true }, { name: 'slaMin', label: 'target (minutes)', type: 'int', min: 1, max: LIMITS.slaMin }, { name: 'icon', label: 'icon', type: 'icon' }],
  bundles: [{ name: 'hint', label: 'what it does', type: 'text', max: LIMITS.hint }, { name: 'parts', label: 'steps', type: 'parts', max: LIMITS.parts }],
};
/** The built-in lists' definitions: what the server sends for them, used until the first snapshot arrives. */
export const BUILTIN_DEFS: ListDef[] = LISTS.map((key) => ({ key, label: LIST_META[key].title, noun: NOUNS[key], help: LIST_META[key].help, maxItems: MAX[key], fields: BUILTIN_FIELDS[key] ?? [] }));

/** Every list's definition: the server's, else the built-in ones. */
export const defsOf = (cat: Catalog): ListDef[] => (Array.isArray(cat.defs) && cat.defs.length ? cat.defs : BUILTIN_DEFS);
/** One list's definition, or undefined when the server does not know it. */
export const defOf = (cat: Catalog, list: string): ListDef | undefined => defsOf(cat).find((d) => d.key === list) ?? BUILTIN_DEFS.find((d) => d.key === list);
export const isBuiltin = (list: string): list is ListName => (LISTS as string[]).includes(list);
/** A list's entries, built-in or a module's (an unknown or missing list is empty). */
export const entriesOf = (cat: Catalog, list: string): Entry[] => {
  const v = (cat as unknown as Record<string, unknown>)[list];
  return Array.isArray(v) ? (v as Entry[]) : [];
};

/** The icons a request type may use (Azl_Catalog::ICONS in PHP), with a name for the picker. All exist in ui/icons.ts. */
export const REQUEST_ICONS: { name: string; label: string }[] = [
  ['towel', 'Towel'], ['bed', 'Bed'], ['drop', 'Water drop'], ['broom', 'Cleaning'], ['check', 'Check'], ['snow', 'Cold'],
  ['bulb', 'Light'], ['flame', 'Heat'], ['wifi', 'Wi-Fi'], ['tv', 'TV'], ['bottle', 'Bottle'], ['tray', 'Tray'],
  ['clock', 'Time'], ['ear', 'Noise'], ['wrench', 'Repair'], ['bell', 'Bell'], ['home', 'Room'], ['bolt', 'Power'],
  ['sun', 'Sun'], ['star', 'Star'], ['user', 'Person'], ['info', 'Info'], ['device', 'Phone app'], ['waves', 'Pool water'],
  ['printer', 'Printer'], ['hand', 'Help'], ['clip', 'Checklist'], ['spa', 'Spa'], ['shirt', 'Laundry'], ['key', 'Key'],
  ['car', 'Car'], ['suitcase', 'Luggage'], ['food', 'Food'], ['coffee', 'Coffee'], ['firstaid', 'First aid'],
  ['phone', 'Call'], ['trash', 'Trash'], ['plug', 'Plug'], ['bug', 'Pests'], ['pool', 'Pool'], ['baby', 'Baby'],
].map(([name, label]) => ({ name, label }));

const choices = (pairs: [string, string][]): Choice[] => pairs.map(([key, label]) => ({ key, label, active: true }));

/** The factory lists. Equal to Azl_Catalog::seed() in PHP. */
export const SEED_CATALOG: Catalog = {
  catalogRev: 0,
  departments: [
    { key: 'housekeeping', label: 'Housekeeping', short: 'HK', repairs: false, active: true },
    { key: 'engineering', label: 'Engineering', short: 'ENG', repairs: true, active: true },
    { key: 'it', label: 'IT', short: 'IT', repairs: true, active: true },
    { key: 'fnb', label: 'Food & Beverage', short: 'F&B', repairs: false, active: true },
    { key: 'frontdesk', label: 'Front Desk', short: 'FD', repairs: false, active: true },
    { key: 'security', label: 'Security', short: 'SEC', repairs: false, active: true },
  ],
  requestTypes: ([
    ['towels', 'Extra towels', 'housekeeping', 10, 'towel'], ['pillow', 'Extra pillow', 'housekeeping', 10, 'bed'],
    ['toiletries', 'Toiletries', 'housekeeping', 10, 'drop'], ['clean', 'Room cleaning', 'housekeeping', 30, 'broom'],
    ['inspection', 'Checkout inspection', 'housekeeping', 25, 'check'], ['ac', 'AC not cold', 'engineering', 45, 'snow'],
    ['bulb', 'Light bulb', 'engineering', 30, 'bulb'], ['hotwater', 'No hot water', 'engineering', 30, 'flame'],
    ['wifi', 'Wi-Fi issue', 'it', 20, 'wifi'], ['tv', 'TV not working', 'it', 20, 'tv'],
    ['water', 'Bottled water', 'fnb', 10, 'bottle'], ['tray', 'Tray pickup', 'fnb', 15, 'tray'],
    ['late', 'Late checkout', 'frontdesk', 15, 'clock'], ['noise', 'Noise complaint', 'security', 10, 'ear'],
  ] as const).map(([key, label, dept, slaMin, icon]) => ({ key, label, dept, slaMin, icon, active: true })),
  bundles: [
    {
      key: 'leak',
      label: 'Leak',
      hint: 'Engineering fixes the source, Housekeeping cleans up after',
      parts: [
        { name: 'Leak: fix source', dept: 'engineering', slaMin: 20 },
        { name: 'Leak: clean up', dept: 'housekeeping', slaMin: 25, after: 0 },
      ],
      active: true,
    },
  ],
  holdReasons: choices([['parts', 'Waiting for parts'], ['no_access', 'No access to room'], ['dnd', 'Guest on Do Not Disturb'], ['vendor', 'Waiting for vendor'], ['guest_declined', 'Guest declined for now']]),
  jobTitles: choices([['head_desk_officer', 'Head Desk Officer'], ['room_attendant', 'Room Attendant'], ['engineer', 'Engineer'], ['it_support', 'IT Support'], ['hk_supervisor', 'Housekeeping Supervisor'], ['duty_manager', 'Duty Manager'], ['night_engineer', 'Night Engineer']]),
  woFindings: choices([['worn_part', 'Worn part, replace'], ['leak_joint', 'Leak at joint, reseal'], ['repaint', 'Needs repainting'], ['vendor_repair', 'Vendor repair needed']]),
};

/* ---------- reading ---------- */

/** A catalog from the server, or null when it is missing or not shaped like one. */
export function isCatalog(x: unknown): x is Catalog {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Record<string, unknown>;
  return Number.isInteger(c.catalogRev) && LISTS.every((l) => Array.isArray(c[l]));
}

export const activeOf = <T extends { active: boolean }>(list: T[]): T[] => list.filter((x) => x.active);
export const activeDepartments = (cat: Catalog) => activeOf(cat.departments);
/** Active departments that handle repairs: where new work orders can go. */
export const repairDepartments = (cat: Catalog) => activeDepartments(cat).filter((d) => d.repairs === true);
/** An item in this department can become a work order (archived departments take no new work). */
export const canEscalate = (key: string, cat: Catalog) => repairDepartments(cat).some((d) => d.key === key);
const findKey = <T extends { key: string }>(list: T[], key: string | undefined) => (key == null ? undefined : list.find((x) => x.key === key));

/** The department's name, archived or not; an unknown key shows as itself. */
export const deptLabel = (key: string, cat: Catalog) => findKey(cat.departments, key)?.label ?? key;
/** The department's short code for badges; an unknown key shows as itself, upper case. */
export const deptShort = (key: string, cat: Catalog) => findKey(cat.departments, key)?.short ?? key.toUpperCase().slice(0, 6);
/** A hold reason's text, archived or not; an unknown key reads as words. */
export const holdLabel = (key: string, cat: Catalog) => findKey(cat.holdReasons, key)?.label ?? key.replace(/_/g, ' ');

/** The reason a swipe-to-hold uses: Do Not Disturb when it is active, else the first active reason. */
export const swipeHoldReason = (cat: Catalog) => (activeOf(cat.holdReasons).find((r) => r.key === 'dnd') ?? activeOf(cat.holdReasons)[0])?.key;

/* ---------- usage and wording ---------- */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const joinWords = (w: string[]) => (w.length <= 1 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`);

/** "3 people, 12 requests and 1 work order", or '' when nothing uses it. */
export function usageText(u: { people?: number; requests?: number; workOrders?: number } | undefined): string {
  if (!u) return '';
  const w: string[] = [];
  if (u.people) w.push(plural(u.people, 'person', 'people'));
  if (u.requests) w.push(plural(u.requests, 'request', 'requests'));
  if (u.workOrders) w.push(plural(u.workOrders, 'work order', 'work orders'));
  return joinWords(w);
}

/** The request types and bundles that use a department (only the active ones when activeOnly). */
export function catalogUsers(cat: Catalog, dept: string, activeOnly: boolean): string[] {
  return [
    ...cat.requestTypes.filter((t) => t.dept === dept && (!activeOnly || t.active)).map((t) => t.label),
    ...cat.bundles.filter((b) => (!activeOnly || b.active) && b.parts.some((p) => p.dept === dept)).map((b) => `${b.label} bundle`),
  ];
}

/** "3 trips": how many records use a module list's entry, or '' when none (or the list stores no keys). */
export function recordsText(cat: Catalog, list: string, key: string, usage: Usage | null): string {
  const n = usage?.lists?.[list]?.[key] ?? 0;
  const noun = defOf(cat, list)?.usedBy;
  return n > 0 && noun ? plural(n, noun[0], noun[1]) : '';
}

/** Why this saved entry cannot be deleted, or '' when it can. */
export function deleteBlocker(list: string, key: string, cat: Catalog, usage: Usage | null): string {
  if (!isBuiltin(list)) {
    const used = recordsText(cat, list, key, usage);
    return used ? `Used by ${used}. Archive it instead.` : '';
  }
  if (list === 'departments') {
    const used = usageText(usage?.departments[key]);
    if (used) return `Used by ${used}. Archive it instead.`;
    const users = catalogUsers(cat, key, false);
    if (users.length) return `Used by ${joinWords(users)}. Move or delete them first.`;
  }
  if (list === 'holdReasons') {
    const used = usageText(usage?.holdReasons[key]);
    if (used) return `Used by ${used} on hold. Archive it instead.`;
  }
  return '';
}

/* ---------- checking a list before saving (the server checks again) ---------- */

export interface Problem { index?: number; error: string }

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '');
const goodSla = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= LIMITS.slaMin;

/** The first problem with an edited list, worded like the server, or null. `cat` is the catalog it was loaded from. */
export function validateList(list: string, items: Draft[], cat: Catalog, openWorkOrders = 0): Problem | null {
  const def = defOf(cat, list);
  if (!def) return { error: 'Unknown list.' };
  if (items.length > def.maxItems) return { error: `Keep the list to ${def.maxItems} ${def.noun[1]}.` };
  const labels = new Set<string>();
  const deptOk = (dept: string, active: boolean) => {
    const d = cat.departments.find((x) => x.key === dept);
    if (!d) return 'Pick a department.';
    return active && !d.active ? 'Pick an active department, or archive this first.' : '';
  };
  for (const [index, x] of items.entries()) {
    const label = clean(x.label);
    if (!label || label.length > LIMITS.label) return { index, error: `Enter a name of 1 to ${LIMITS.label} characters.` };
    if (labels.has(label.toLowerCase())) return { index, error: `“${label}” is already in this list.` };
    labels.add(label.toLowerCase());
    if (list === 'departments') {
      const short = clean((x as Draft<Department>).short);
      if (!short || short.length > LIMITS.short) return { index, error: `Enter a short code of 1 to ${LIMITS.short} characters.` };
      const repairs = (x as Draft<Department>).repairs;
      if (repairs !== undefined && typeof repairs !== 'boolean') return { index, error: 'Choose whether it handles repairs.' };
    }
    if (list === 'requestTypes') {
      const t = x as Draft<RequestType>;
      const bad = deptOk(t.dept, t.active);
      if (bad) return { index, error: bad };
      if (!goodSla(t.slaMin)) return { index, error: `Set a target of 1 to ${LIMITS.slaMin} minutes.` };
      if (!REQUEST_ICONS.some((i) => i.name === t.icon)) return { index, error: 'Pick an icon from the list.' };
    }
    if (list === 'bundles') {
      const b = x as Draft<Bundle>;
      if (clean(b.hint).length > LIMITS.hint) return { index, error: `Keep the description under ${LIMITS.hint} characters.` };
      if (!b.parts.length || b.parts.length > LIMITS.parts) return { index, error: `A bundle has 1 to ${LIMITS.parts} steps.` };
      for (const [j, p] of b.parts.entries()) {
        const n = j + 1;
        const name = clean(p.name);
        if (!name || name.length > LIMITS.label) return { index, error: `Step ${n}: enter a name of 1 to ${LIMITS.label} characters.` };
        const bad = deptOk(p.dept, b.active);
        if (bad) return { index, error: `Step ${n}: ${bad}` };
        if (!goodSla(p.slaMin)) return { index, error: `Step ${n}: set a target of 1 to ${LIMITS.slaMin} minutes.` };
        if (p.after != null && !(Number.isInteger(p.after) && p.after >= 0 && p.after < j)) return { index, error: `Step ${n} can only wait for an earlier step.` };
      }
    }
    if (!isBuiltin(list)) {
      const bad = fieldProblem(def.fields, x as unknown as Record<string, unknown>);
      if (bad) return { index, error: bad };
    }
  }
  if ((list === 'departments' || list === 'holdReasons') && !items.some((x) => x.active)) {
    return { error: `Keep at least one active ${def.noun[0]}.` };
  }
  if (list === 'departments') {
    for (const [index, d] of items.entries()) {
      const users = d.active || !d.key ? [] : catalogUsers(cat, d.key, true);
      if (users.length) return { index, error: `${clean(d.label)} is used by ${joinWords(users)}. Archive them or move them to another department first.` };
    }
  }
  // While work orders are open (the server counts them), one active department must still handle repairs.
  if (list === 'departments' && openWorkOrders > 0 && !items.some((d) => d.active && (d as Draft<Department>).repairs)) {
    return { error: `${openWorkOrders} open work order${openWorkOrders === 1 ? '' : 's'} need a department that handles repairs. Keep at least one active one.` };
  }
  return null;
}

/** A module list entry's declared fields, worded like Azl_Catalog::module_entry(), or '' when they are fine. */
export function fieldProblem(fields: FieldDef[], x: Record<string, unknown>): string {
  for (const f of fields) {
    const v = x[f.name] ?? f.default;
    if (f.type === 'bool') {
      if (v != null && typeof v !== 'boolean') return `Choose yes or no for ${f.label}.`;
    } else if (f.type === 'int') {
      const min = f.min ?? 0, max = f.max ?? Number.MAX_SAFE_INTEGER;
      if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) return `Enter a whole number for ${f.label} from ${min} to ${max}.`;
    } else if (f.type === 'text') {
      const t = clean(v ?? '');
      const max = f.max ?? LIMITS.label;
      if (f.required && !t) return `Enter the ${f.label}.`;
      if (t.length > max) return `Keep the ${f.label} under ${max} characters.`;
    }
  }
  return '';
}
