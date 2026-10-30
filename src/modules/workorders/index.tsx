import { WoDetail } from '../../screens/Maintenance';
import { lazyScreen, type ModuleDef } from '../types';

/** Work Orders: the existing Maintenance screen. Badge: work orders not done. */
const workorders: ModuleDef = {
  id: 'workorders',
  label: 'Work Orders',
  icon: 'wrench',
  badge: (s) => s.wos.filter((w) => w.status !== 'done').length,
  badgeLabel: 'not done',
  phoneTab: true,
  Screen: lazyScreen(() => import('../../screens/Maintenance').then((m) => m.Maintenance)),
  detail: { title: 'Work order', selected: (ui) => ui.selWo, View: WoDetail },
};
export default workorders;
