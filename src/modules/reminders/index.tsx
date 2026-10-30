import { ComingNext } from '../ComingNext';
import type { ModuleDef } from '../types';

/** Wave 2 replaces this placeholder with the module's own screen (see ../README.md). */
function Reminders() {
  return <ComingNext title="Reminders" icon="bell" action="New Reminder" filters={['All', 'Pending', 'Completed']} line="Follow-ups for the help desk, linked to a ticket, work order, house log or crisis case." />;
}

const reminders: ModuleDef = {
  id: 'reminders',
  label: 'Reminders',
  icon: 'bell',
  // Wave 2: count pending reminders from moduleData(s, 'reminders'). Until the module has data the count is 0, shown as the prototype shows it.
  badge: () => 0,
  badgeLabel: 'pending',
  Screen: Reminders,
};
export default reminders;
