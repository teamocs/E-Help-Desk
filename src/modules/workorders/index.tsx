import { WoDetail } from '../../screens/Maintenance';
import { lazyScreen, type ModuleDef } from '../types';
import { mergeWos } from './model';

/** Work Orders: the table, forms and record pane (screens/Maintenance.tsx). Badge: work orders not done (scheduled included, as the prototype counts). */
const workorders: ModuleDef = {
  id: 'workorders',
  label: 'Work Orders',
  icon: 'wrench',
  badge: (s) => mergeWos(s).filter((w) => w.status !== 'done').length,
  badgeLabel: 'not done',
  phoneTab: true,
  Screen: lazyScreen(() => import('../../screens/Maintenance').then((m) => m.Maintenance)),
  detail: { title: 'Work order', selected: (ui) => ui.selWo, View: WoDetail },
};
export default workorders;
