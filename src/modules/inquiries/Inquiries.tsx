import { useMemo, useState } from 'react';
import { haptic } from '../../lib/haptics';
import { setUI, useApp, useUI } from '../../domain/store';
import { Button, Empty, Screen, Segmented } from '../../ui/kit';
import { Field, aria, useStore } from './fields';
import { InquiryForm } from './InquiryForm';
import { InquiryDetail } from './InquiryDetail';
import { InquiryActions, StatusPill } from './InquiryActions';
import { NO_FILTER, TYPE_SHORT, filterInquiries, inquiriesOf, inquiryForm, preset, sortInquiries, type Inquiry, type InquiryFilter, type StatusFilter } from './data';
import { when } from './hotelTime';

export { InquiryDetail };

function Card({ i, now, selected, hdo }: { i: Inquiry; now: number; selected: boolean; hdo?: string }) {
  const who = i.no || 'Saving…';
  return (
    <li className={`inq ${i.status === 'done' ? 'is-done' : ''}`}>
      <button type="button" className="inq-main" aria-current={selected || undefined} onClick={() => { haptic('select'); setUI({ selItem: i.id }); }}>
        <span className="inq-top">
          <span className="inq-no">{who}</span>
          <span className="t-foot c2">{TYPE_SHORT[i.type]}</span>
          <StatusPill i={i} />
        </span>
        <span className="inq-name">{i.name}{i.room ? <span className="c2" style={{ fontWeight: 400 }}> · Room {i.room}</span> : null}</span>
        <span className="inq-desc t-sub">{i.desc}</span>
        <span className="inq-foot t-foot c2">
          <span>HDO {hdo ?? '—'}</span>
          <span>Logged {when(i.createdAt, now)}</span>
        </span>
      </button>
      <InquiryActions i={i} />
    </li>
  );
}

const PRESETS = [['today', 'Today'], ['week', 'Week'], ['all', 'All']] as const;

export function Inquiries() {
  const all = useApp(inquiriesOf);
  const now = useApp((s) => s.now);
  const staff = useApp((s) => s.staff);
  const sel = useUI((s) => s.selItem);
  const form = useStore(inquiryForm);
  const [f, setF] = useState<InquiryFilter>(NO_FILTER);
  const shown = useMemo(() => sortInquiries(filterInquiries(all, f)), [all, f]);
  const open = all.filter((i) => i.status !== 'done').length;
  const picked = (p: (typeof PRESETS)[number][0]) => {
    const r = preset(p, now);
    return r.from === f.from && r.to === f.to;
  };
  const filtered = f.status !== 'all' || f.from !== '' || f.to !== '';
  const close = () => inquiryForm.set(() => ({ open: false }));

  return (
    <Screen title="Inquiries" subtitle="Guest & external">
      <div className="mod-bar">
        <Button icon="plus" feel="medium" onClick={() => inquiryForm.set(() => ({ open: true }))}>New Inquiry</Button>
        <span className="t-sub c2" aria-live="polite">{open} open</span>
      </div>

      <div className="mod-filters">
        <Segmented<StatusFilter> label="Filter" value={f.status} onChange={(status) => setF((x) => ({ ...x, status }))} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'done', label: 'Done' }]} />
        <div className="mod-range" role="group" aria-label="Date range, hotel time">
          <Field id="inq-from" label="From">
            <input type="date" className="field" {...aria('inq-from')} value={f.from} max={f.to || undefined} onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))} />
          </Field>
          <Field id="inq-to" label="To">
            <input type="date" className="field" {...aria('inq-to')} value={f.to} min={f.from || undefined} onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))} />
          </Field>
          {PRESETS.map(([p, label]) => (
            <button key={p} type="button" className="chip" aria-pressed={picked(p)} onClick={() => { haptic('select'); setF((x) => ({ ...x, ...preset(p, now) })); }}>{label}</button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        filtered && all.length > 0
          ? <Empty icon="chat" text="No inquiries match this filter." action="Show all" onAction={() => setF(NO_FILTER)} />
          : <Empty icon="chat" text="No inquiries yet. Log a question from an in-house guest, a caller or a checked-out guest, then close it when it is answered." action="New Inquiry" onAction={() => inquiryForm.set(() => ({ open: true }))} />
      ) : (
        <ul className="cards" role="list" style={{ marginTop: 14 }} aria-label="Inquiries">
          {shown.map((i) => <Card key={i.id} i={i} now={now} selected={sel === i.id} hdo={staff.find((p) => p.id === i.hdo)?.name} />)}
        </ul>
      )}
      {shown.length > 0 && filtered && <p className="mod-count t-foot c2">Showing {shown.length} of {all.length}. The list keeps open inquiries and the last 14 days.</p>}
      <InquiryForm open={form.open} onClose={close} />
    </Screen>
  );
}

