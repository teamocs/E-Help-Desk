import { lazyScreen, type ModuleDef } from '../types';

/**
 * Crisis Mgmt: the safety incidents today; crisis cases arrive in wave 2. Badge: unresolved, which until cases exist
 * means safety alerts still active (a downgraded or resolved alert is closed).
 */
const crisis: ModuleDef = {
  id: 'crisis',
  label: 'Crisis Mgmt',
  icon: 'siren',
  badge: (s) => s.incidents.filter((i) => i.status === 'active').length,
  badgeLabel: 'unresolved',
  Screen: lazyScreen(() => import('./Crisis').then((m) => m.Crisis)),
};
export default crisis;
