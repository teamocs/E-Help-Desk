import { motion } from 'motion/react';
import { cleanSet, useApp } from '../domain/store';
import type { CleanStatus } from '../domain/types';
import { springs } from '../lib/motion';
import { Button, Group, Icon, NetPill, Pill, Screen } from '../ui/kit';

const ORDER: { st: CleanStatus; title: string }[] = [
  { st: 'ready', title: 'Ready to clean' },
  { st: 'in_progress', title: 'In progress' },
  { st: 'queued', title: 'Guest still checking out' },
  { st: 'scheduled', title: 'Scheduled' },
  { st: 'done', title: 'Done' },
];

export function Housekeeping() {
  const tasks = useApp((s) => s.cleaning);
  const staff = useApp((s) => s.staff);
  const ready = tasks.filter((t) => t.status === 'ready').length;
  return (
    <Screen title="Housekeeping" subtitle={`${ready} room${ready === 1 ? '' : 's'} ready now`} trailing={<NetPill />}>
      <div className="banner ok" style={{ marginBottom: 6 }}>
        <Icon name="bolt" weight="fill" />
        <span className="t-sub">Finish a <b>checkout</b> or <b>inspection</b> item on a ticket and that room turns Ready here automatically.</span>
      </div>
      {ORDER.map(({ st, title }) => {
        const ts = tasks.filter((t) => t.status === st);
        if (!ts.length) return null;
        return (
          <Group key={st} title={title}>
            {ts.map((t) => (
              <motion.div key={t.id} layout="position" transition={springs.snappy} className="row" style={{ minHeight: '3.6rem' }}>
                <span className="room">{t.room}</span>
                <span className="grow">
                  <span className="t-head" style={{ display: 'block' }}>{t.type}</span>
                  <span className="t-foot c2">{staff.find((p) => p.id === t.assignee)?.name ?? 'Unassigned'}</span>
                </span>
                {t.status === 'ready' && <Button size="sm" feel="medium" onClick={() => cleanSet(t.id, 'in_progress')}>Start</Button>}
                {t.status === 'in_progress' && <Button size="sm" feel="success" onClick={() => cleanSet(t.id, 'done')}>Done</Button>}
                {(t.status === 'queued' || t.status === 'scheduled') && <Button size="sm" variant="gray" onClick={() => cleanSet(t.id, 'ready')}>Mark ready</Button>}
                {t.status === 'done' && <Pill tone="ok">Done</Pill>}
              </motion.div>
            ))}
          </Group>
        );
      })}
    </Screen>
  );
}
