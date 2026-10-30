import { lazyScreen, type ModuleDef } from '../types';

/** Dashboard: quick actions, the live counts, recent tickets and the shift handover panel. No badge. */
const dashboard: ModuleDef = {
  id: 'dashboard',
  label: 'Dashboard',
  icon: 'gauge',
  phoneTab: true,
  Screen: lazyScreen(() => import('./Dashboard').then((m) => m.Dashboard)),
};
export default dashboard;
