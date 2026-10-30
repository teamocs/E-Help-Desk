import type { ModuleDef } from '../types';
// A static import: the WordPress build inlines every module anyway, and a lazy one would still be loading when a
// test that only imports the registry has finished.
import { ReportsScreen } from './Reports';

/** Reports: today at a glance (the former Insights) and the prototype's six reports with CSV export. No badge. */
const reports: ModuleDef = {
  id: 'reports',
  label: 'Reports',
  icon: 'chart',
  Screen: ReportsScreen,
};
export default reports;
