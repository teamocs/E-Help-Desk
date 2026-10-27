import type { Q } from "../lib/db";
import { DEPTS } from "../domain/rules";
import { PIN, hashPin, isWeakPin, verifyPin } from "./pin";

// Staff records and PIN sign-in. Every function runs inside a transaction with the org already set
// (tx(orgId, ...)), so row-level security keeps each call inside one hotel. The callers in
// src/app/app/staff.ts decide who may call what; nothing here trusts the browser.

export const STAFF_ROLES = ["hdo", "staff", "supervisor"] as const;

export interface StaffInput {
  name: string;
  title: string;
  role: string;
  dept: string | null;
}

export type Outcome<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const WRONG = "That name and PIN do not match.";
const WEAK = "Pick a PIN that is not a repeat or a straight run, like 1111 or 1234.";

export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

function problem(input: StaffInput): string | null {
  const name = input.name?.trim() ?? "";
  const title = input.title?.trim() ?? "";
  if (name.length < 1 || name.length > 80) return "Enter a name of up to 80 characters.";
  if (title.length < 1 || title.length > 60) return "Enter a job title of up to 60 characters.";
  if (!(STAFF_ROLES as readonly string[]).includes(input.role)) return "Pick a role.";
  if (input.dept !== null && !Object.hasOwn(DEPTS, input.dept)) return "Pick a department.";
  return null;
}

export async function createStaff(q: Q, orgId: string, input: StaffInput, pin: string): Promise<Outcome<{ id: string }>> {
  const bad = problem(input);
  if (bad) return fail(bad);
  if (!PIN.test(pin)) return fail("The PIN must be four digits.");
  if (isWeakPin(pin)) return fail(WEAK);
  const name = input.name.trim();
  const r = await q(
    `insert into staff (org_id, name, initials, role, title, dept, on_shift)
     values ($1, $2, $3, $4, $5, $6, true) returning id`,
    [orgId, name, initialsOf(name), input.role, input.title.trim(), input.dept],
  );
  const id = r.rows[0]!.id as string;
  await q("select set_staff_pin($1, $2)", [id, await hashPin(pin)]);
  return { ok: true, id };
}

export async function changePin(q: Q, staffId: string, pin: string): Promise<Outcome> {
  if (!PIN.test(pin)) return fail("The PIN must be four digits.");
  if (isWeakPin(pin)) return fail(WEAK);
  const found = await q("select 1 from staff where id = $1 and active", [staffId]);
  if (!found.rows[0]) return fail("Unknown person.");
  await q("select set_staff_pin($1, $2)", [staffId, await hashPin(pin)]);
  return { ok: true };
}

export async function deactivateStaff(q: Q, staffId: string): Promise<Outcome> {
  const r = await q("update staff set active = false, on_shift = false where id = $1 and active returning id", [staffId]);
  return r.rows[0] ? { ok: true } : fail("Unknown person.");
}

const lockedFor = (until: Date) => `Too many tries. Try again in ${Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000))} min.`;

/**
 * Checks a PIN for one staff member from a signed-in device account. Wrong name, wrong PIN, no PIN set and an
 * inactive person all give the same answer. Five failures lock the person (2, 4, 8 ... minutes); twenty
 * failures across anyone lock the device account for 15 minutes, which stops one PIN being sprayed across
 * everyone. pin_gate() holds row locks until the transaction ends, so parallel attempts are counted in turn.
 */
export async function checkPin(q: Q, staffId: string, userId: string, pin: string): Promise<Outcome> {
  if (!PIN.test(pin)) return fail(WRONG);
  const state = (await q("select pin_hash, staff_locked_until, user_locked_until from pin_gate($1, $2)", [staffId, userId])).rows[0];
  if (!state?.pin_hash) return fail(WRONG);
  for (const until of [state.user_locked_until, state.staff_locked_until]) {
    if (until && new Date(until).getTime() > Date.now()) return fail(lockedFor(new Date(until)));
  }
  const ok = await verifyPin(pin, state.pin_hash as string);
  await q("select pin_result($1, $2, $3)", [staffId, userId, ok]);
  return ok ? { ok: true } : fail(WRONG);
}
