import { describe, expect, it } from 'vitest';
import { BUILTIN_DEFS, SEED_CATALOG, defOf, deleteBlocker, entriesOf, fieldProblem, staffPhonesOn, validateList, type Catalog, type ListDef } from '../../domain/catalog';
import { pinPeople } from '../../domain/rules';
import type { Staff } from '../../domain/types';
import { archiveQuestion, blankRow, isDirty, listSummary, toPayload, toRows } from '../../domain/listEdit';
import { REPORT_COMMANDS, readRefusal } from '../access';
import { TITLES, canEditLists, sectionsFor } from './sections';

// What the server sends for two module lists (Azl_Catalog::defs()).
const VEHICLES: ListDef = { key: 'vehicles', label: 'Vehicles', noun: ['vehicle', 'vehicles'], help: 'The hotel cars and vans.', maxItems: 3, fields: [], module: 'transport', usedBy: ['trip', 'trips'] };
const CODES: ListDef = {
  key: 'crisisCodes', label: 'Crisis codes', noun: ['radio code', 'radio codes'], help: '', maxItems: 30, module: 'crisis', usedBy: ['crisis case', 'crisis cases'],
  fields: [{ name: 'code', label: 'radio code', type: 'text', max: 8, required: true }, { name: 'complaint', label: 'guest complaint', type: 'bool', default: false }],
};
const NEWLIST: ListDef = { key: 'spaRooms', label: 'Spa rooms', noun: ['spa room', 'spa rooms'], help: 'A list from a future module.', maxItems: 10, fields: [{ name: 'beds', label: 'beds', type: 'int', min: 1, max: 4 }] };
const cat: Catalog = {
  ...SEED_CATALOG,
  defs: [...BUILTIN_DEFS, VEHICLES, CODES, NEWLIST],
  ...({
    vehicles: [{ key: 'van_1', label: 'Van 1', active: true }, { key: 'shuttle', label: 'Shuttle', active: false }],
    crisisCodes: [{ key: 'fire', label: 'Fire', code: '10-1', complaint: false, active: true }],
  } as object),
};

describe('Configuration sections', () => {
  const defs = cat.defs!;
  const ids = (v: Parameters<typeof sectionsFor>[1]) => sectionsFor(defs, v).map((s) => s.id);

  it('follows the prototype: its five sections first, in its order and wording, then the other lists and ours', () => {
    const s = sectionsFor(defs, { level: 'full', role: 'owner', asAccount: true });
    expect(s.slice(0, 5).map((x) => x.title)).toEqual(['Hotel Profile', 'Departments & Staff', 'Service Items', 'Crisis Codes', 'Vehicles']);
    expect(s.map((x) => x.id)).toEqual([
      'profile', 'departments', 'requestTypes', 'crisisCodes', 'vehicles', 'jobTitles', 'holdReasons', 'bundles', 'woFindings',
      'spaRooms', 'hdo', 'staffPhones', 'staff', 'logins', 'display', 'feel',
    ]);
    expect(s.find((x) => x.id === 'spaRooms')).toMatchObject({ kind: 'list', title: 'Spa rooms', def: NEWLIST, edit: true });
    expect(TITLES.woFindings).toBe('Work-Order Findings');
  });

  it('a module list the desk has never heard of gets a section from its definition alone', () => {
    const s = sectionsFor([...BUILTIN_DEFS, { ...NEWLIST, key: 'laundryBags', label: 'Laundry bags' }], { level: 'read', role: 'supervisor', asAccount: true });
    expect(s.find((x) => x.id === 'laundryBags')).toMatchObject({ title: 'Laundry bags', edit: false });
  });

  it('gates by role: owner edits everything, a manager lists and staff, a supervisor reads, a PIN person sees only this device', () => {
    const owner = sectionsFor(defs, { level: 'full', role: 'owner', asAccount: true });
    expect(owner.every((x) => x.edit)).toBe(true);
    const mgr = sectionsFor(defs, { level: 'full', role: 'manager', asAccount: true });
    expect(mgr.find((x) => x.id === 'profile')?.edit).toBe(false);
    expect(mgr.filter((x) => x.kind === 'list').every((x) => x.edit)).toBe(true);
    expect(ids({ level: 'full', role: 'manager', asAccount: true })).not.toContain('logins');
    expect(ids({ level: 'full', role: 'manager', asAccount: true })).toContain('staff');
    const sup = sectionsFor(defs, { level: 'read', role: 'supervisor', asAccount: true });
    expect(sup.filter((x) => x.kind !== 'display' && x.kind !== 'feel').some((x) => x.edit)).toBe(false);
    expect(sup.map((x) => x.id)).not.toContain('staff');
    expect(ids({ level: 'own', role: 'device', asAccount: false })).toEqual(['display', 'feel']);
    expect(ids({ level: 'none', role: 'device', asAccount: false })).toEqual([]);
    // An owner acting as a PIN person edits nothing of the hotel's (the server would refuse too).
    expect(sectionsFor(defs, { level: 'full', role: 'owner', asAccount: false }).filter((x) => x.edit).map((x) => x.id)).toEqual(['display', 'feel']);
    expect(canEditLists({ level: 'full', role: 'manager', asAccount: true })).toBe(true);
    expect(canEditLists({ level: 'full', role: 'supervisor', asAccount: true })).toBe(false);
  });
});

describe('the generic list editor', () => {
  it('reads any list and its definition; unknown lists are empty', () => {
    expect(entriesOf(cat, 'vehicles').map((x) => x.key)).toEqual(['van_1', 'shuttle']);
    expect(entriesOf(cat, 'nothing')).toEqual([]);
    expect(defOf(cat, 'vehicles')).toBe(VEHICLES);
    expect(defOf({ ...SEED_CATALOG }, 'departments')?.label).toBe('Departments'); // before the first snapshot
    expect(listSummary(cat, 'vehicles')).toBe('1 active · 1 archived');
    expect(listSummary(cat, 'spaRooms')).toBe('None yet');
  });

  it('a new row starts from the declared defaults; the dirty check follows the list', () => {
    expect(blankRow('crisisCodes', cat)).toMatchObject({ label: '', active: true, code: '', complaint: false });
    expect(blankRow('spaRooms', cat)).toMatchObject({ beds: 1 });
    const rows = toRows(cat, 'vehicles');
    expect(isDirty(rows, cat, 'vehicles')).toBe(false);
    expect(isDirty([...rows, blankRow('vehicles', cat)], cat, 'vehicles')).toBe(true);
  });

  it('validates like the server: names, duplicates, the list size and the declared fields', () => {
    const v = toPayload(toRows(cat, 'vehicles'));
    expect(validateList('vehicles', v, cat)).toBeNull();
    expect(validateList('vehicles', [...v, { label: 'van 1', active: true }], cat)).toEqual({ index: 2, error: '“van 1” is already in this list.' });
    expect(validateList('vehicles', [...v, { label: 'A', active: true }, { label: 'B', active: true }], cat)).toEqual({ error: 'Keep the list to 3 vehicles.' });
    const c = toPayload(toRows(cat, 'crisisCodes'));
    expect(validateList('crisisCodes', [...c, { label: 'Flood', active: true, code: '' } as never], cat)).toEqual({ index: 1, error: 'Enter the radio code.' });
    expect(validateList('crisisCodes', [...c, { label: 'Flood', active: true, code: '10-123456' } as never], cat)?.error).toBe('Keep the radio code under 8 characters.');
    expect(fieldProblem(NEWLIST.fields, { beds: 5 })).toBe('Enter a whole number for beds from 1 to 4.');
    expect(fieldProblem(CODES.fields, { code: '10-1', complaint: 'yes' })).toBe('Choose yes or no for guest complaint.');
    expect(validateList('nothing', [], cat)).toEqual({ error: 'Unknown list.' });
    // The built-in lists keep their wording (the server's nouns).
    expect(validateList('requestTypes', Array.from({ length: 81 }, () => ({ label: 'x', dept: 'it', slaMin: 5, icon: 'bell', active: true })), cat)?.error).toBe('Keep the list to 80 request types.');
  });

  it('refuses deleting an entry records use, with the same words as the server, and asks before archiving it', () => {
    const usage = { departments: {}, holdReasons: {}, lists: { vehicles: { van_1: 3 }, crisisCodes: { fire: 1 } } };
    expect(deleteBlocker('vehicles', 'van_1', cat, usage)).toBe('Used by 3 trips. Archive it instead.');
    expect(deleteBlocker('crisisCodes', 'fire', cat, usage)).toBe('Used by 1 crisis case. Archive it instead.');
    expect(deleteBlocker('vehicles', 'shuttle', cat, usage)).toBe('');
    expect(deleteBlocker('vehicles', 'van_1', cat, null)).toBe('');
    const row = toRows(cat, 'vehicles')[0]!;
    expect(archiveQuestion('vehicles', row, usage, cat)).toBe('3 trips use Van 1; they keep working and still show its name. Archive it so nobody picks it for new work?');
  });
});

describe('access mirror: report-only work orders', () => {
  it('a reader may report a work order but not change one; other modules stay view-only', () => {
    expect(REPORT_COMMANDS.reportWo).toBe('workorders');
    expect(readRefusal('workorders', 'reportWo')).toBe('');
    expect(readRefusal('workorders', 'assessWo')).toBe('You can report a new one in Work Orders, but only the help desk or the team that handles it can change it.');
    expect(readRefusal('housestatus', 'logHouse')).toBe('Your role can only view House Status.');
    expect(readRefusal('housestatus', 'reportWo')).toBe('Your role can only view House Status.');
  });
});

describe('Staff phones', () => {
  const sec = (v: Parameters<typeof sectionsFor>[1]) => sectionsFor(cat.defs!, v).find((x) => x.id === 'staffPhones');

  it('is off unless the catalog says on, and a department can switch itself off (Azl_Catalog::staff_phones)', () => {
    expect(SEED_CATALOG.staffPhones).toBeUndefined();
    expect(staffPhonesOn(SEED_CATALOG, 'housekeeping')).toBe(false);
    const on: Catalog = { ...SEED_CATALOG, staffPhones: true };
    expect(staffPhonesOn(on, 'housekeeping')).toBe(true);
    expect(staffPhonesOn(on, null)).toBe(true);
    const hkOff: Catalog = { ...on, departments: on.departments.map((d) => (d.key === 'housekeeping' ? { ...d, staffPhones: false } : d)) };
    expect(staffPhonesOn(hkOff, 'housekeeping')).toBe(false);
    expect(staffPhonesOn(hkOff, 'engineering')).toBe(true);
    // A department flag never turns on what the hotel switch has off.
    expect(staffPhonesOn({ ...hkOff, staffPhones: false }, 'engineering')).toBe(false);
    expect(staffPhonesOn({ ...on, staffPhones: 'yes' as never }, 'engineering')).toBe(false);
  });

  it('the Configuration section is for the hotel owner and managers to change; a supervisor only reads it; a PIN person does not see it', () => {
    expect(sec({ level: 'full', role: 'owner', asAccount: true })).toMatchObject({ kind: 'staffPhones', title: 'Staff Phones', edit: true });
    expect(sec({ level: 'full', role: 'manager', asAccount: true })?.edit).toBe(true);
    expect(sec({ level: 'read', role: 'supervisor', asAccount: true })?.edit).toBe(false);
    expect(sec({ level: 'full', role: 'owner', asAccount: false })?.edit).toBe(false); // an owner acting as a PIN person
    expect(sec({ level: 'own', role: 'device', asAccount: false })).toBeUndefined();
  });

  it('the department flag is a yes/no with the server wording, and a row left alone is not changed', () => {
    const d = toPayload(toRows(SEED_CATALOG, 'departments'));
    expect(validateList('departments', d.map((x, i) => (i === 0 ? { ...x, staffPhones: false } : x)), SEED_CATALOG)).toBeNull();
    expect(validateList('departments', d.map((x, i) => (i === 2 ? { ...x, staffPhones: 'no' as never } : x)), SEED_CATALOG)).toEqual({ index: 2, error: 'Choose whether its staff may use shared phones.' });
    expect(defOf(SEED_CATALOG, 'departments')?.fields.map((f) => f.name)).toEqual(['short', 'repairs', 'staffPhones']);
    // Ticking it back on sends nothing (the server stores only "off"), so the editor is not dirty.
    const rows = toRows(SEED_CATALOG, 'departments');
    expect(isDirty(rows.map((r, i) => (i === 0 ? { ...r, staffPhones: undefined } : r)), SEED_CATALOG, 'departments')).toBe(false);
  });

  it('the "Who\'s on shift?" picker offers no department staff who are off, and never the account itself', () => {
    const people: Staff[] = [
      { id: 'member', name: 'Owner', initials: 'O', role: 'owner', title: '', onShift: true },
      { id: 'a', name: 'Maria', initials: 'M', role: 'hdo', title: '', dept: 'frontdesk', onShift: true },
      { id: 'b', name: 'Joel', initials: 'J', role: 'staff', title: '', dept: 'housekeeping', onShift: true, phone: false },
      { id: 'c', name: 'Ramon', initials: 'R', role: 'staff', title: '', dept: 'engineering', onShift: true },
    ];
    expect(pinPeople(people).map((p) => p.id)).toEqual(['a', 'c']);
  });
});
