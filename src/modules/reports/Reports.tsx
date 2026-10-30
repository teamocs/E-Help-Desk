import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast, useApp } from '../../domain/store';
import { Button, Empty, Icon, Screen, useTier } from '../../ui/kit';
import { BarTable, Columns } from './charts';
import { Glance } from './Glance';
import {
  PRESETS, REPORTS, change, connection, dayLabel, downloadCsv, fetchReport, filterLabel, fmt, hourLabel, nextSort, nounFor, presetOf, presetRange,
  rangeLabel, rangeProblem, reportMeta, sortRows, spoken, type Bucket, type Cell, type Figure, type FilterKey, type Overview, type Preset,
  type Query, type Range, type Report, type ReportId, type Sort, type Table,
} from './model';
import './reports.css';

/** Reports: Today at a glance (live, from the desk), then the prototype's six report tiles; each opens its page. */
export function ReportsScreen() {
  const now = useApp((s) => s.now);
  const [open, setOpen] = useState<ReportId | null>(null);
  // One range for every report page, so moving between reports keeps the dates.
  const [range, setRange] = useState<Range>(() => presetRange('7', now));
  const [last, setLast] = useState<ReportId | null>(null);

  if (open) {
    return <ReportPage key={open} id={open} range={range} setRange={setRange} onBack={() => { setLast(open); setOpen(null); }} />;
  }
  return <Landing onOpen={setOpen} returnTo={last} />;
}

function Landing({ onOpen, returnTo }: { onOpen: (id: ReportId) => void; returnTo: ReportId | null }) {
  const now = useApp((s) => s.now);
  const [heads, setHeads] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const week = useMemo(() => presetRange('7', now), [now]);
  const tiles = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    let live = true;
    void fetchReport<Overview>(connection(), 'overview', { ...week, filters: {} }).then((r) => {
      if (!live) return;
      if (r.ok) setHeads(r.data);
      else setFailed(true);
    });
    return () => { live = false; };
    // Once per visit: the tiles' numbers do not need the live clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Back from a report: focus returns to its tile.
    if (returnTo) tiles.current[returnTo]?.focus();
  }, [returnTo]);

  return (
    <Screen title="Reports" subtitle="View and export. About the operation, never a ranking of people.">
      <Glance />
      <section aria-labelledby="rp-all">
        <div className="rp-head">
          <h2 id="rp-all" className="rp-h2">Reports</h2>
          <p className="t-foot c2" style={{ margin: 0 }}>Numbers on the tiles: the last 7 days, {rangeLabel(week)}.</p>
        </div>
        <ul className="rp-tiles" role="list">
          {REPORTS.map((r) => {
            const h = heads?.headlines[r.id];
            return (
              <li key={r.id}>
                <button type="button" className="rp-tile" ref={(el) => { tiles.current[r.id] = el; }} onClick={() => onOpen(r.id)} aria-describedby={`rp-t-${r.id}`}>
                  <span className="rp-tile-top">
                    <span className="rp-tile-ico" aria-hidden="true"><Icon name={r.icon} size={20} /></span>
                    <span className="rp-tile-title t-head">{r.title}</span>
                    <Icon name="chev" size={16} />
                  </span>
                  <span id={`rp-t-${r.id}`} className="rp-tile-line t-sub c2">{r.line}</span>
                  <span className="rp-tile-num">
                    {h ? (
                      <><b>{fmt(h.value, h.unit)}</b> <span className="t-foot c2">{nounFor(h.label, h.value)}</span></>
                    ) : (
                      <span className="t-foot c2">{failed ? 'Open to see the figures' : 'Counting…'}</span>
                    )}
                  </span>
                  <span className="rp-tile-cat t-cap">{r.category}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="t-foot c2 rp-note">Exports are CSV files: they open in Excel or Google Sheets. Reports show departments, types, codes and days. They never show how one person performed.</p>
      </section>
    </Screen>
  );
}

/* ---------- one report ---------- */

type Load = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ok'; data: Report };

function ReportPage({ id, range, setRange, onBack }: { id: ReportId; range: Range; setRange: (r: Range) => void; onBack: () => void }) {
  const meta = reportMeta(id)!;
  const now = useApp((s) => s.now);
  const tier = useTier();
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({});
  const [draft, setDraft] = useState<Range>(range);
  const [result, setResult] = useState<{ key: string; load: Load } | null>(null);
  const [options, setOptions] = useState<Report['options']>({});
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const head = useRef<HTMLDivElement>(null);
  const fromId = useId(), toId = useId(), probId = useId();
  const problem = rangeProblem(draft);
  const preset: Preset = presetOf(range, now);
  const q: Query = useMemo(() => ({ ...range, filters }), [range, filters]);
  const key = `${id}|${JSON.stringify(q)}|${tick}`;
  // A result for other dates or filters is stale: show loading until the new one arrives.
  const load: Load = result?.key === key ? result.load : { state: 'loading' };
  const apply = (r: Range) => { setDraft(r); setRange(r); };

  useEffect(() => { head.current?.closest('main')?.focus(); }, []);
  useEffect(() => {
    let live = true;
    void fetchReport(connection(), id, q).then((r) => {
      if (!live) return;
      if (r.ok) {
        setResult({ key, load: { state: 'ok', data: r.data } });
        setOptions(r.data.options ?? {});
      } else setResult({ key, load: { state: 'error', error: r.error } });
    });
    return () => { live = false; };
  }, [id, q, key]);

  const setDate = (k: 'from' | 'to') => (e: { target: { value: string } }) => {
    const next = { ...draft, [k]: e.target.value };
    setDraft(next);
    if (!rangeProblem(next)) setRange(next);
  };
  const exportCsv = async () => {
    setBusy(true);
    const r = await downloadCsv(connection(), id, q);
    setBusy(false);
    if (r.ok) toast(`Saved ${r.data}`, 'success');
    else toast(r.error, 'error');
  };
  const data = load.state === 'ok' ? load.data : null;

  return (
    <Screen title={meta.title} subtitle={`${rangeLabel(range)} · hotel days, Manila time`}>
      <div ref={head} className="rp-topbar">
        <Button size="sm" variant="plain" icon="undo" onClick={onBack}>All reports</Button>
        <span className="rp-export">
          <Button size="sm" variant="tint" icon="down" onClick={() => void exportCsv()} disabled={busy || !data || data.empty} aria-describedby="rp-excel">{busy ? 'Preparing…' : 'Download CSV'}</Button>
          <span id="rp-excel" className="t-foot c2">Opens in Excel</span>
        </span>
      </div>

      <section className="rp-controls" aria-label="Dates and filters">
        <div className="rp-presets" role="group" aria-label="Dates">
          {PRESETS.map((p) => (
            <button key={p.value} type="button" className="chip" aria-pressed={preset === p.value} onClick={() => apply(presetRange(p.value as Exclude<Preset, 'custom'>, now))}>{p.label}</button>
          ))}
        </div>
        <div className="rp-dates">
          <span>
            <label className="field-label" htmlFor={fromId}>From</label>
            <input id={fromId} className="field" type="date" value={draft.from} max={draft.to} onChange={setDate('from')} aria-invalid={!!problem} aria-describedby={problem ? probId : undefined} />
          </span>
          <span>
            <label className="field-label" htmlFor={toId}>To</label>
            <input id={toId} className="field" type="date" value={draft.to} min={draft.from} onChange={setDate('to')} aria-invalid={!!problem} aria-describedby={problem ? probId : undefined} />
          </span>
          {meta.filters.map((k) => (
            <FilterSelect key={k} label={filterLabel(k, id)} value={filters[k] ?? ''} options={options[k] ?? []} onChange={(v) => setFilters((f) => ({ ...f, [k]: v }))} />
          ))}
        </div>
        {problem && <p id={probId} className="field-help rp-error" role="alert">{problem}</p>}
      </section>

      <div aria-live="polite" aria-busy={load.state === 'loading'}>
        {load.state === 'loading' && <p className="rp-loading t-sub c2" role="status"><span className="rp-spin" aria-hidden="true" />Making the report…</p>}
        {load.state === 'error' && (
          <div className="banner bad rp-banner" role="alert">
            <Icon name="warn" size={20} />
            <span className="grow">{load.error}</span>
            <Button size="sm" variant="gray" onClick={() => setTick((t) => t + 1)}>Try again</Button>
          </div>
        )}
        {data && data.empty && <Empty icon="chart" text="Nothing to report for these dates. Choose a longer range, or clear the filters." />}
        {data && !data.empty && (
          <>
            <Summary data={data} />
            <Charts data={data} phone={tier === 'phone'} />
            <DataTable table={data.table} caption={`${meta.title}, ${rangeLabel(range)}`} phone={tier === 'phone'} capped={!!data.capped} />
          </>
        )}
      </div>
    </Screen>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <span>
      <label className="field-label" htmlFor={id}>{label}</label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {value && !options.some((o) => o.value === value) && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

/* ---------- the figures ---------- */

function Summary({ data }: { data: Report }) {
  const prev = data.report === 'kpi' ? (data.table.rows as { prev: number | null }[]) : null;
  return (
    <section aria-labelledby="rp-sum">
      <h2 id="rp-sum" className="sr">Summary</h2>
      {data.previous && <p className="t-foot c2 rp-note">Compared with the {data.range.days} days before: {rangeLabel(data.previous)}.</p>}
      <dl className="rp-figs">
        {data.summary.map((f: Figure, i) => {
          const c = prev ? change(f.value, prev[i]?.prev ?? null, f.unit) : null;
          return (
            <div key={f.key} className="rp-fig">
              <dt className="t-foot c2">{f.label}</dt>
              <dd>
                <span className="rp-fig-n" aria-label={spoken(f.value, f.unit)}>{fmt(f.value, f.unit)}</span>
                {prev && (
                  <span className="rp-delta t-foot c2">
                    {c ? <>{c.dir !== 'same' && <Icon name={c.dir} size={12} weight="bold" />}{c.text}</> : 'no earlier figure'}
                    <span className="sr"> against the previous period ({spoken(prev[i]?.prev ?? null, f.unit)})</span>
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

const buckets = (xs: unknown) => ((xs as Bucket[] | undefined) ?? []).map((b) => ({ label: b.label, values: [b.count] }));

function Charts({ data, phone }: { data: Report; phone: boolean }) {
  const count = (noun: string) => [{ name: noun, unit: 'count' as const }];
  const days = (data.trend ?? []).map((d) => ({ label: dayLabel(d.date), value: d.count }));
  const every = Math.max(1, Math.ceil(days.length / (phone ? 6 : 12)));
  switch (data.report) {
    case 'response':
      return (
        <div className="rp-charts">
          <BarTable title="By department" note="(share of items on time)" series={[{ name: 'Relayed within 2 min', unit: 'pct' }, { name: 'Completed within target', unit: 'pct', tone: 'gold' }]} top={100}
            rows={(data.byDept ?? []).map((d) => ({ label: String(d.label), values: [d.relayPct as number | null, d.withinPct as number | null] }))} />
          <BarTable title="Time to relay" note="(items)" series={count('Items')} rows={buckets(data.relayDist)} />
          <BarTable title="Time to complete, against the item's target" note="(items, hold time removed)" series={count('Items')} rows={buckets(data.workDist)} />
        </div>
      );
    case 'kpi':
      return <div className="rp-charts one"><Columns title="Items logged per day" noun="items" points={days} every={every} /></div>;
    case 'turnaround':
      return (
        <div className="rp-charts">
          <BarTable title="Checkout to clean room" note="(rooms)" series={count('Rooms')} rows={buckets(data.turnDist)} />
          <BarTable title="Cleaning time" note="(rooms)" series={count('Rooms')} rows={buckets(data.cleanDist)} />
        </div>
      );
    case 'workorders':
      return (
        <div className="rp-charts">
          <BarTable title="By status" note="(work orders)" series={count('Work orders')} rows={buckets(data.byStatus)} />
          <BarTable title="By priority" note="(work orders)" series={count('Work orders')} rows={buckets(data.byPriority)} />
          <BarTable title="By department" note="(work orders)" series={count('Work orders')} rows={(data.byDept ?? []).map((d) => ({ label: String(d.label), values: [d.count as number] }))} />
          <BarTable title="Cost by department" note="(estimated and actual, PHP)" series={[{ name: 'Estimated', unit: 'php' }, { name: 'Actual (completed)', unit: 'php', tone: 'gold' }]}
            rows={(data.byDept ?? []).map((d) => ({ label: String(d.label), values: [d.est as number | null, d.actual as number | null] }))} />
        </div>
      );
    case 'inquiries':
      return (
        <div className="rp-charts">
          <Columns title="Inquiries per day" noun="inquiries" points={days} every={every} />
          <Columns title="Inquiries by hour of the day" noun="inquiries" when="Hour" points={(data.byHour ?? []).map((h) => ({ label: hourLabel(h.hour), value: h.count }))} every={phone ? 6 : 3} />
          <BarTable title="Who is asking" note="(inquiries)" series={count('Inquiries')} rows={buckets(data.byContact)} />
        </div>
      );
    case 'crisis':
      return (
        <div className="rp-charts">
          <BarTable title="By code" note="(cases)" series={count('Cases')} rows={buckets(data.byCode)} />
          <BarTable title="By place" note="(cases)" series={count('Cases')} rows={buckets(data.byLocation)} />
          <BarTable title="Guest complaints by category" note="(cases)" series={count('Cases')} rows={buckets(data.byCategory).filter((r) => r.label !== 'Not given')} />
        </div>
      );
    default:
      return null;
  }
}

/* ---------- the table ---------- */

const NUMERIC = new Set(['count', 'pct', 'min', 'h', 'php']);

export function DataTable({ table, caption, phone, capped }: { table: Table; caption: string; phone: boolean; capped?: boolean }) {
  const [sort, setSort] = useState<Sort>(null);
  const rows = useMemo(() => sortRows(table.rows, sort), [table.rows, sort]);
  const unitOf = (k: string, r: Record<string, Cell>) => (k === 'value' || k === 'prev' || k === 'change' ? ((r.unit as never) ?? 'count') : table.columns.find((c) => c.key === k)!.unit);
  const wide = table.columns.length > 3;
  return (
    <section aria-labelledby="rp-tbl" className="rp-tsec">
      <h2 id="rp-tbl" className="rp-h2">Table</h2>
      {phone && wide && <p className="rp-hint t-foot c2"><Icon name="chev" size={14} />Swipe the table sideways to see every column.</p>}
      {capped && <p className="t-foot c2 rp-note">The table lists the latest 500; the figures above count every one. Download the CSV for these dates in parts.</p>}
      <div className="rp-scroll rp-tablewrap" tabIndex={0} role="region" aria-label={`${caption}, table`}>
        <table className="rp-table">
          <caption className="sr">{caption}. Select a column heading to sort.</caption>
          <thead>
            <tr>
              {table.columns.map((c) => {
                const on = sort?.key === c.key;
                const num = NUMERIC.has(c.unit) || ['value', 'prev', 'change'].includes(c.key);
                return (
                  <th key={c.key} scope="col" aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={num ? 'num' : ''}>
                    <button type="button" onClick={() => setSort(nextSort(sort, c.key, num))}>
                      {c.label}{c.unit === 'php' ? ' (₱)' : ''}
                      <span className={`rp-sort ${on ? sort!.dir : ''}`} aria-hidden="true"><Icon name={on && sort!.dir === 'asc' ? 'up' : 'down'} size={12} weight="bold" /></span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {table.columns.map((c, j) => {
                  const u = unitOf(c.key, r);
                  const v = c.key === 'unit' ? UNIT_NAME[String(r.unit)] ?? '' : c.key === 'change' ? (r.change == null ? '–' : `${(r.change as number) > 0 ? '+' : (r.change as number) < 0 ? '−' : ''}${fmt(Math.abs(r.change as number), u === 'pct' ? 'count' : u)}${u === 'pct' ? ' pts' : ''}`) : fmt(r[c.key], u);
                  const num = NUMERIC.has(c.unit) || ['value', 'prev', 'change'].includes(c.key);
                  return j === 0 ? <th key={c.key} scope="row">{v}</th> : <td key={c.key} className={num ? 'num' : ''}>{v}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
const UNIT_NAME: Record<string, string> = { count: 'number', pct: 'percent', min: 'minutes', h: 'hours', php: 'pesos' };
