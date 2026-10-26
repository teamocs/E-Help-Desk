import { useMemo } from 'react';
import { motion } from 'motion/react';
import { ago, DEPTS, isOpen, sla } from '../domain/rules';
import { setPref, useApp } from '../domain/store';
import type { Dept } from '../domain/types';
import { springs } from '../lib/motion';
import { Group, Icon, NetPill, Pill, Row, Screen, Switch } from '../ui/kit';

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);

/** Department-level only. There is no per-person ranking anywhere in this app. */
export function Insights() {
  const items = useApp((s) => s.items);
  const requests = useApp((s) => s.requests);
  const now = useApp((s) => s.now);
  const shadow = useApp((s) => s.prefs.shadow);
  const me = useApp((s) => s.staff.find((p) => p.id === s.me));
  const lens = me?.role === 'owner' ? 'Owner view' : me?.role === 'manager' ? 'Duty manager view' : 'Department view';
  const hidden = shadow && (me?.role === 'manager' || me?.role === 'owner');

  const rows = useMemo(() => {
    const all = Object.values(items);
    return (Object.keys(DEPTS) as Dept[])
      .map((d) => {
        const its = all.filter((i) => i.dept === d);
        const acked = its.filter((i) => i.ackAt);
        const done = its.filter((i) => i.status === 'done' && i.ackAt && i.doneAt);
        const relayOk = acked.filter((i) => (i.ackAt as number) - i.createdAt <= 2 * 60000).length;
        const doneOk = done.filter((i) => (i.doneAt as number) - (i.ackAt as number) - i.heldMs <= i.slaMin * 60000).length;
        return { d, n: its.length, open: its.filter(isOpen).length, overdue: its.filter((i) => sla(i, items, now).overdue).length, relay: pct(relayOk, acked.length), comp: pct(doneOk, done.length) };
      })
      .filter((r) => r.n > 0);
  }, [items, now]);

  const holds = Object.values(items).filter((i) => i.status === 'on_hold').sort((a, b) => (a.holdSince ?? 0) - (b.holdSince ?? 0));
  const totalOpen = rows.reduce((a, r) => a + r.open, 0);
  const totalOver = rows.reduce((a, r) => a + r.overdue, 0);

  return (
    <Screen title="Insights" subtitle={lens} trailing={<NetPill />}>
      {hidden ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={springs.snappy}>
          <div className="banner">
            <Icon name="hourglass" weight="fill" />
            <div>
              <b>Shadow mode is on.</b>
              <p className="t-sub" style={{ margin: '4px 0 0' }}>Timers and scorecards stay hidden while the team runs alongside radio and paper. We first check that what is logged matches what really happened.</p>
            </div>
          </div>
          <Group title="What we can show now">
            <Row icon="clip" title={`${requests.length} tickets logged this shift`} sub="Counts only" />
            <Row icon="phone" title="Logged vs. actual work" sub="Illustrative: 24 logged against about 31 estimated from desk calls and radio traffic" trailing={<Pill>Example</Pill>} />
            <Row icon="hourglass" title={`${holds.length} item${holds.length === 1 ? '' : 's'} on hold`} sub="Owned by the department head" />
          </Group>
          <Group>
            <div className="row">
              <span className="grow"><span className="t-head" style={{ display: 'block' }}>Reveal timers (demo)</span><span className="t-foot c2">Turns shadow mode off so you can see the scorecards.</span></span>
              <Switch checked={!shadow} onChange={(v) => setPref('shadow', !v)} label="Reveal timers" />
            </div>
          </Group>
        </motion.div>
      ) : (
        <>
          <div className="group" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {[['Open', totalOpen], ['Overdue', totalOver], ['On hold', holds.length]].map(([l, n], i) => (
              <div key={l as string} style={{ padding: '14px 16px', borderLeft: i ? '0.5px solid var(--sep)' : 0 }}>
                <div className="stat" style={{ color: l === 'Overdue' && (n as number) > 0 ? 'var(--bad)' : undefined }}>{n}</div>
                <div className="t-sub c2">{l}</div>
              </div>
            ))}
          </div>

          <Group title="By department" note="Relay: acknowledged within 2 minutes. Completion: finished within the target for that item type. Hold time does not count against anyone.">
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="bars">
                {rows.map((r) => (
                  <div key={r.d}>
                    <div className="t-head" style={{ marginBottom: 6 }}>{DEPTS[r.d].label} <span className="t-foot c2" style={{ fontWeight: 400 }}>· {r.n} items</span></div>
                    {([['Relay', r.relay], ['Completion', r.comp]] as const).map(([l, v]) => (
                      <div key={l} className="barline" style={{ marginBottom: 4 }}>
                        <span className="t-sub c2">{l}</span>
                        <span className="track"><motion.i initial={{ width: 0 }} animate={{ width: `${v ?? 0}%` }} transition={springs.gentle} style={{ background: (v ?? 100) >= 80 ? 'var(--ok)' : (v ?? 100) >= 60 ? 'var(--warn)' : 'var(--bad)' }} /></span>
                        <span className="t-sub" style={{ textAlign: 'right' }}>{v == null ? '—' : `${v}%`}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </Group>

          {holds.length > 0 && (
            <Group title="Held longest" note="Reviewed weekly by each department head. An item on hold never silently expires.">
              {holds.slice(0, 5).map((i) => (
                <Row key={i.id} icon="hourglass" tint="var(--warn)" title={<span>Room {requests.find((r) => r.id === i.requestId)?.room}: {i.name}</span>} sub={`${DEPTS[i.dept].label} head owns this`} trailing={<Pill tone="warn">{ago(now - (i.holdSince ?? now))}</Pill>} />
              ))}
            </Group>
          )}

          <Group title="Alert health" note="Illustrative figures. A real system watches mute rates so alert fatigue shows up before it hurts.">
            <Row icon="bell" title="Sounds today" sub="Safety, VIP and overdue only" trailing={<span className="t-head">3</span>} />
            <Row icon="phone" title="Alerts acted on within a minute" trailing={<span className="t-head">92%</span>} />
            <Row icon="prohibit" title="Devices with alerts muted" trailing={<span className="t-head">0</span>} />
          </Group>
        </>
      )}
      <div className="banner ok" style={{ marginTop: 18 }}>
        <Icon name="hand" weight="fill" />
        <span className="t-sub"><b>No rankings of people.</b> Names are for routing and for guests. Timer data is not used for discipline without a manager reviewing the context.</span>
      </div>
    </Screen>
  );
}
