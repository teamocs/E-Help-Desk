import { ComingNext } from '../ComingNext';
import type { ModuleDef } from '../types';

/** Wave 2 replaces this placeholder with the module's own screen (see ../README.md). */
function Inquiries() {
  return <ComingNext title="Inquiries" icon="chat" action="New Inquiry" filters={['All', 'Active', 'Done']} line="Questions from in-house guests, callers and checked-out guests, logged and closed within minutes." />;
}

const inquiries: ModuleDef = {
  id: 'inquiries',
  label: 'Inquiries',
  icon: 'chat',
  // Wave 2: count active plus noted inquiries from moduleData(s, 'inquiries'). Until the module has data the count is 0, shown as the prototype shows it.
  badge: () => 0,
  badgeLabel: 'active',
  Screen: Inquiries,
};
export default inquiries;
