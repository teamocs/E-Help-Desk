import { lazyScreen, type ModuleDef } from '../types';

/** Cleaning: table, Log Cleaning, Schedule Rooms, clock in and out (screens/Housekeeping.tsx). No badge (the prototype shows none). */
const cleaning: ModuleDef = {
  id: 'cleaning',
  label: 'Cleaning',
  icon: 'broom',
  phoneTab: true,
  Screen: lazyScreen(() => import('../../screens/Housekeeping').then((m) => m.Housekeeping)),
};
export default cleaning;
