import { ComingNext } from '../ComingNext';
import type { ModuleDef } from '../types';

/** Wave 2 replaces this placeholder with the module's own screen (see ../README.md). */
function Transport() {
  return <ComingNext title="Transport Log" icon="van" action="Log Trip" filters={['All', 'Scheduled', 'En Route', 'Arrived']} line="Hotel vehicle trips: departures, arrivals and scheduled pickups." />;
}

const transport: ModuleDef = {
  id: 'transport',
  label: 'Transport',
  icon: 'van',
  Screen: Transport,
};
export default transport;
