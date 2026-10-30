import { motion } from 'motion/react';
import { isOpen, sla } from '../domain/rules';
import { ackHandover, returnOrphans, setUI, useApp } from '../domain/store';
import { springs } from '../lib/motion';
import { Button, DeptChip, Group, Icon, Pill, Row } from '../ui/kit';

/** A sign-off older than one shift belongs to an earlier handover, so the next officer can sign again. */
const SHIFT_MS = 8 * 3_600_000;

/**
 * The shift handover, as a panel on the Dashboard (it was its own screen before the prototype's 11-item sidebar):
 * promises to guests, work whose owner went off shift, what is already overdue, and the incoming officer's sign-off.
 * The counts it used to show are the Dashboard's own counts now.
 */
export function HandoverPanel() {
  const items = useApp((s) => s.items);
  const requests = useApp((s) => s.requests);
  const staff = useApp((s) => s.staff);
  const ack = useApp((s) => s.handover);
  const now = useApp((s) => s.now);

  const open = Object.values(items).filter(isOpen);
  const overdue = open.filter((i) => sla(i, items, now).overdue);
  const held = open.filter((i) => i.status === 'on_hold');
  const roomOf = (id: string) => requests.find((r) => r.id === id);
  const promises = open.filter((i) => roomOf(i.requestId)?.vip || /late checkout/i.test(i.name));
  const off = new Set(staff.filter((p) => !p.onShift).map((p) => p.id));
  const orphans = open.filter((i) => i.assignee && off.has(i.assignee));

  return (
    <section className="dash-panel" aria-labelledby="handover-title">
      <h2 id="handover-title" className="dash-h">Shift handover</h2>
      <p className="t-sub c2" style={{ margin: 0 }}>For the next officer. Nothing lives in someone’s head.</p>
      {!promises.length && !orphans.length && !overdue.length && (
        <p className="t-body" style={{ margin: '12px 0 0' }}>Nothing promised, orphaned or overdue to hand over{held.length ? `; ${held.length} on hold` : ''}.</p>
      )}

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
    </section>
  );
}
