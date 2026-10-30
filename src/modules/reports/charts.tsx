import { useId } from 'react';
import { bars, describe, fmt, spoken, type Unit } from './model';

/**
 * Horizontal bars that ARE a table: each row reads "label, value" to a screen reader and the bar is decoration.
 * Plain CSS, no chart library. Two series show as a pair of bars per row.
 */
export function BarTable({ title, note, rows, series, top }: {
  title: string;
  note?: string;
  rows: { label: string; values: (number | null)[] }[];
  series: { name: string; unit: Unit; tone?: 'accent' | 'gold' }[];
  top?: number;
}) {
  const id = useId();
  const all = rows.flatMap((r) => r.values.map((v) => ({ label: r.label, value: v })));
  const scale = bars(all, top).top;
  return (
    <figure className="rp-chart" aria-labelledby={id}>
      <figcaption id={id} className="rp-chart-title">{title}{note && <span className="t-foot c2"> {note}</span>}</figcaption>
      {series.length > 1 && (
        <p className="rp-legend t-foot c2" aria-hidden="true">
          {series.map((s) => <span key={s.name}><i className={`rp-key ${s.tone ?? 'accent'}`} />{s.name}</span>)}
        </p>
      )}
      {rows.length === 0 ? <p className="t-sub c2 rp-none">Nothing to show for these dates.</p> : (
        // ARIA table roles on plain boxes: the layout can stack the label over its bars at any width without the
        // browser dropping the table semantics (it does for a <td> styled as grid).
        <div className="rp-bars" role="table" aria-label={title}>
          <div role="rowgroup" className="sr">
            <div role="row"><span role="columnheader">{title}</span>{series.map((s) => <span key={s.name} role="columnheader">{s.name}</span>)}</div>
          </div>
          <div role="rowgroup">
            {rows.map((r) => (
              <div key={r.label} role="row" className="rp-brow">
                <span role="rowheader" className="rp-blabel">{r.label}</span>
                {r.values.map((v, i) => (
                  <span key={series[i].name} role="cell" className="rp-bcell" aria-label={`${series.length > 1 ? `${series[i].name}: ` : ''}${spoken(v, series[i].unit)}`}>
                    <span className="rp-bar" aria-hidden="true"><i className={series[i].tone ?? 'accent'} style={{ width: `${v == null ? 0 : Math.min(100, (100 * v) / scale)}%` }} /></span>
                    <span className="rp-val" aria-hidden="true">{fmt(v, series[i].unit)}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </figure>
  );
}

/**
 * Columns over time (days or hours), drawn with CSS so the labels stay readable at any width: one sentence for screen
 * readers, and the numbers as a table under a "Show the numbers" disclosure.
 */
export function Columns({ title, points, noun, unit = 'count', every = 1, when = 'Day' }: { title: string; points: { label: string; value: number | null }[]; noun: string; unit?: Unit; every?: number; when?: string }) {
  const id = useId();
  const { top, bars: bs } = bars(points);
  const cols = { gridTemplateColumns: `repeat(${Math.max(1, bs.length)}, minmax(0, 1fr))` };
  return (
    <figure className="rp-chart" aria-labelledby={id}>
      <figcaption id={id} className="rp-chart-title">{title}</figcaption>
      <div className="rp-colchart" role="img" aria-label={`${title}. ${describe(points, noun)}`}>
        <div className="rp-yaxis" aria-hidden="true"><span>{fmt(top, unit)}</span><span>{fmt(top / 2, unit)}</span><span>0</span></div>
        <div className="rp-plot" style={cols} aria-hidden="true">
          {bs.map((b) => <span key={b.label} className="rp-c" title={`${b.label}: ${fmt(b.value, unit)}`}><i style={{ height: `${b.share * 100}%` }} /></span>)}
        </div>
        <div className="rp-xaxis" style={cols} aria-hidden="true">
          {bs.map((b, i) => <span key={b.label}>{i % every === 0 ? b.label : ''}</span>)}
        </div>
      </div>
      <details className="rp-numbers">
        <summary>Show the numbers</summary>
        <div className="rp-scroll" tabIndex={0} aria-label={`${title}, numbers`}>
          <table className="rp-table rp-mini">
            <thead><tr><th scope="col">{when}</th><th scope="col">{noun[0].toUpperCase() + noun.slice(1)}</th></tr></thead>
            <tbody>{points.map((p) => <tr key={p.label}><th scope="row">{p.label}</th><td>{fmt(p.value, unit)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
