import { lazyScreen, type ModuleDef } from '../types';
import { unresolvedCount } from './model';

/**
 * Crisis Mgmt: safety alerts and the crisis case log. Badge "unresolved": open and monitored cases, plus active
 * safety alerts no open case covers yet (an alert and the case opened from it count once).
 */
const crisis: ModuleDef = {
  id: 'crisis',
  label: 'Crisis Mgmt',
  icon: 'siren',
  badge: unresolvedCount,
  badgeLabel: 'unresolved',
  Screen: lazyScreen(() => import('./Crisis').then((m) => m.Crisis)),
};
export default crisis;
