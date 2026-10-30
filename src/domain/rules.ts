import type { Hazard, Item, ItemStatus, Net, Staff } from './types';

// Departments, request types, bundles and hold reasons are the hotel's own lists now: see catalog.ts.
// What stays here is fixed because logic depends on it (hazards and safety words, statuses, the SLA clock).

export const STAFF: Staff[] = [
  { id: 's-maria', name: 'Maria Santos', initials: 'MS', role: 'hdo', title: 'Head Desk Officer', dept: 'frontdesk', onShift: true },
  { id: 's-joel', name: 'Joel Dizon', initials: 'JD', role: 'staff', title: 'Room Attendant', dept: 'housekeeping', onShift: true },
  { id: 's-ramon', name: 'Ramon Cruz', initials: 'RC', role: 'staff', title: 'Engineer', dept: 'engineering', onShift: true },
  { id: 's-paolo', name: 'Paolo Rivera', initials: 'PR', role: 'staff', title: 'IT Support', dept: 'it', onShift: true },
  { id: 's-liza', name: 'Liza Abad', initials: 'LA', role: 'supervisor', title: 'Housekeeping Supervisor', dept: 'housekeeping', onShift: true },
  { id: 's-ana', name: 'Ana Villanueva', initials: 'AV', role: 'manager', title: 'Duty Manager', onShift: true },
  { id: 's-reyes', name: 'Mr. Reyes', initials: 'MR', role: 'owner', title: 'Owner', onShift: true },
  { id: 's-dennis', name: 'Dennis Lim', initials: 'DL', role: 'staff', title: 'Night Engineer', dept: 'engineering', onShift: false },
];

export const ROLE_LABEL = { hdo: 'Desk officer', staff: 'Staff', supervisor: 'Supervisor', manager: 'Duty manager', owner: 'Owner' } as const;

export const HAZARDS: Record<Hazard, { label: string; call: string }> = {
  smoke: { label: 'Smoke or fire', call: 'Leave the area. Call the fire line and the front desk now.' },
  gas: { label: 'Gas smell', call: 'No switches or flames. Open windows, leave, and call engineering.' },
  flood: { label: 'Flooding', call: 'Keep clear of electrics. Call engineering to isolate water.' },
  medical: { label: 'Medical distress', call: 'Call the hotel nurse or 911 first. Stay with the guest.' },
  threat: { label: 'Threat or violence', call: 'Keep distance. Call security and 911 quietly.' },
  lift: { label: 'Trapped in a lift', call: 'Call the lift contractor and engineering. Talk to the guest through the intercom.' },
};

const SAFETY_RULES: { hazard: Hazard; re: RegExp }[] = [
  { hazard: 'smoke', re: /\b(smoke|smoking|fire|burning|usok|sunog|nasusunog|apoy)\b/i },
  { hazard: 'gas', re: /\b(gas smell|smells? (of )?gas|gas leak|amoy gas|lpg)\b/i },
  { hazard: 'flood', re: /\b(flood|flooding|baha|bumabaha)\b/i },
  { hazard: 'medical', re: /\b(can'?t breathe|cannot breathe|hindi makahinga|nahihirapan huminga|chest pain|unconscious|collapsed|seizure|nawalan ng malay)\b/i },
  { hazard: 'threat', re: /\b(gun|knife|weapon|threaten(ing)?|baril|patalim|saksak|armado)\b/i },
  { hazard: 'lift', re: /\b(stuck in (the )?(lift|elevator)|trapped|naipit|na-?stuck sa (lift|elevator))\b/i },
];

/** Runs before and outside any classifier. A false alarm costs minutes; a miss costs more. */
export function detectSafety(text: string): Hazard | null {
  for (const r of SAFETY_RULES) if (r.re.test(text)) return r.hazard;
  return null;
}

const CLOSED = ['done', 'transferred', 'escalated', 'cant_do', 'duplicate', 'cancelled'];
export const isClosed = (it: Item) => CLOSED.includes(it.status);
export const isOpen = (it: Item) => !isClosed(it);

export function isBlocked(it: Item, items: Record<string, Item>): boolean {
  if (!it.dependsOn) return false;
  const pre = items[it.dependsOn];
  return !!pre && pre.status !== 'done';
}

export type Phase = 'ack' | 'work' | 'waiting' | 'held' | 'closed';
export interface SlaView { phase: Phase; ratio: number; overdue: boolean; heldFor?: number }

const ACK_MS = 2 * 60000;

/** Two clocks: ack belongs to the department, completion starts at acknowledge, hold pauses it. */
export function sla(it: Item, items: Record<string, Item>, now: number): SlaView {
  if (isClosed(it)) return { phase: 'closed', ratio: 0, overdue: false };
  if (isBlocked(it, items)) return { phase: 'waiting', ratio: 0, overdue: false };
  if (it.status === 'on_hold') return { phase: 'held', ratio: 0, overdue: false, heldFor: now - (it.holdSince ?? now) };
  if (it.status === 'new') {
    const e = now - it.createdAt;
    return { phase: 'ack', ratio: e / ACK_MS, overdue: e > ACK_MS };
  }
  const start = it.ackAt ?? it.createdAt;
  const e = now - start - it.heldMs;
  const t = it.slaMin * 60000;
  return { phase: 'work', ratio: e / t, overdue: e > t };
}

/**
 * Where Undo takes an item, or { refused } with the reason. The same rule as Azl_Commands::undo_target (the UNDO RULES
 * block in Commands.php): one step back, to prevStatus when known, else the fallbacks for rows from before wave 2.
 */
export function undoTarget(it: Pick<Item, 'status' | 'prevStatus' | 'relayedBy' | 'onSiteAt' | 'ackAt' | 'woId' | 'stBeforeEsc'>): { to: ItemStatus } | { refused: string } {
  const prev = it.prevStatus;
  switch (it.status) {
    case 'relayed':
      return { to: 'new' };
    case 'on_site':
      if (prev === 'on_hold') return { refused: 'A resume cannot be undone. Put the item on hold again.' };
      if (prev === 'new' || prev === 'relayed') return { to: prev };
      return { to: it.relayedBy != null || it.onSiteAt == null || (it.ackAt != null && it.ackAt < it.onSiteAt) ? 'relayed' : 'new' };
    case 'on_hold':
      return { to: prev === 'relayed' || prev === 'on_site' ? prev : 'on_site' };
    case 'transferred':
      if (prev === 'new' || prev === 'relayed' || prev === 'on_site' || prev === 'on_hold') return { to: prev };
      return { to: it.onSiteAt == null ? 'relayed' : 'on_site' };
    case 'done':
    case 'cant_do':
    case 'duplicate':
    case 'cancelled':
      if (it.woId) return { refused: 'Closed by its work order. Reopen the work order instead.' };
      if (prev === 'on_hold') return { to: 'on_site' };
      if (prev === 'new' || prev === 'relayed' || prev === 'on_site') return { to: prev };
      return { to: it.onSiteAt == null ? 'relayed' : 'on_site' };
    case 'escalated':
      return { to: it.stBeforeEsc ?? 'on_site' };
    default:
      return { refused: 'Nothing to undo' };
  }
}

/** Station-to-hub path. Standard tier lives in the cloud, Resilient on the edge node. */
export function hubUp(n: Net, viaDevice = true): boolean {
  const lan = n.power || n.ups > 0;
  const wan = n.internet && n.power;
  return (n.tier === 'resilient' ? lan : wan) && (viaDevice ? n.deviceWifi : true);
}

export const pad = (n: number, w = 4) => String(n).padStart(w, '0');

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export const peso = (n?: number) => (n == null ? 'None' : '₱' + n.toLocaleString('en-PH'));
