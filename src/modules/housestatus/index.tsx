import { lazyScreen, type ModuleDef } from '../types';
import { badge } from './model';

// House Status: a running log of building-wide conditions with timed updates until closed (spec A.8).
const housestatus: ModuleDef = {
  id: 'housestatus',
  label: 'House Status',
  icon: 'note',
  badge,
  badgeLabel: 'not closed',
  Screen: lazyScreen(() => import('./HouseStatusScreen').then((m) => m.HouseStatusScreen)),
};
export default housestatus;
