import { lazyScreen, type ModuleDef } from '../types';
import { inquiryBadge } from './data';
import { InquiryDetail } from './InquiryDetail';

/**
 * Inquiries (the client prototype's module 3): questions from in-house guests, outside callers and checked-out
 * guests, logged and closed within minutes. Badge: active plus noted. The detail pane reuses the selected-record slot
 * (selItem) the Requests module also uses; it only shows while this module is open.
 */
const inquiries: ModuleDef = {
  id: 'inquiries',
  label: 'Inquiries',
  icon: 'chat',
  badge: inquiryBadge,
  badgeLabel: 'active',
  Screen: lazyScreen(() => import('./Inquiries').then((m) => m.Inquiries)),
  detail: { title: 'Inquiry', selected: (ui) => ui.selItem, View: InquiryDetail },
};
export default inquiries;
