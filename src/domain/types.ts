export type Dept = 'housekeeping' | 'engineering' | 'it' | 'fnb' | 'frontdesk' | 'security';
export type Role = 'hdo' | 'staff' | 'supervisor' | 'manager' | 'owner';
export type ItemStatus =
  | 'new' | 'relayed' | 'on_site' | 'on_hold' | 'done'
  | 'transferred' | 'escalated' | 'cant_do' | 'duplicate' | 'cancelled';
export type HoldReason = 'parts' | 'no_access' | 'dnd' | 'vendor' | 'guest_declined';
export type Hazard = 'smoke' | 'gas' | 'flood' | 'medical' | 'threat' | 'lift';

export interface Staff {
  id: string;
  name: string;
  initials: string;
  role: Role;
  title: string;
  dept?: Dept;
  onShift: boolean;
}

export interface ItemEvent { at: number; by: string; what: string }

export interface Item {
  id: string;
  requestId: string;
  name: string;
  qty: number;
  dept: Dept;
  assignee?: string;
  status: ItemStatus;
  holdReason?: HoldReason;
  createdAt: number;
  ackAt?: number;
  doneAt?: number;
  holdSince?: number;
  heldMs: number;
  slaMin: number;
  dependsOn?: string;
  xFrom?: string;
  woId?: string;
  stBeforeEsc?: ItemStatus;
  events: ItemEvent[];
}

export interface Request {
  id: string;
  ticket: string;
  room: string;
  source: 'guest' | 'staff';
  remarks?: string;
  loggedBy: string;
  createdAt: number;
  itemIds: string[];
  incomplete?: boolean;
  vip?: boolean;
  safetyId?: string;
}

export type WoStatus = 'reported' | 'assessed' | 'in_progress' | 'on_hold' | 'done';

export interface WorkOrder {
  id: string;
  no: string;
  area: string;
  loc: string;
  desc: string;
  priority: 'low' | 'normal' | 'high';
  dept: Dept;
  status: WoStatus;
  reportedBy: string;
  encodedBy: string;
  createdAt: number;
  assessment?: string;
  assignType?: 'inhouse' | 'outsource';
  contractor?: string;
  estCost?: number;
  actualCost?: number;
  targetEnd?: number;
  srcItemId?: string;
  audit: ItemEvent[];
}

export type CleanStatus = 'scheduled' | 'queued' | 'ready' | 'in_progress' | 'done';
export interface CleanTask {
  id: string;
  room: string;
  type: 'Regular' | 'Checkout' | 'Deep clean' | 'Touch-up' | 'Pre-arrival' | 'VIP setup' | 'Turndown';
  status: CleanStatus;
  assignee?: string;
}

export interface Incident {
  id: string;
  no: string;
  hazard: Hazard;
  rooms: string[];
  createdAt: number;
  text: string;
  status: 'active' | 'downgraded' | 'resolved';
  called911?: { by: string; at: string };
  log: ItemEvent[];
}

/** The latest shift handover sign-off. Empty until someone signs off. */
export interface Handover { ackBy?: string; ackAt?: number }

export interface Op { id: string; label: string; at: number; synced: boolean }

export interface Net {
  internet: boolean;
  deviceWifi: boolean;
  power: boolean;
  tier: 'standard' | 'resilient';
  ups: number;
}

export interface Prefs {
  textScale: number;
  contrast: boolean;
  motion: 'auto' | 'reduce';
  haptics: boolean;
  sound: boolean;
  showHaptics: boolean;
  shadow: boolean;
  theme: 'auto' | 'light' | 'dark';
  shortcuts: boolean;
}

export interface Toast { id: string; text: string; tone: 'info' | 'success' | 'warn' | 'error' }

export interface Seq { t: number; wo: number; inc: number; id: number }

export interface Seed {
  requests: Request[];
  items: Record<string, Item>;
  wos: WorkOrder[];
  cleaning: CleanTask[];
  seq: Seq;
}

export interface State {
  now: number;
  me: string | null;
  staff: Staff[];
  requests: Request[];
  items: Record<string, Item>;
  wos: WorkOrder[];
  cleaning: CleanTask[];
  incidents: Incident[];
  seq: Seq;
  net: Net;
  ops: Op[];
  pending: string[];
  reconciling: boolean;
  stationB: { requests: number; open: number; lastSync: number };
  netlog: { at: number; text: string }[];
  handover: Handover;
  prefs: Prefs;
  toasts: Toast[];
  announce: string;
}
