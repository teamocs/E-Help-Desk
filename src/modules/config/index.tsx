import { lazyScreen, type ModuleDef } from '../types';

/** Configuration: display, feel, staff, logins and lists (was Settings). No badge. */
const config: ModuleDef = {
  id: 'config',
  label: 'Configuration',
  icon: 'gear',
  Screen: lazyScreen(() => import('../../screens/Settings').then((m) => m.Settings)),
};
export default config;
