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
}

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
  requestTypes: { title: 'Request types', one: 'request type', help: 'The buttons on a new request. Each goes to one department with a target time.' },
  bundles: { title: 'Bundles', one: 'bundle', help: 'One tap that sends several steps to different teams, like a leak: fix, then clean.' },
  holdReasons: { title: 'Hold reasons', one: 'hold reason', help: 'Why a job is waiting. The clock pauses while it is on hold.' },
  jobTitles: { title: 'Job titles', one: 'job title', help: 'Suggestions when you add a person. You can still type any title.' },
  woFindings: { title: 'Work-order findings', one: 'finding', help: 'Quick answers when someone assesses a repair. They can still type their own.' },
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

/** Why this saved entry cannot be deleted, or '' when it can. */
export function deleteBlocker(list: ListName, key: string, cat: Catalog, usage: Usage | null): string {
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
export function validateList(list: ListName, items: Draft[], cat: Catalog, openWorkOrders = 0): Problem | null {
  if (items.length > MAX[list]) return { error: `Keep the list to ${MAX[list]} ${LIST_META[list].title.toLowerCase()}.` };
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
  }
  if ((list === 'departments' || list === 'holdReasons') && !items.some((x) => x.active)) {
    return { error: `Keep at least one active ${LIST_META[list].one}.` };
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
