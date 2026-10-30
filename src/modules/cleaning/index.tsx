import { lazyScreen, type ModuleDef } from '../types';

/** Cleaning: the existing Housekeeping screen. No badge (the prototype shows none). */
const cleaning: ModuleDef = {
  id: 'cleaning',
  label: 'Cleaning',
  icon: 'broom',
  phoneTab: true,
  Screen: lazyScreen(() => import('../../screens/Housekeeping').then((m) => m.Housekeeping)),
};
export default cleaning;
