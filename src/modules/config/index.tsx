import { lazyScreen, type ModuleDef } from '../types';

/**
 * Configuration: the hotel profile, every list the server declares (built-in and each module's), help-desk staff,
 * staff PINs, logins and this device's preferences, gated by role (sections.ts). No badge.
 */
const config: ModuleDef = {
  id: 'config',
  label: 'Configuration',
  icon: 'gear',
  Screen: lazyScreen(() => import('./Configuration').then((m) => m.Configuration)),
};
export default config;
