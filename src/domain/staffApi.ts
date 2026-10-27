import type { Outcome, StaffInput } from "../server/staff";

// The server calls the staff screens need, handed over by RemoteApp so the shared screens (Lock, Settings)
// never import server code. Empty in demo mode.

export interface StaffApi {
  signIn(staffId: string, pin: string): Promise<Outcome>;
  /** Back to the owner or manager account acting. */
  signOut(): Promise<void>;
  add(input: StaffInput, pin: string): Promise<Outcome<{ id: string }>>;
  setPin(staffId: string, pin: string): Promise<Outcome>;
  remove(staffId: string): Promise<Outcome>;
}

export const staffApi: { current: StaffApi | null } = { current: null };
