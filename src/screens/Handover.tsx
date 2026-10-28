import { motion } from 'motion/react';
import { isOpen, sla } from '../domain/rules';
import { ackHandover, returnOrphans, setUI, useApp } from '../domain/store';
import { springs } from '../lib/motion';
import { Button, DeptChip, Group, Icon, NetPill, Pill, Row, Screen } from '../ui/kit';

/** A sign-off older than one shift belongs to an earlier handover, so the next officer can sign again. */
const SHIFT_MS = 8 * 3_600_000;

export function Handover() {
  const items = useApp((s) => s.items);
  const requests = useApp((s) => s.requests);
  const staff = useApp((s) => s.staff);
  const cleaning = useApp((s) => s.cleaning);
  const ack = useApp((s) => s.handover);
  const now = useApp((s) => s.now);

  const open = Object.values(items).filter(isOpen);
  const overdue = open.filter((i) => sla(i, items, now).overdue);
  const held = open.filter((i) => i.status === 'on_hold');
  const roomOf = (id: string) => requests.find((r) => r.id === id);
  const promises = open.filter((i) => roomOf(i.requestId)?.vip || /late checkout/i.test(i.name));
  const off = new Set(staff.filter((p) => !p.onShift).map((p) => p.id));
  const orphans = open.filter((i) => i.assignee && off.has(i.assignee));
  const queued = cleaning.filter((c) => c.status === 'queued' || c.status === 'scheduled').length;

  const tiles = [
    { label: 'Open', n: open.length, tone: '' },
    { label: 'Overdue', n: overdue.length, tone: overdue.length ? 'var(--bad)' : '' },
    { label: 'On hold', n: held.length, tone: held.length ? 'var(--warn)' : '' },
    { label: 'Rooms to clean', n: queued, tone: '' },
  ];

  return (
    <Screen title="Shift handover" subtitle="One screen for the next officer. Nothing lives in someone’s head." trailing={<NetPill />}>
      <div className="group" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {tiles.map((t, i) => (
          <div key={t.label} style={{ padding: '14px 16px', borderTop: i > 1 ? '0.5px solid var(--sep)' : 0, borderLeft: i % 2 ? '0.5px solid var(--sep)' : 0 }}>
            <div className="stat" style={{ color: t.tone || undefined }}>{t.n}</div>
            <div className="t-sub c2">{t.label}</div>
          </div>
        ))}
      </div>

      {promises.length > 0 && (
        <Group title="Promises made to guests" note="VIP rooms and late-checkout requests. The incoming officer owns these from the first minute.">
          {promises.map((i) => (
            <Row key={i.id} title={<span>Room {roomOf(i.requestId)?.room}: {i.name}</span>} sub={roomOf(i.requestId)?.vip ? 'VIP guest' : 'Promised to guest'} trailing={<DeptChip dept={i.dept} />} onClick={() => setUI({ tab: 'requests', selItem: i.requestId })} chevron />
          ))}
        </Group>
      )}

      {orphans.length > 0 && (
        <Group title="Owner went off shift" note="These have no one on duty to finish them. Returning them puts them back in the department queue.">
          {orphans.map((i) => (
            <Row key={i.id} icon="user" title={<span>Room {roomOf(i.requestId)?.room}: {i.name}</span>} sub={`Was with ${staff.find((p) => p.id === i.assignee)?.name}`} trailing={<Pill tone="warn">Orphaned</Pill>} />
          ))}
          <div className="row"><Button block variant="tint" feel="medium" onClick={returnOrphans}>Return {orphans.length} to the department queue</Button></div>
        </Group>
      )}

      {overdue.length > 0 && (
        <Group title="Already overdue" note="Inherited from the last shift. These do not count against you.">
          {overdue.slice(0, 5).map((i) => <Row key={i.id} title={<span>Room {roomOf(i.requestId)?.room}: {i.name}</span>} trailing={<DeptChip dept={i.dept} />} onClick={() => setUI({ tab: 'requests', selItem: i.requestId })} chevron />)}
        </Group>
      )}

      <div style={{ marginTop: 22 }}>
        {ack.ackAt && now - ack.ackAt < SHIFT_MS ? (
          <motion.div className="banner ok" initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springs.gentle} role="status">
            <Icon name="tick" weight="fill" />
            <span><b>Acknowledged by {ack.ackBy}</b> at {new Date(ack.ackAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. The outgoing officer is released.</span>
          </motion.div>
        ) : (
          <>
            <Button size="lg" block feel="success" onClick={ackHandover}>Acknowledge handover</Button>
            {ack.ackAt ? (
              <p className="t-sub c2" style={{ marginTop: 8 }}>
                Last signed off by {ack.ackBy} on {new Date(ack.ackAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Screen>
  );
}
