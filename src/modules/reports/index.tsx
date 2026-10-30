import { lazyScreen, type ModuleDef } from '../types';

/** Reports: the live counts and department scores (was Insights). No badge. */
const reports: ModuleDef = {
  id: 'reports',
  label: 'Reports',
  icon: 'chart',
  Screen: lazyScreen(() => import('../../screens/Insights').then((m) => m.Insights)),
};
export default reports;
