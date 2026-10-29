// The list editors' logic, kept apart from the screens so it can be tested without a browser.
import { activeDepartments, deleteBlocker, usageText, type Catalog, type Draft, type Entry, type ListName, type Usage } from './catalog';

/** One entry while it is being edited: `uid` tells React rows apart (the key, or a temporary id for new entries). */
export type Row = Draft & { uid: string };

let seq = 0;
const tempId = () => `new-${++seq}`;

/** The list as the editor starts it. */
export const toRows = (cat: Catalog, list: ListName): Row[] => (cat[list] as Entry[]).map((x) => ({ ...x, uid: x.key }));

/** What the server gets: the rows without the editor's ids, in their order. */
export const toPayload = (rows: Row[]): Draft[] =>
  rows.map((r) => {
    const x = { ...r } as Partial<Row>;
    delete x.uid;
    return x as Draft;
  });

/** True when the rows differ from the saved list. */
export const isDirty = (rows: Row[], cat: Catalog, list: ListName) => JSON.stringify(toPayload(rows)) !== JSON.stringify(cat[list]);

/** A blank entry for the list, pointing at the first active department where one is needed. */
export function blankRow(list: ListName, cat: Catalog): Row {
  const dept = activeDepartments(cat)[0]?.key ?? '';
  const base = { uid: tempId(), label: '', active: true };
  if (list === 'departments') return { ...base, short: '', repairs: false };
  if (list === 'requestTypes') return { ...base, dept, slaMin: 15, icon: 'bell' };
  if (list === 'bundles') return { ...base, hint: '', parts: [{ name: '', dept, slaMin: 20 }] };
  return base;
}

/** Moves the row at i one place up (-1) or down (+1). Out of range: unchanged. */
export function move<T>(rows: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (i < 0 || j < 0 || i >= rows.length || j >= rows.length) return rows;
  const next = [...rows];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Removes bundle step k. A step that waited for it no longer waits; later "after" links shift down by one. */
export function removePart<P extends { after?: number }>(parts: P[], k: number): P[] {
  return parts
    .filter((_, j) => j !== k)
    .map((p) => {
      if (p.after == null) return p;
      if (p.after === k) return { ...p, after: undefined };
      return p.after > k ? { ...p, after: p.after - 1 } : p;
    });
}

/** A short code suggested from a department name: initials of up to three words, or the first three letters. */
export function suggestShort(label: string): string {
  const words = label.replace(/[^\p{L}\p{N}\s&]/gu, ' ').split(/\s+/).filter((w) => w && w !== '&');
  if (!words.length) return '';
  return (words.length === 1 ? words[0]!.slice(0, 3) : words.slice(0, 3).map((w) => w[0]).join('')).toUpperCase();
}

/**
 * What to ask before archiving a saved department or hold reason that records use, or '' to archive without asking.
 * Records keep working: they keep the key and still show the name.
 */
export function archiveQuestion(list: ListName, row: Row, usage: Usage | null): string {
  if (!row.key) return '';
  const u = list === 'departments' ? usage?.departments[row.key] : list === 'holdReasons' ? usage?.holdReasons[row.key] : undefined;
  const used = usageText(u);
  if (!used) return '';
  return `${used} use ${row.label}; they keep working and still show its name. Archive it so nobody picks it for new work?`;
}

/**
 * Deleting a row: '' when it can go (a new row always can), otherwise why not. Saved departments and hold reasons
 * that records use can only be archived.
 */
export const deleteProblem = (list: ListName, row: Row, cat: Catalog, usage: Usage | null) => (row.key ? deleteBlocker(list, row.key, cat, usage) : '');

/** "6 active · 1 archived" for the Lists overview. */
export function listSummary(cat: Catalog, list: ListName): string {
  const all = cat[list] as Entry[];
  const off = all.filter((x) => !x.active).length;
  if (!all.length) return 'None yet';
  return off ? `${all.length - off} active · ${off} archived` : `${all.length} active`;
}
