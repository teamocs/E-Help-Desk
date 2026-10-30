import { useMemo, useState } from 'react';
import { useApp } from '../../domain/store';
import { Button, Empty, Icon, Pill, Screen, Segmented } from '../../ui/kit';
import { useStore } from '../inquiries/fields';
import { when } from '../inquiries/hotelTime';
import { ALL_HD, LINK_NAME, doneReminder, filterReminders, isOverdue, remindersOf, reminderForm, type Reminder, type ReminderFilter } from './data';
import { ReminderForm } from './ReminderForm';

function Card({ r, now, who }: { r: Reminder; now: number; who: string }) {
  const late = isOverdue(r, now);
  return (
    <li className={`rem ${late ? 'is-late' : ''} ${r.status === 'completed' ? 'is-done' : ''}`}>
      <div className="rem-top">
        <p className="rem-desc">{r.desc}</p>
        <Pill tone={r.status === 'completed' ? 'ok' : 'accent'}>{r.status}</Pill>
      </div>
      <div className="rem-meta">
        <span><span className="sr">Assigned to </span>{who}</span>
        {r.dueAt != null && (
          <span><Icon name="clock" size={16} /><span className="sr">Scheduled </span>{when(r.dueAt, now)}{late && <Pill tone="bad">OVERDUE</Pill>}</span>
        )}
        {r.status === 'completed' && r.completedAt != null && <span><Icon name="tick" size={16} />Done {when(r.completedAt, now)}</span>}
      </div>
      {r.link && <span className="rem-link"><span className="sr">Linked to </span>{LINK_NAME[r.link.type]} {r.link.label}</span>}
      {r.notes && <p className="rem-notes t-sub">{r.notes}</p>}
      {r.status === 'pending' && <Button size="sm" feel="success" aria-label={`Done: ${r.desc}`} onClick={() => doneReminder(r.id)}>Done</Button>}
    </li>
  );
}

export function Reminders() {
  const all = useApp(remindersOf);
  const now = useApp((s) => s.now);
  const staff = useApp((s) => s.staff);
  const form = useStore(reminderForm);
  const [f, setF] = useState<ReminderFilter>('all');
  const shown = useMemo(() => filterReminders(all, f), [all, f]);
  const pending = all.filter((r) => r.status === 'pending');
  const overdue = pending.filter((r) => isOverdue(r, now)).length;
  const open = () => reminderForm.set(() => ({ open: true }));

  return (
    <Screen title="Reminders" subtitle="Follow-ups">
      <div className="mod-bar">
        <Button icon="plus" feel="medium" onClick={open}>New Reminder</Button>
        <span className="t-sub c2" aria-live="polite">{pending.length} pending{overdue > 0 ? ` · ${overdue} overdue` : ''}</span>
      </div>
      <Segmented<ReminderFilter> label="Filter" value={f} onChange={setF} options={[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Pending' }, { value: 'completed', label: 'Completed' }]} />
      {shown.length === 0 ? (
        all.length === 0
          ? <Empty icon="bell" text="No reminders. Add a follow-up so it is not forgotten: a call back, a check, a promise made to a guest." action="New Reminder" onAction={open} />
          : <Empty icon={f === 'completed' ? 'tick' : 'bell'} text={f === 'completed' ? 'Nothing finished in the last 7 days.' : 'Nothing is pending.'} />
      ) : (
        <ul className="rem-grid" role="list" aria-label="Reminders" style={{ marginTop: 14 }}>
          {shown.map((r) => <Card key={r.id} r={r} now={now} who={r.assignee ? (staff.find((p) => p.id === r.assignee)?.name ?? 'Former staff') : ALL_HD} />)}
        </ul>
      )}
      <ReminderForm open={form.open} onClose={() => reminderForm.set(() => ({ open: false }))} />
    </Screen>
  );
}
