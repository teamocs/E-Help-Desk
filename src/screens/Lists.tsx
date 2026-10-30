import { useEffect, useRef, useState } from 'react';
import {
  LIMITS, REQUEST_ICONS, activeDepartments, defOf, deptLabel, isBuiltin, recordsText, usageText, validateList,
  type BundlePart, type Catalog, type Draft, type FieldDef, type ListDef, type Problem, type RequestType, type Usage, type Bundle, type Department, type CatalogView,
} from '../domain/catalog';
import { archiveQuestion, blankRow, deleteProblem, isDirty, move, removePart, suggestShort, toPayload, toRows, type Row } from '../domain/listEdit';
import { staffApi } from '../domain/staffApi';
import type { Outcome } from '../domain/contract';
import { app, toast } from '../domain/store';
import { Button, Icon, Pill } from '../ui/kit';
import { Sheet } from '../ui/sheet';

/** An icon per list (lists the desk does not know use a generic one). */
export const LIST_ICON: Record<string, string> = {
  departments: 'home', requestTypes: 'bell', bundles: 'bolt', holdReasons: 'hourglass', jobTitles: 'user', woFindings: 'wrench',
  woAreas: 'clip', cleaningTypes: 'broom', vehicles: 'van', crisisCodes: 'siren', complaintCategories: 'chat', crisisLocations: 'info', involvedTypes: 'user',
};
export const listIcon = (list: string) => LIST_ICON[list] ?? 'list';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const focusSoon = (sel: string) => requestAnimationFrame(() => {
  const el = document.querySelector<HTMLElement>(sel);
  el?.focus();
  el?.scrollIntoView?.({ block: 'nearest' });
});

/**
 * One list in a bottom sheet, any list the server declares (catalog.defs): the built-in lists keep their richer
 * fields; a module's list gets name, its declared fields, active, order, archive, restore and delete when unused.
 * Edits stay on this phone until Save, which replaces the whole list in one step.
 */
export function ListEditor({ list, title, onClose }: { list: string; title?: string; onClose: () => void }) {
  // Mounted per list (key={list}): it starts from the lists this phone has, then loads the server's with usage.
  const [base, setBase] = useState<Catalog>(() => app.get().catalog);
  const [rows, setRows] = useState<Row[]>(() => toRows(app.get().catalog, list));
  const [usage, setUsage] = useState<Usage | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const touched = useRef(false);

  function reset(cat: Catalog, l: string) {
    setBase(cat);
    setRows(toRows(cat, l));
    touched.current = false;
  }

  function fresh(r: Outcome<CatalogView>) {
    if (!r.ok) { setLoadErr(r.error); return; }
    setLoadErr('');
    setUsage(r.usage);
    if (!touched.current) reset(r.catalog, list); // never wipe what someone is already typing
  }
  const fetchFresh = () => void staffApi.current?.catalog().then(fresh);

  useEffect(() => {
    let live = true;
    void staffApi.current?.catalog().then((r) => { if (live) fresh(r); });
    return () => { live = false; };
    // Once per opened list (the editor is mounted per list).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const def: ListDef = defOf(base, list) ?? { key: list, label: list, noun: ['entry', 'entries'], help: '', maxItems: 20, fields: [] };
  const meta = { title: title ?? def.label, one: def.noun[0], help: def.help };
  const dirty = isDirty(rows, base, list);

  const update = (next: Row[]) => {
    touched.current = true;
    setRows(next);
  };
  const patch = (uid: string, p: Partial<Row>) => {
    update(rows.map((r) => (r.uid === uid ? ({ ...r, ...p } as Row) : r)));
    if (problem) setProblem(null);
  };
  const close = () => {
    if (dirty && !window.confirm(`Discard your changes to ${meta.title.toLowerCase()}?`)) return;
    onClose();
  };

  const add = () => {
    const row = blankRow(list, base);
    update([...rows, row]);
    setProblem(null);
    focusSoon(`#le-${row.uid}-label`);
  };
  const shift = (i: number, by: -1 | 1) => {
    const uid = rows[i]!.uid;
    update(move(rows, i, by));
    requestAnimationFrame(() => {
      const want = document.querySelector<HTMLButtonElement>(`[data-move="le-${uid}:${by}"]`);
      (want && !want.disabled ? want : document.querySelector<HTMLButtonElement>(`[data-move="le-${uid}:${-by}"]`))?.focus();
    });
  };
  const toggleArchive = (r: Row) => {
    if (r.active) {
      const q = archiveQuestion(list, r, usage, base);
      if (q && !window.confirm(q)) return;
    }
    patch(r.uid, { active: !r.active });
  };
  const remove = (i: number) => {
    const r = rows[i]!;
    const blocked = deleteProblem(list, r, base, usage);
    if (blocked) { setProblem({ index: i, error: blocked }); return; }
    if (r.key && !window.confirm(`Delete ${r.label || 'this entry'}? It goes when you save, and this cannot be undone.`)) return;
    update(rows.filter((x) => x.uid !== r.uid));
    setProblem(null);
    focusSoon('[data-le-add]');
  };

  const showProblem = (p: Problem) => {
    setProblem(p);
    focusSoon(p.index != null && rows[p.index] ? `#le-${rows[p.index]!.uid}-label` : '#le-problem');
  };

  async function save() {
    const items = toPayload(rows);
    const local = validateList(list, items, base, usage?.openWorkOrders ?? 0);
    if (local) { showProblem(local); return; }
    const api = staffApi.current;
    if (!api) return;
    setSaving(true);
    const r = await api.saveList(list, items, base.catalogRev);
    setSaving(false);
    if (r.ok) {
      reset(r.catalog, list);
      setUsage(r.usage);
      setProblem(null);
      toast(`${meta.title} saved. Every phone gets them on its next refresh.`, 'success');
      focusSoon('[data-le-add]'); // Save is disabled now; keep focus inside the sheet
      return;
    }
    if (r.stale && r.catalog) {
      reset(r.catalog, list);
      if (r.usage) setUsage(r.usage);
      setProblem({ error: r.error });
      focusSoon('#le-problem');
      return;
    }
    showProblem({ index: r.index, error: r.error });
  }

  const full = rows.length >= def.maxItems;
  return (
    <Sheet open title={meta.title} onClose={close}>
      <p className="t-sub c2" style={{ margin: '0 0 4px' }}>{meta.help}</p>
      {loadErr && (
        <div className="banner quiet" role="alert" style={{ marginTop: 10 }}>
          <Icon name="cloudoff" />
          <span className="grow t-sub">Could not load the latest lists: {loadErr} You can still edit; saving checks with the server.</span>
          <Button size="sm" variant="gray" onClick={fetchFresh}>Try again</Button>
        </div>
      )}
      {problem && problem.index == null && (
        <div id="le-problem" tabIndex={-1} className="banner bad" role="alert" style={{ marginTop: 10 }}>
          <Icon name="warn" weight="fill" />
          <span className="t-sub">{problem.error}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty" style={{ marginTop: 14 }}>
          <span className="empty-ico" aria-hidden="true"><Icon name={listIcon(list)} size={26} /></span>
          <p>No {meta.title.toLowerCase()} yet. Add the first one, then save.</p>
        </div>
      ) : (
        <ol className="group le-list" aria-label={meta.title}>
          {rows.map((r, i) => (
            <Entry
              key={r.uid}
              list={list}
              def={def}
              row={r}
              index={i}
              count={rows.length}
              base={base}
              usage={usage}
              error={problem?.index === i ? problem.error : ''}
              picking={picking === r.uid}
              onPick={(on) => setPicking(on ? r.uid : null)}
              onPatch={(p) => patch(r.uid, p)}
              onMove={(by) => shift(i, by)}
              onArchive={() => toggleArchive(r)}
              onDelete={() => remove(i)}
            />
          ))}
        </ol>
      )}

      <div className="le-foot">
        <span className="sr" role="status" aria-live="polite">{saving ? 'Saving' : ''}</span>
        <button type="button" data-le-add className="btn btn-gray btn-sm" disabled={full || saving} onClick={add} title={full ? `Up to ${def.maxItems}` : undefined}>
          <Icon name="plus" size={20} /> Add {meta.one}
        </button>
        <button type="button" className="btn btn-fill" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
      </div>
    </Sheet>
  );
}

interface EntryProps {
  list: string;
  def: ListDef;
  row: Row;
  index: number;
  count: number;
  base: Catalog;
  usage: Usage | null;
  error: string;
  picking: boolean;
  onPick: (on: boolean) => void;
  onPatch: (p: Partial<Row>) => void;
  onMove: (by: -1 | 1) => void;
  onArchive: () => void;
  onDelete: () => void;
}

/** The department picker: active departments, plus the one already chosen when it is archived. */
function DeptSelect({ id, value, base, onChange, label }: { id: string; value: string; base: Catalog; onChange: (v: string) => void; label: string }) {
  const options = activeDepartments(base);
  const current = base.departments.find((d) => d.key === value);
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {!current && <option value={value}>{value ? `${value} (removed)` : 'Pick a department'}</option>}
        {current && !current.active && <option value={value}>{current.label} (archived)</option>}
        {options.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>
    </div>
  );
}

function Minutes({ id, value, onChange, label = 'Target (minutes)' }: { id: string; value: number; onChange: (n: number) => void; label?: string }) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <input id={id} className="field" type="number" inputMode="numeric" min={1} max={LIMITS.slaMin} step={1} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
    </div>
  );
}

/** A module list's declared field: a short text box, a yes/no box or a whole number. */
function FieldInput({ id, f, value, onChange }: { id: string; f: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const fid = `${id}-f-${f.name}`;
  if (f.type === 'bool') {
    return (
      <label className="le-check">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>{cap(f.label)}</span>
      </label>
    );
  }
  const short = f.type === 'int' || (f.max ?? LIMITS.label) <= 10;
  return (
    <div style={short ? { flex: '0 1 7.5rem', minWidth: '6rem' } : { flex: '1 1 12rem', minWidth: 0 }}>
      <label className="field-label" htmlFor={fid}>{cap(f.label)}{f.required ? '' : ' (optional)'}</label>
      {f.type === 'int' ? (
        <input id={fid} className="field" type="number" inputMode="numeric" step={1} min={f.min} max={f.max} value={Number.isFinite(value as number) ? (value as number) : ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
      ) : (
        <input id={fid} className="field" autoComplete="off" maxLength={f.max ?? LIMITS.label} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function Entry({ list, def, row, index, count, base, usage, error, picking, onPick, onPatch, onMove, onArchive, onDelete }: EntryProps) {
  const id = `le-${row.uid}`;
  const name = row.label.trim() || `new ${def.noun[0]}`;
  const errId = `${id}-err`;
  const described = error ? { 'aria-invalid': true, 'aria-describedby': errId } : {};
  const builtin = isBuiltin(list);
  const used = !row.key ? '' : list === 'departments' ? usageText(usage?.departments[row.key]) : list === 'holdReasons' ? usageText(usage?.holdReasons[row.key]) : recordsText(base, list, row.key, usage);
  const tracksUse = list === 'departments' || list === 'holdReasons' || (!builtin && !!def.usedBy);
  const extra = builtin ? [] : def.fields;
  const simple = list === 'holdReasons' || list === 'jobTitles' || list === 'woFindings' || (!builtin && extra.length === 0);
  const fields = row as unknown as Record<string, unknown>;

  return (
    <li className={`le-item ${simple ? 'simple' : ''} ${row.active ? '' : 'off'}`}>
      <div className="le-head">
        <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
          <label className={simple ? 'sr' : 'field-label'} htmlFor={`${id}-label`}>{simple ? `${cap(def.noun[0])}: name` : 'Name'}</label>
          <input
            id={`${id}-label`}
            className="field"
            maxLength={LIMITS.label}
            autoComplete="off"
            value={row.label}
            placeholder={simple ? `New ${def.noun[0]}` : undefined}
            onChange={(e) => onPatch({ label: e.target.value })}
            onBlur={() => { if (list === 'departments' && !(row as Draft<Department>).short.trim()) onPatch({ short: suggestShort(row.label) }); }}
            {...described}
          />
        </div>
        {list === 'departments' && (
          <div style={{ flex: '0 1 7.5rem', minWidth: '6rem' }}>
            <label className="field-label" htmlFor={`${id}-short`}>Badge</label>
            <input id={`${id}-short`} className="field" maxLength={LIMITS.short} autoComplete="off" value={(row as Draft<Department>).short} onChange={(e) => onPatch({ short: e.target.value.toUpperCase() })} aria-describedby={`${id}-short-help`} />
            <span className="sr" id={`${id}-short-help`}>Short code on badges, up to {LIMITS.short} letters</span>
          </div>
        )}
        {extra.filter((f) => f.type !== 'bool').map((f) => <FieldInput key={f.name} id={id} f={f} value={fields[f.name]} onChange={(v) => onPatch({ [f.name]: v } as Partial<Row>)} />)}
      </div>
      {extra.filter((f) => f.type === 'bool').map((f) => <FieldInput key={f.name} id={id} f={f} value={fields[f.name]} onChange={(v) => onPatch({ [f.name]: v } as Partial<Row>)} />)}
      {list === 'departments' && (
        <label className="le-check">
          <input type="checkbox" checked={(row as Draft<Department>).repairs === true} onChange={(e) => onPatch({ repairs: e.target.checked } as Partial<Row>)} aria-describedby={`${id}-repairs-help`} />
          <span>Handles repairs <span className="t-foot c2" id={`${id}-repairs-help`} style={{ display: 'block' }}>Its requests can be escalated to a work order.</span></span>
        </label>
      )}

      {list === 'requestTypes' && (() => {
        const t = row as Draft<RequestType>;
        const icon = REQUEST_ICONS.find((x) => x.name === t.icon);
        return (
          <>
            <div className="le-grid">
              <DeptSelect id={`${id}-dept`} label="Department" value={t.dept} base={base} onChange={(v) => onPatch({ dept: v })} />
              <Minutes id={`${id}-sla`} value={t.slaMin} onChange={(n) => onPatch({ slaMin: n })} />
            </div>
            <div className="le-icon-line">
              <span className="le-icon-now" aria-hidden="true"><Icon name={t.icon} size={22} /></span>
              <span className="grow t-sub">Icon: {icon?.label ?? 'none'}</span>
              <Button size="sm" variant="gray" aria-pressed={picking} aria-label={`${picking ? 'Close' : 'Change'} the icon for ${name}`} onClick={() => onPick(!picking)}>{picking ? 'Done' : 'Change'}</Button>
            </div>
            {picking && (
              <fieldset className="icon-grid">
                <legend className="sr">Icon for {name}</legend>
                {REQUEST_ICONS.map((x) => (
                  <label key={x.name} className="icon-opt">
                    <input type="radio" name={`${id}-icon`} value={x.name} checked={t.icon === x.name} onChange={() => onPatch({ icon: x.name })} />
                    <Icon name={x.name} size={24} />
                    <span>{x.label}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </>
        );
      })()}

      {list === 'bundles' && (() => {
        const b = row as Draft<Bundle>;
        const setParts = (parts: BundlePart[]) => onPatch({ parts } as Partial<Row>);
        const setPart = (j: number, p: Partial<BundlePart>) => setParts(b.parts.map((x, k) => (k === j ? { ...x, ...p } : x)));
        return (
          <>
            <div style={{ marginTop: 10 }}>
              <label className="field-label" htmlFor={`${id}-hint`}>What it does</label>
              <input id={`${id}-hint`} className="field" maxLength={LIMITS.hint} autoComplete="off" value={b.hint} placeholder="e.g. Engineering fixes, then Housekeeping cleans" onChange={(e) => onPatch({ hint: e.target.value } as Partial<Row>)} />
            </div>
            <ol className="le-steps" aria-label={`Steps of ${name}`}>
              {b.parts.map((p, j) => (
                <li key={j} className="le-step">
                  <div className="le-step-head">
                    <span className="t-head">Step {j + 1}</span>
                    {b.parts.length > 1 && <Button size="sm" variant="plain" aria-label={`Remove step ${j + 1} of ${name}`} onClick={() => setParts(removePart(b.parts, j))}>Remove</Button>}
                  </div>
                  <div className="le-grid">
                    <div>
                      <label className="field-label" htmlFor={`${id}-p${j}-name`}>Step name</label>
                      <input id={`${id}-p${j}-name`} className="field" maxLength={LIMITS.label} autoComplete="off" value={p.name} onChange={(e) => setPart(j, { name: e.target.value })} />
                    </div>
                    <DeptSelect id={`${id}-p${j}-dept`} label="Department" value={p.dept} base={base} onChange={(v) => setPart(j, { dept: v })} />
                    <Minutes id={`${id}-p${j}-sla`} value={p.slaMin} onChange={(n) => setPart(j, { slaMin: n })} />
                  </div>
                  {j > 0 && (
                    <label className="le-check">
                      <input type="checkbox" checked={p.after != null} onChange={(e) => setPart(j, { after: e.target.checked ? j - 1 : undefined })} />
                      <span>Starts after step {p.after != null ? p.after + 1 : j} is done</span>
                    </label>
                  )}
                </li>
              ))}
            </ol>
            {b.parts.length < LIMITS.parts && (
              <Button size="sm" variant="tint" icon="plus" onClick={() => setParts([...b.parts, { name: '', dept: b.parts[b.parts.length - 1]?.dept ?? activeDepartments(base)[0]?.key ?? '', slaMin: 20 }])}>Add a step</Button>
            )}
          </>
        );
      })()}

      {row.key && tracksUse && (
        <p className="t-foot c2" style={{ margin: '8px 0 0' }}>{used ? `In use: ${used}${list === 'holdReasons' ? ' on hold now' : ''}` : 'Not used by any record yet'}</p>
      )}
      {list === 'requestTypes' && !row.active && <p className="t-foot c2" style={{ margin: '8px 0 0' }}>Hidden from new requests. Goes to {deptLabel((row as Draft<RequestType>).dept, base)}.</p>}
      {error && <p id={errId} className="field-help le-error" role="alert">{error}</p>}

      <div className="le-actions">
        <button type="button" className="iconbtn" data-move={`${id}:-1`} disabled={index === 0} aria-label={`Move ${name} up`} onClick={() => onMove(-1)}><Icon name="up" size={20} /></button>
        <button type="button" className="iconbtn" data-move={`${id}:1`} disabled={index === count - 1} aria-label={`Move ${name} down`} onClick={() => onMove(1)}><Icon name="down" size={20} /></button>
        {!row.active && <Pill tone="warn">Archived</Pill>}
        {!row.key && <Pill tone="accent">New</Pill>}
        <span className="grow" />
        <Button size="sm" variant={row.active ? 'gray' : 'tint'} aria-label={`${row.active ? 'Archive' : 'Restore'} ${name}`} onClick={onArchive}>{row.active ? 'Archive' : 'Restore'}</Button>
        <Button size="sm" variant="plain" className="le-delete" aria-label={`Delete ${name}`} onClick={onDelete}>Delete</Button>
      </div>
    </li>
  );
}
