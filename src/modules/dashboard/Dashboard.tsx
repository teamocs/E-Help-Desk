import { useState } from 'react';
import { ago, isOpen, sla } from '../../domain/rules';
import { go, openComposer, setUI, useApp } from '../../domain/store';
import { HandoverPanel } from '../../screens/Handover';
import { STATUS_TEXT } from '../../screens/Detail';
import { Sheet } from '../../ui/sheet';
import { Button, DeptChip, Empty, Group, Icon, Pill, Row, Screen } from '../../ui/kit';

/** The quick actions whose modules arrive in the next update: they explain that instead of failing. */
const SOON = { inquiry: 'New Inquiry', reminder: 'New Reminder', cleaning: 'Log Cleaning' } as const;
type Soon = keyof typeof SOON;
const SOON_LINE: Record<Soon, string> = {
  inquiry: 'Inquiries arrive in the next update. Until then, note the guest’s question in a request’s remarks.',
  reminder: 'Reminders arrive in the next update. Until then, keep follow-ups on the shift handover sheet.',
  cleaning: 'Logging and scheduling cleans arrives in the next update. Rooms already in the cleaning list can be started and finished in Cleaning.',
};

/** The command centre: quick actions, the live counts, the latest tickets and the shift handover. */
export function Dashboard() {
  const items = useApp((s) => s.items);
  const requests = useApp((s) => s.requests);
  const wos = useApp((s) => s.wos);
  const cleaning = useApp((s) => s.cleaning);
  const now = useApp((s) => s.now);
  const [soon, setSoon] = useState<Soon | null>(null);

  const all = Object.values(items);
  const open = all.filter(isOpen);
  const overdue = open.filter((i) => sla(i, items, now).overdue).length;
  const held = open.filter((i) => i.status === 'on_hold').length;
  const counts: { label: string; n: number; tone?: string; to: string }[] = [
    { label: 'Open', n: open.length, to: 'requests' },
    { label: 'Overdue', n: overdue, tone: overdue ? 'var(--bad)' : undefined, to: 'requests' },
    { label: 'On hold', n: held, tone: held ? 'var(--warn)' : undefined, to: 'requests' },
    { label: 'Work orders open', n: wos.filter((w) => w.status !== 'done').length, to: 'workorders' },
    { label: 'Rooms ready', n: cleaning.filter((c) => c.status === 'ready').length, to: 'cleaning' },
  ];
  // Newest tickets first, their items in order: one row per item, as the prototype's Recent Tickets.
  const recent = requests
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((r) => r.itemIds.map((id, n) => ({ r, it: items[id], code: `${r.ticket}-${n + 1}` })))
    .filter((x) => x.it)
    .slice(0, 10);

  return (
    <Screen title="Dashboard" subtitle="Command center">
      <div className="quick" role="group" aria-label="Quick actions">
        <Button icon="plus" feel="medium" onClick={() => openComposer()}>New Request</Button>
        {(Object.keys(SOON) as Soon[]).map((k) => (
          <Button key={k} variant="tint" icon="plus" onClick={() => setSoon(k)}>{SOON[k]}</Button>
        ))}
      </div>

      <h2 className="sr">Now</h2>
      <div className="group tiles dash-counts">
        {counts.map((c) => (
          <button key={c.label} type="button" className="tile tile-tap" onClick={() => go(c.to)} aria-label={`${c.label}: ${c.n}. Open ${c.to === 'workorders' ? 'Work Orders' : c.to === 'cleaning' ? 'Cleaning' : 'Requests'}`}>
            <span className="stat" style={{ color: c.tone }}>{c.n}</span>
            <span className="t-sub c2">{c.label}</span>
          </button>
        ))}
      </div>

      <div className="dash-cols">
        <section aria-labelledby="recent-title" className="dash-panel">
          <div className="dash-head">
            <h2 id="recent-title" className="dash-h">Recent Tickets</h2>
            <Button size="sm" variant="plain" onClick={() => go('requests')}>View all</Button>
          </div>
          {recent.length === 0 ? (
            <Empty icon="clip" text="No tickets yet. A new request shows here the moment it is logged." action="New Request" onAction={() => openComposer()} />
          ) : (
            <Group>
              {recent.map(({ r, it, code }) => (
                <Row
                  key={it.id}
                  title={<span><span className="c2 t-sub tnum">{code}</span> · {it.name}{it.qty > 1 ? ` ×${it.qty}` : ''}</span>}
                  sub={`Room ${r.room} · ${ago(now - r.createdAt)} ago`}
                  trailing={<span className="dash-trail"><DeptChip dept={it.dept} /><Pill tone={it.status === 'done' ? 'ok' : it.status === 'on_hold' ? 'warn' : isOpen(it) ? 'accent' : ''}>{STATUS_TEXT[it.status]}</Pill></span>}
                  onClick={() => setUI({ tab: 'requests', selItem: r.id, selWo: undefined, sheet: null })}
                  chevron
                />
              ))}
            </Group>
          )}
        </section>
        <HandoverPanel />
      </div>

      <Sheet open={soon !== null} title={soon ? SOON[soon] : ''} onClose={() => setSoon(null)}>
        {soon && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="banner quiet"><Icon name="info" weight="fill" /><span>{SOON_LINE[soon]}</span></div>
            <Button block onClick={() => setSoon(null)}>Got it</Button>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
