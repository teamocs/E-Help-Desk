import { useMemo } from 'react';
import { deptLabel } from '../../domain/catalog';
import { ago, isOpen, sla } from '../../domain/rules';
import { useApp } from '../../domain/store';
import { Pill, Row } from '../../ui/kit';

/** One shift, as in Handover. */
const SHIFT_MS = 8 * 3_600_000;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);

/**
 * Today at a glance: live counts from the desk's own data (it works offline, without the server's reports), the
 * department relay and completion scores and the items held longest. Departments only: never a person's figures.
 */
export function Glance() {
  const items = useApp((s) => s.items);
  const requests = useApp((s) => s.requests);
  const wos = useApp((s) => s.wos);
  const cleaning = useApp((s) => s.cleaning);
  const now = useApp((s) => s.now);
  const catalog = useApp((s) => s.catalog);

  const all = Object.values(items);
  const open = all.filter(isOpen);
  const overdue = open.filter((i) => sla(i, items, now).overdue).length;
  const holds = open.filter((i) => i.status === 'on_hold').sort((a, b) => (a.holdSince ?? 0) - (b.holdSince ?? 0));
  const logged = requests.filter((r) => now - r.createdAt < SHIFT_MS).length;
  const woOpen = wos.filter((w) => w.status !== 'done').length;
  const ready = cleaning.filter((c) => c.status === 'ready').length;

  const rows = useMemo(() => {
    const list = Object.values(items);
    // The hotel's departments in their order (archived ones too, while they have items), then any unknown key on old records.
    const keys = [...new Set([...catalog.departments.map((d) => d.key), ...list.map((i) => i.dept)])];
    return keys
      .map((d) => {
        const its = list.filter((i) => i.dept === d);
        const acked = its.filter((i) => i.ackAt);
        const done = its.filter((i) => i.status === 'done' && i.ackAt && i.doneAt);
        const relayOk = acked.filter((i) => (i.ackAt as number) - i.createdAt <= 2 * 60000).length;
        const doneOk = done.filter((i) => (i.doneAt as number) - (i.ackAt as number) - i.heldMs <= i.slaMin * 60000).length;
        return { d, n: its.length, relay: pct(relayOk, acked.length), comp: pct(doneOk, done.length) };
      })
      .filter((r) => r.n > 0);
  }, [items, catalog]);

  const tiles: [string, number, string][] = [
    ['Tickets logged this shift', logged, ''],
    ['Items open', open.length, ''],
    ['Overdue', overdue, overdue ? 'var(--bad)' : ''],
    ['On hold', holds.length, holds.length ? 'var(--warn)' : ''],
    ['Work orders open', woOpen, ''],
    ['Rooms ready to clean', ready, ''],
  ];

  return (
    <section aria-labelledby="rp-glance">
      <h2 id="rp-glance" className="rp-h2">Today at a glance</h2>
      <div className="group tiles rp-glance">
        {tiles.map(([label, n, color]) => (
          <div key={label} className="tile">
            <div className="stat" style={{ color: color || undefined }}>{n}</div>
            <div className="t-sub c2">{label}</div>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="group rp-depts">
          <p className="t-foot c2 rp-note">By department, the items on the desk now. Relay: acknowledged within 2 minutes. Completion: finished within the target for that item type; time on hold does not count. A dash means nothing to measure yet.</p>
          <div className="bars">
            {rows.map((r) => (
              <div key={r.d}>
                <div className="t-head" style={{ marginBottom: 6 }}>{deptLabel(r.d, catalog)} <span className="t-foot c2" style={{ fontWeight: 400 }}>· {r.n} item{r.n === 1 ? '' : 's'}</span></div>
                {([['Relay', r.relay], ['Completion', r.comp]] as const).map(([l, v]) => (
                  <div key={l} className="barline" style={{ marginBottom: 4 }}>
                    <span className="t-sub c2">{l}</span>
                    <span className="track" role="img" aria-label={`${deptLabel(r.d, catalog)} ${l.toLowerCase()}: ${v == null ? 'nothing to measure yet' : `${v} percent`}`}><i style={{ width: `${v ?? 0}%`, background: v == null ? undefined : v >= 80 ? 'var(--ok)' : v >= 60 ? 'var(--warn)' : 'var(--bad)' }} /></span>
                    <span className="t-sub" style={{ textAlign: 'right' }} aria-hidden="true">{v == null ? '–' : `${v}%`}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {holds.length > 0 && (
        <>
          <h3 className="group-title">Held longest</h3>
          <div className="group">
            {holds.slice(0, 5).map((i) => (
              <Row key={i.id} icon="hourglass" tint="var(--warn)" title={<span>Room {requests.find((r) => r.id === i.requestId)?.room}: {i.name}</span>} sub={`${deptLabel(i.dept, catalog)} head owns this`} trailing={<Pill tone="warn">{ago(now - (i.holdSince ?? now))}</Pill>} />
            ))}
          </div>
          <p className="t-foot c2" style={{ padding: '8px 4px 0', margin: 0 }}>Each department head reviews these. An item on hold never silently expires.</p>
        </>
      )}
    </section>
  );
}
