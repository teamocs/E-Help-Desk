import { motion } from 'motion/react';
import { cleanSet, openComposer, useApp } from '../domain/store';
import type { CleanStatus } from '../domain/types';
import { springs } from '../lib/motion';
import { Button, Empty, Group, Icon, Pill, Screen } from '../ui/kit';

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
    <Screen title="Housekeeping" subtitle={tasks.length ? `${ready} room${ready === 1 ? '' : 's'} ready now` : 'Rooms to clean, in the order they can be done'}>
      {tasks.length === 0 ? (
        <Empty icon="broom" text="No cleaning tasks right now. A room that needs cleaning can still be logged as a housekeeping request." action="Log a cleaning request" onAction={() => openComposer({ preset: 'clean' })} />
      ) : (
        <div className="banner quiet">
          <Icon name="bolt" weight="fill" />
          <span className="t-sub">Finish a <b>checkout</b> or <b>inspection</b> item on a ticket and that room turns Ready here automatically.</span>
        </div>
      )}
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
