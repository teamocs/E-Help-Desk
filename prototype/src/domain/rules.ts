import type { Dept, Hazard, Item, Net, Staff } from './types';

export const DEPTS: Record<Dept, { label: string; short: string }> = {
  housekeeping: { label: 'Housekeeping', short: 'HK' },
  engineering: { label: 'Engineering', short: 'ENG' },
  it: { label: 'IT', short: 'IT' },
  fnb: { label: 'Food & Beverage', short: 'F&B' },
  frontdesk: { label: 'Front Desk', short: 'FD' },
  security: { label: 'Security', short: 'SEC' },
};

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

export interface Preset { key: string; label: string; dept: Dept; slaMin: number; icon: string }

export const PRESETS: Preset[] = [
  { key: 'towels', label: 'Extra towels', dept: 'housekeeping', slaMin: 10, icon: 'towel' },
  { key: 'pillow', label: 'Extra pillow', dept: 'housekeeping', slaMin: 10, icon: 'bed' },
  { key: 'toiletries', label: 'Toiletries', dept: 'housekeeping', slaMin: 10, icon: 'drop' },
  { key: 'clean', label: 'Room cleaning', dept: 'housekeeping', slaMin: 30, icon: 'broom' },
  { key: 'inspection', label: 'Checkout inspection', dept: 'housekeeping', slaMin: 25, icon: 'check' },
  { key: 'ac', label: 'AC not cold', dept: 'engineering', slaMin: 45, icon: 'snow' },
  { key: 'bulb', label: 'Light bulb', dept: 'engineering', slaMin: 30, icon: 'bulb' },
  { key: 'hotwater', label: 'No hot water', dept: 'engineering', slaMin: 30, icon: 'flame' },
  { key: 'wifi', label: 'Wi-Fi issue', dept: 'it', slaMin: 20, icon: 'wifi' },
  { key: 'tv', label: 'TV not working', dept: 'it', slaMin: 20, icon: 'tv' },
  { key: 'water', label: 'Bottled water', dept: 'fnb', slaMin: 10, icon: 'bottle' },
  { key: 'tray', label: 'Tray pickup', dept: 'fnb', slaMin: 15, icon: 'tray' },
  { key: 'late', label: 'Late checkout', dept: 'frontdesk', slaMin: 15, icon: 'clock' },
  { key: 'noise', label: 'Noise complaint', dept: 'security', slaMin: 10, icon: 'ear' },
];

export const BUNDLES = [
  {
    key: 'leak',
    label: 'Leak',
    hint: 'Engineering fixes the source, Housekeeping cleans up after',
    parts: [
      { name: 'Leak: fix source', dept: 'engineering' as Dept, slaMin: 20 },
      { name: 'Leak: clean up', dept: 'housekeeping' as Dept, slaMin: 25, after: 0 },
    ],
  },
];

export const HOLD_REASONS = {
  parts: 'Waiting for parts',
  no_access: 'No access to room',
  dnd: 'Guest on Do Not Disturb',
  vendor: 'Waiting for vendor',
  guest_declined: 'Guest declined for now',
} as const;

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
