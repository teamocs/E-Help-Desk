import { ComingNext } from '../ComingNext';
import type { ModuleDef } from '../types';

/** Wave 2 replaces this placeholder with the module's own screen (see ../README.md). */
function HouseStatus() {
  return <ComingNext title="House Status" icon="note" action="New Log" filters={[]} line="A running log of building-wide conditions, like low water pressure or an outage, with timed updates until closed." />;
}

const housestatus: ModuleDef = {
  id: 'housestatus',
  label: 'House Status',
  icon: 'note',
  // Wave 2: count logs not closed from moduleData(s, 'housestatus'). Until the module has data the count is 0, shown as the prototype shows it.
  badge: () => 0,
  badgeLabel: 'not closed',
  Screen: HouseStatus,
};
export default housestatus;
