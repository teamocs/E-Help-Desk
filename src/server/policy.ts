// Who may do what, by membership role. One place for the rules so they can be tested without a server.
//
// - owner:   everything, including inviting people.
// - manager: runs the desk and manages staff on their own account.
// - device:  a shared phone's own account. Opens the desk and runs staff PIN sign-in, nothing else. It cannot
//            manage staff or invite anyone, and every command must name a staff member who signed in with a PIN.

export type MemberRole = "owner" | "manager" | "device";

export const canManageStaff = (role: MemberRole) => role !== "device";
export const canInvite = (role: MemberRole) => role === "owner";
export const canLeave = (role: MemberRole) => role === "manager";

/** A device account may not act as itself: with no staff member signed in, its commands are refused. */
export const needsStaff = (role: MemberRole, actor: string | null) => role === "device" && actor === null;
