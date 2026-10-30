import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { PROFILE_MAX, REQUEST_ICONS, defsOf, entriesOf, type Bundle, type Catalog, type Department, type HotelProfile, type ModuleEntry, type RequestType } from '../../domain/catalog';
import { listSummary } from '../../domain/listEdit';
import { staffApi } from '../../domain/staffApi';
import { toast, useApp, useUI } from '../../domain/store';
import { ListEditor, listIcon } from '../../screens/Lists';
import { Logins } from '../../screens/Logins';
import { DisplayPrefs, FeelPrefs, SignedIn } from '../../screens/Settings';
import { StaffAdmin } from '../../screens/StaffAdmin';
import { Button, Icon, Screen, useTier } from '../../ui/kit';
import { Sheet } from '../../ui/sheet';
import { useLevel } from '../workorders/model';
import { sectionsFor, type Section } from './sections';
import './config.css';

const SECTION_ICON: Record<string, string> = { profile: 'star', hdo: 'phone', staff: 'user', logins: 'key', display: 'sun', feel: 'device' };
const iconOf = (s: Section) => (s.kind === 'list' ? listIcon(s.id) : SECTION_ICON[s.kind] ?? 'gear');

/**
 * Configuration: the client prototype's read-only page, now editable where the role allows. Desktop: a list of the
 * sections on the left that scrolls the page to each one. Phone: the same list, each opening a sheet.
 */
export function Configuration() {
  const level = useLevel('config');
  const role = useUI((s) => s.account.role);
  const me = useApp((s) => s.me);
  const catalog = useApp((s) => s.catalog);
  const tier = useTier();
  const sections = useMemo(() => sectionsFor(defsOf(catalog), { level, role, asAccount: me === 'member' }), [catalog, level, role, me]);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const edit = (list: string) => { setOpen(null); setEditing(list); };
  const openSection = sections.find((s) => s.id === open);
  const note = level === 'own' ? 'Your preferences on this device.' : 'Settings';

  return (
    <Screen title="Configuration" subtitle={note}>
      <SignedIn />
      {tier === 'phone' ? (
        <>
          <ul className="group cfg-phone" aria-label="Sections">
            {sections.map((s) => (
              <li key={s.id}>
                <button type="button" className="row tap" onClick={() => setOpen(s.id)}>
                  <span className="lead" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}><Icon name={iconOf(s)} size={19} /></span>
                  <span className="grow"><span style={{ display: 'block', fontWeight: 600 }}>{s.title}</span><span className="t-foot c2" style={{ display: 'block' }}>{summaryOf(s, catalog)}</span></span>
                  <span className="c3"><Icon name="chev" size={16} /></span>
                </button>
              </li>
            ))}
          </ul>
          <Sheet open={!!openSection} title={openSection?.title ?? ''} onClose={() => setOpen(null)}>
            {openSection && <SectionBody section={openSection} onEdit={edit} />}
          </Sheet>
        </>
      ) : (
        <Desktop sections={sections} onEdit={edit} />
      )}
      {editing && <ListEditor key={editing} list={editing} title={sections.find((x) => x.id === editing)?.title} onClose={() => setEditing(null)} />}
    </Screen>
  );
}

function summaryOf(s: Section, cat: Catalog): string {
  if (s.kind === 'list') return listSummary(cat, s.id);
  return { profile: 'Name, contact and address', hdo: 'Who staffs the help desk', staff: 'People who sign in with a PIN', logins: 'People who sign in with an email', display: 'Text size, contrast, motion', feel: 'Vibration, sounds, shortcuts' }[s.kind] ?? '';
}

/** Desktop: the section list beside the page; the current section is marked as you scroll. */
function Desktop({ sections, onEdit }: { sections: Section[]; onEdit: (list: string) => void }) {
  const [current, setCurrent] = useState(sections[0]?.id ?? '');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = body.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id.slice(4), e.isIntersecting);
        const first = sections.find((s) => seen.get(s.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: '-10% 0px -55% 0px' },
    );
    root.querySelectorAll('section.cfg-sec').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  const go = (id: string) => {
    const el = document.getElementById(`cfg-${id}`);
    const reduce = document.documentElement.dataset.motion === 'reduce' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    setCurrent(id);
  };

  return (
    <div className="cfg">
      <nav className="cfg-nav" aria-label="Configuration sections">
        <ul>
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#cfg-${s.id}`} aria-current={current === s.id ? 'location' : undefined} onClick={(e) => { e.preventDefault(); go(s.id); }}>
                <Icon name={iconOf(s)} size={18} />
                <span>{s.title}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="cfg-body" ref={body}>
        {sections.map((s) => (
          <section key={s.id} id={`cfg-${s.id}`} className="cfg-sec" aria-labelledby={`cfg-${s.id}-h`}>
            <header className="cfg-sec-head">
              <h2 id={`cfg-${s.id}-h`} tabIndex={-1}>{s.title}</h2>
              {s.kind === 'list' && s.edit && <Button size="sm" variant="tint" icon="note" aria-label={`Edit ${s.title}`} onClick={() => onEdit(s.id)}>Edit</Button>}
            </header>
            <SectionBody section={s} onEdit={onEdit} inline />
          </section>
        ))}
      </div>
    </div>
  );
}

/** One section's content: the same on the desktop page and in a phone sheet. */
function SectionBody({ section: s, onEdit, inline }: { section: Section; onEdit: (list: string) => void; inline?: boolean }) {
  switch (s.kind) {
    case 'profile':
      return <Profile edit={s.edit} />;
    case 'list':
      return (
        <>
          {s.def?.help && <p className="cfg-help">{s.def.help}</p>}
          <ListView list={s.id} />
          {!inline && s.edit && <div style={{ marginTop: 16 }}><Button block variant="tint" icon="note" onClick={() => onEdit(s.id)}>Edit {s.title.toLowerCase()}</Button></div>}
          {!s.edit && <p className="t-foot c2 cfg-note">Only the hotel owner or a manager changes this list.</p>}
        </>
      );
    case 'hdo':
      return s.edit ? <StaffAdmin only="hdo" /> : <HdoView />;
    case 'staff':
      return <StaffAdmin />;
    case 'logins':
      return <Logins />;
    case 'display':
      return <DisplayPrefs />;
    case 'feel':
      return <FeelPrefs />;
  }
}

/* ---------- read views: chips, like the prototype ---------- */

function Chip({ label, off, icon }: { label: string; off?: boolean; icon?: string }) {
  return (
    <li className={`cfg-chip${off ? ' off' : ''}`}>
      {icon && <Icon name={icon} size={16} />}
      <span>{label}</span>
      {off && <span className="cfg-off">archived</span>}
    </li>
  );
}

function Chips({ items, label }: { items: { key: string; label: string; off?: boolean; icon?: string }[]; label: string }) {
  if (!items.length) return <p className="t-sub c2 cfg-none">None yet.</p>;
  return <ul className="cfg-chips" aria-label={label}>{items.map((x) => <Chip key={x.key} label={x.label} off={x.off} icon={x.icon} />)}</ul>;
}

function ListView({ list }: { list: string }) {
  const cat = useApp((s) => s.catalog);
  const staff = useApp((s) => s.staff);
  if (list === 'departments') {
    return (
      <div className="cfg-groups">
        {cat.departments.map((d: Department) => {
          const people = staff.filter((p) => p.dept === d.key && p.id !== 'member');
          return (
            <div key={d.key} className={`cfg-group${d.active ? '' : ' off'}`}>
              <h3>{d.label} <span className="cfg-tag">{d.short}</span>{d.repairs && <span className="cfg-tag">handles repairs</span>}{!d.active && <span className="cfg-tag">archived</span>}</h3>
              {people.length ? <Chips label={`${d.label} staff`} items={people.map((p) => ({ key: p.id, label: p.name }))} /> : <p className="t-sub c2 cfg-none">No staff yet.</p>}
            </div>
          );
        })}
      </div>
    );
  }
  if (list === 'requestTypes') {
    return (
      <div className="cfg-groups">
        {cat.departments.filter((d) => cat.requestTypes.some((t) => t.dept === d.key)).map((d) => (
          <div key={d.key} className="cfg-group">
            <h3>{d.label}</h3>
            <Chips label={`${d.label} service items`} items={cat.requestTypes.filter((t: RequestType) => t.dept === d.key).map((t) => ({ key: t.key, label: `${t.label} · ${t.slaMin} min`, off: !t.active, icon: REQUEST_ICONS.some((i) => i.name === t.icon) ? t.icon : undefined }))} />
          </div>
        ))}
      </div>
    );
  }
  if (list === 'bundles') {
    return <Chips label="Bundles" items={cat.bundles.map((b: Bundle) => ({ key: b.key, label: `${b.label} · ${b.parts.length} step${b.parts.length === 1 ? '' : 's'}`, off: !b.active }))} />;
  }
  const entries = entriesOf(cat, list) as ModuleEntry[];
  // A radio code reads as the prototype writes it: "10-9 Medical Emergency".
  const shown = (x: ModuleEntry) => (list === 'crisisCodes' && typeof x.code === 'string' && x.code ? `${x.code} ${x.label}` : x.label);
  return <Chips label={list} items={entries.map((x) => ({ key: x.key, label: shown(x), off: !x.active }))} />;
}

function HdoView() {
  const hdo = useApp((s) => s.staff).filter((p) => p.role === 'hdo');
  return (
    <>
      <Chips label="Help-desk officers" items={hdo.map((p) => ({ key: p.id, label: p.name }))} />
      <p className="t-foot c2 cfg-note">Help-desk officers sign in with a PIN. The hotel owner or a manager adds them under Staff (PINs).</p>
    </>
  );
}

/* ---------- hotel profile ---------- */

const EMPTY: Omit<HotelProfile, 'timeZone'> = { name: '', short: '', contact: '', address: '' };

function Profile({ edit }: { edit: boolean }) {
  const fallbackName = useUI((s) => s.account.hotel ?? '');
  const [p, setP] = useState<HotelProfile | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [loadErr, setLoadErr] = useState('');
  const [error, setError] = useState<{ field?: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    const api = staffApi.current;
    if (!api) return;
    void api.profile().then((r) => {
      if (!r.ok) { setLoadErr(r.error); return; }
      setLoadErr('');
      setP(r.profile);
      setDraft({ name: r.profile.name, short: r.profile.short, contact: r.profile.contact, address: r.profile.address });
    });
  };
  useEffect(load, []);

  const shown: HotelProfile = p ?? { ...EMPTY, name: fallbackName, timeZone: 'Asia/Manila' };
  const dirty = !!p && (['name', 'short', 'contact', 'address'] as const).some((k) => draft[k] !== p[k]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) { setError({ field: 'name', text: 'Enter the hotel name.' }); return; }
    const api = staffApi.current;
    if (!api) return;
    setBusy(true);
    const r = await api.saveProfile(draft);
    setBusy(false);
    if (!r.ok) {
      const field = (['name', 'short', 'contact', 'address'] as const).find((k) => r.error.toLowerCase().includes(LABEL[k].toLowerCase()));
      setError({ field, text: r.error });
      return;
    }
    setError(null);
    setP(r.profile);
    setDraft({ name: r.profile.name, short: r.profile.short, contact: r.profile.contact, address: r.profile.address });
    toast('Hotel profile saved.', 'success');
  }

  const err = loadErr ? <p className="field-help" role="alert" style={{ color: 'var(--bad)' }}>Could not load the profile: {loadErr} <button type="button" className="btn btn-plain btn-sm" onClick={load}>Try again</button></p> : null;

  if (!edit) {
    return (
      <>
        {err}
        <dl className="cfg-dl">
          {(['name', 'short', 'contact', 'address'] as const).map((k) => (
            <div key={k}><dt>{LABEL[k]}</dt><dd>{shown[k] || <span className="c2">Not set</span>}</dd></div>
          ))}
          <div><dt>Time zone</dt><dd>{shown.timeZone} (Philippine time)</dd></div>
        </dl>
        <p className="t-foot c2 cfg-note">Only the hotel owner changes the profile.</p>
      </>
    );
  }

  return (
    <form onSubmit={save} noValidate className="cfg-form">
      {err}
      {(['name', 'short', 'contact', 'address'] as const).map((k) => {
        const bad = error?.field === k;
        return (
          <div key={k} className={k === 'address' ? 'wide' : ''}>
            <label className="field-label" htmlFor={`pf-${k}`}>{LABEL[k]}{k === 'name' ? '' : ' (optional)'}</label>
            <input
              id={`pf-${k}`}
              className="field"
              autoComplete="off"
              maxLength={PROFILE_MAX[k]}
              value={draft[k]}
              disabled={!p}
              required={k === 'name'}
              aria-invalid={bad || undefined}
              aria-describedby={bad ? 'pf-err' : k === 'name' ? 'pf-name-help' : undefined}
              onChange={(e) => { setDraft({ ...draft, [k]: e.target.value }); if (error) setError(null); }}
            />
            {k === 'name' && <p className="field-help" id="pf-name-help">Shown on every screen and on the sign-in page.</p>}
          </div>
        );
      })}
      <div>
        <span className="field-label" id="pf-tz">Time zone</span>
        <p className="cfg-fixed" aria-labelledby="pf-tz">Asia/Manila (Philippine time) <span className="t-foot c2">Fixed: every date in the desk uses it.</span></p>
      </div>
      {error && !error.field && <p id="pf-err" className="field-help" role="alert" style={{ color: 'var(--bad)' }}>{error.text}</p>}
      {error?.field && <p id="pf-err" className="field-help wide" role="alert" style={{ color: 'var(--bad)' }}>{error.text}</p>}
      <div className="wide cfg-actions">
        <button type="submit" className="btn btn-fill" disabled={!dirty || busy}>{busy ? 'Saving…' : dirty ? 'Save profile' : 'Saved'}</button>
      </div>
    </form>
  );
}

const LABEL = { name: 'Hotel name', short: 'Short name', contact: 'Contact', address: 'Address' } as const;
