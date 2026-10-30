// Transport: the data the server sends (snapshot.modules.transport), the checks a form runs before it sends, the order
// trips are shown in, and the commands with their optimistic change. Pure functions: the screen only draws them.
import { moduleData, runModuleCommand } from '../../domain/store';
import type { State } from '../../domain/types';
import { hotelMoment } from '../housestatus/time';

export type TripStatus = 'scheduled' | 'en_route' | 'arrived' | 'cancelled';
export interface Trip {
  id: string;
  /** "TR-0001"; empty until the server has numbered a trip made on this device. */
  no: string;
  vehicleKey: string;
  /** The vehicle's name as it was when the trip was made. */
  vehicle: string;
  driver: string;
  dest: string;
  purpose: string;
  passengers: string;
  status: TripStatus;
  /** A scheduled trip's moment, epoch ms. */
  schedAt?: number;
  depAt?: number;
  arrAt?: number;
  createdAt: number;
}
export interface Vehicle { key: string; label: string; active: boolean }
export interface TransportSlice { trips: Trip[]; vehicles: Vehicle[] }

declare module '../../domain/store' {
  interface ModuleSlices { transport: TransportSlice }
}

export const STATUS_LABEL: Record<TripStatus, string> = { scheduled: 'Scheduled', en_route: 'En route', arrived: 'Arrived', cancelled: 'Cancelled' };
export const TONE = { scheduled: 'accent', en_route: 'warn', arrived: 'ok', cancelled: '' } as const;
export const LIMITS = { driver: 120, dest: 160, purpose: 160, passengers: 160 } as const;

export const tripsOf = (s: State): Trip[] => moduleData(s, 'transport')?.trips ?? [];
export const vehiclesOf = (s: State): Vehicle[] => moduleData(s, 'transport')?.vehicles ?? [];

export type Filter = 'all' | 'scheduled' | 'en_route' | 'arrived';
export const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'en_route', label: 'En Route' }, { value: 'arrived', label: 'Arrived' }];
export const visible = (trips: Trip[], f: Filter): Trip[] => (f === 'all' ? trips : trips.filter((t) => t.status === f));

/** On the road first (longest out first), then what is scheduled (soonest first), then what is over (latest first). */
export function sortTrips(trips: Trip[]): Trip[] {
  const rank = (t: Trip) => (t.status === 'en_route' ? 0 : t.status === 'scheduled' ? 1 : 2);
  const key = (t: Trip) => (rank(t) === 0 ? (t.depAt ?? 0) : rank(t) === 1 ? (t.schedAt ?? 0) : -(t.arrAt ?? t.createdAt));
  return [...trips].sort((a, b) => rank(a) - rank(b) || key(a) - key(b) || a.no.localeCompare(b.no));
}

/** A department staff member on a shared phone may depart and arrive the trips where they are the driver. */
export const isDriver = (t: Trip, name: string | undefined): boolean => !!name && t.driver.trim().toLowerCase() === name.trim().toLowerCase();

/* ---------- the checks a form runs (the server runs the same ones) ---------- */

export interface TripInput { vehicle: string; driver: string; dest: string; purpose: string; passengers: string; date?: string; time?: string }
export type Problems = Partial<Record<'vehicle' | 'dest' | 'driver' | 'purpose' | 'passengers' | 'when', string>>;

export function checkTrip(v: TripInput, needsWhen: boolean, vehicles: Vehicle[], keep?: string): Problems {
  const p: Problems = {};
  if (!vehicles.some((x) => x.key === v.vehicle && (x.active || x.key === keep))) p.vehicle = 'Choose a vehicle.';
  if (!v.dest.trim()) p.dest = 'Destination required';
  for (const k of ['driver', 'dest', 'purpose', 'passengers'] as const) if (!p[k] && v[k].trim().length > LIMITS[k]) p[k] = `Keep the ${k} under ${LIMITS[k]} characters.`;
  if (needsWhen && hotelMoment(v.date ?? '', v.time ?? '') === null) p.when = 'Choose a date and a time.';
  return p;
}
export const clean = (p: Problems): boolean => Object.values(p).every((x) => !x);

/* ---------- the optimistic changes (the next snapshot replaces them with the server's) ---------- */

const put = (slice: TransportSlice | undefined, fn: (t: Trip[], v: Vehicle[]) => Trip[]): TransportSlice => ({ vehicles: slice?.vehicles ?? [], trips: fn(slice?.trips ?? [], slice?.vehicles ?? []) });
const patch = (id: string, fn: (t: Trip) => Trip) => (slice: TransportSlice | undefined) => put(slice, (trips) => trips.map((t) => (t.id === id ? fn(t) : t)));
const text = (v: TripInput) => ({ driver: v.driver.trim(), dest: v.dest.trim(), purpose: v.purpose.trim(), passengers: v.passengers.trim() });

export function withTrip(slice: TransportSlice | undefined, v: TripInput, base: Pick<Trip, 'id' | 'status' | 'createdAt'> & Partial<Trip>): TransportSlice {
  return put(slice, (trips, vehicles) => [{ no: '', vehicleKey: v.vehicle, vehicle: vehicles.find((x) => x.key === v.vehicle)?.label ?? v.vehicle, ...text(v), ...base }, ...trips]);
}
export const withStep = (id: string, status: TripStatus, at: number) => patch(id, (t) => ({ ...t, status, ...(status === 'en_route' ? { depAt: at } : status === 'arrived' ? { arrAt: at } : {}) }));
export function withEdit(id: string, v: TripInput) {
  return (slice: TransportSlice | undefined) => {
    const at = hotelMoment(v.date ?? '', v.time ?? '');
    const label = (t: Trip) => (t.vehicleKey === v.vehicle ? t.vehicle : (slice?.vehicles.find((x) => x.key === v.vehicle)?.label ?? t.vehicle));
    return patch(id, (t) => ({ ...t, vehicleKey: v.vehicle, vehicle: label(t), ...text(v), ...(t.status === 'scheduled' && at !== null ? { schedAt: at } : {}) }))(slice);
  };
}

/* ---------- the commands ---------- */

const MOD = 'transport';
const fields = (v: TripInput) => ({ vehicle: v.vehicle, ...text(v) });

export function logTrip(v: TripInput) {
  const tripId = crypto.randomUUID();
  runModuleCommand(MOD, 'logTrip', { tripId, ...fields(v) }, (sl, s) => withTrip(sl as TransportSlice | undefined, v, { id: tripId, status: 'en_route', createdAt: s.now, depAt: s.now }), [tripId]);
}
export function scheduleTrip(v: TripInput) {
  const tripId = crypto.randomUUID();
  const schedAt = hotelMoment(v.date ?? '', v.time ?? '') ?? undefined;
  runModuleCommand(MOD, 'scheduleTrip', { tripId, ...fields(v), date: v.date, time: v.time }, (sl, s) => withTrip(sl as TransportSlice | undefined, v, { id: tripId, status: 'scheduled', createdAt: s.now, schedAt }), [tripId]);
}
export const departTrip = (id: string) => runModuleCommand(MOD, 'departTrip', { tripId: id }, (sl, s) => withStep(id, 'en_route', s.now)(sl as TransportSlice | undefined), [id]);
export const arriveTrip = (id: string) => runModuleCommand(MOD, 'arriveTrip', { tripId: id }, (sl, s) => withStep(id, 'arrived', s.now)(sl as TransportSlice | undefined), [id]);
export const cancelTrip = (id: string) => runModuleCommand(MOD, 'cancelTrip', { tripId: id }, (sl, s) => withStep(id, 'cancelled', s.now)(sl as TransportSlice | undefined), [id]);
export const editTrip = (id: string, v: TripInput) => runModuleCommand(MOD, 'editTrip', { tripId: id, ...fields(v), date: v.date, time: v.time }, (sl) => withEdit(id, v)(sl as TransportSlice | undefined), [id]);
