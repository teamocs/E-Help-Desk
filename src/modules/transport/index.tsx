import { lazyScreen, type ModuleDef } from '../types';

// Transport (the prototype's "Transport Log"): hotel vehicle trips, logged or scheduled, then departed and arrived (spec A.10).
// No sidebar badge: the prototype has none.
const transport: ModuleDef = {
  id: 'transport',
  label: 'Transport',
  icon: 'van',
  Screen: lazyScreen(() => import('./TransportScreen').then((m) => m.TransportScreen)),
};
export default transport;
