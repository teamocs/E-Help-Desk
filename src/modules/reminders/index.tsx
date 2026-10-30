import { lazyScreen, type ModuleDef } from '../types';
import { reminderBadge } from './data';

/**
 * Reminders (the client prototype's module 9): follow-ups for the help desk, optionally linked to a request, work
 * order, inquiry, house-status log or crisis case. Badge: pending. The cards carry everything, so there is no detail pane.
 */
const reminders: ModuleDef = {
  id: 'reminders',
  label: 'Reminders',
  icon: 'bell',
  badge: reminderBadge,
  badgeLabel: 'pending',
  Screen: lazyScreen(() => import('./Reminders').then((m) => m.Reminders)),
};
export default reminders;
