import { openCount } from '../../domain/store';
import { RequestDetail } from '../../screens/Detail';
import { lazyScreen, type ModuleDef } from '../types';

/** Requests: the existing ticket screens. Badge: open items (new, relayed, on site, on hold), as the prototype counts. */
const requests: ModuleDef = {
  id: 'requests',
  label: 'Requests',
  icon: 'clip',
  badge: openCount,
  phoneTab: true,
  fab: true,
  Screen: lazyScreen(() => import('../../screens/Requests').then((m) => m.Requests)),
  detail: { title: 'Ticket', selected: (ui) => ui.selItem, View: RequestDetail },
};
export default requests;
