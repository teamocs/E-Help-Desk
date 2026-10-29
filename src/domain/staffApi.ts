import type { Outcome, StaffInput } from "./contract";

// The server calls the staff and account screens need, handed over by WpApp so the shared screens (Lock, Settings,
// the user menu) never import server code. Empty until the desk is connected.

export interface Login {
  id: number;
  name: string;
  email: string;
  role: "owner" | "manager" | "supervisor" | "device";
  disabled: boolean;
  self?: boolean;
}

export interface StaffApi {
  signIn(staffId: string, pin: string): Promise<Outcome>;
  /** Back to the owner or manager account acting. */
  signOut(): Promise<void>;
  add(input: StaffInput, pin: string): Promise<Outcome<{ id: string }>>;
  setPin(staffId: string, pin: string): Promise<Outcome>;
  remove(staffId: string): Promise<Outcome>;
  /** Ends the WordPress session and goes to the sign-in page. */
  logout(): Promise<void>;
  /** The hotel owner's logins (people with their own email and password). */
  logins(): Promise<Outcome<{ accounts: Login[] }>>;
  addLogin(input: { name: string; email: string; role: "manager" | "supervisor" | "device" }): Promise<Outcome>;
  setLoginDisabled(id: number, disabled: boolean): Promise<Outcome>;
}

export const staffApi: { current: StaffApi | null } = { current: null };
