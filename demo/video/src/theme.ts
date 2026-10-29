// Hotel-grade palette. Light theme only, no pure black.
export const INK = '#201e1d';
export const MUTED = '#5d5852';
export const PAPER = '#fffdf8';
export const GOLD = '#c0a14c';

export type Hotel = 'baguio' | 'boracay';

export const HOTELS: Record<Hotel, {name: string; base: string; accent: string; strong: string; tint: string}> = {
  baguio: {name: 'Azalea Baguio', base: '#f6f2e9', accent: '#3f7052', strong: '#345f45', tint: 'rgba(63,112,82,0.11)'},
  boracay: {name: 'Azalea Boracay', base: '#f7f4ec', accent: '#177280', strong: '#135f6b', tint: 'rgba(23,114,128,0.11)'},
};

export const hotelOf = (h?: string) => HOTELS[(h === 'boracay' ? 'boracay' : 'baguio') as Hotel];

// Who the screen is shown for. The words matter more than the colour.
export const ROLES: Record<string, {label: string; color: string}> = {
  owner: {label: 'hotel owner', color: '#345f45'},
  manager: {label: 'manager', color: '#135f6b'},
  supervisor: {label: 'supervisor', color: '#7a5f16'},
  device: {label: 'shared phone', color: '#6a4a72'},
  everyone: {label: 'everyone', color: '#5d5852'},
};
export const roleOf = (r?: string) => ROLES[r ?? 'owner'] ?? {label: r ?? 'staff', color: MUTED};

export const TITLE_FONT = 'Amaranth, Georgia, serif';
export const BODY_FONT = 'Figtree, "Segoe UI", sans-serif';
