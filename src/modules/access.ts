// Who sees which module: the desk's copy of the server's role matrix (azalea-ehelpdesk/includes/Access.php).
// The server is the authority and refuses what this hides; the desk uses window.AZL.access when the plugin sends it
// and falls back to this copy (tests, the mock). A PHP test keeps the MATRIX and LABELS blocks equal to Access.php.
// Plain TypeScript with no imports: scripts/mock-wp.mjs loads this file directly.

export type Level = 'none' | 'read' | 'own' | 'full';
/** owner, manager, supervisor: the account's role. hdo, staff (and supervisor, manager): the PIN person on a shared phone. */
export type Kind = 'owner' | 'manager' | 'supervisor' | 'hdo' | 'staff';
export type Matrix = Record<string, Partial<Record<Kind, Level>>>;
export interface Who { kind: Kind | 'none'; dept?: string | null }

// BEGIN LABELS (equal to Azl_Access::LABELS)
export const LABELS: Record<string, string> = {"dashboard": "Dashboard", "requests": "Requests", "inquiries": "Inquiries", "cleaning": "Cleaning", "workorders": "Work Orders", "housestatus": "House Status", "crisis": "Crisis Mgmt", "transport": "Transport", "reminders": "Reminders", "reports": "Reports", "config": "Configuration"};
// END LABELS

// BEGIN MATRIX (equal to Azl_Access::MATRIX; docs/MODULES-SPEC.md B.3)
export const MATRIX: Matrix = {
  "dashboard": {"owner": "full", "manager": "full", "supervisor": "full", "hdo": "full", "staff": "none"},
  "requests": {"owner": "full", "manager": "full", "supervisor": "full", "hdo": "full", "staff": "own"},
  "inquiries": {"owner": "full", "manager": "full", "supervisor": "full", "hdo": "full", "staff": "none"},
  "cleaning": {"owner": "full", "manager": "full", "supervisor": "full", "hdo": "full", "staff": "own"},
  "workorders": {"owner": "full", "manager": "full", "supervisor": "full", "hdo": "full", "staff": "own"},
  "housestatus": {"owner": "full", "manager": "full", "supervisor": "full", "hdo": "full", "staff": "read"},
  "crisis": {"owner": "full", "manager": "full", "supervisor": "full", "hdo": "own", "staff": "own"},
  "transport": {"owner": "full", "manager": "full", "supervisor": "full", "hdo": "full", "staff": "own"},
  "reminders": {"owner": "full", "manager": "full", "supervisor": "full", "hdo": "own", "staff": "none"},
  "reports": {"owner": "full", "manager": "full", "supervisor": "read", "hdo": "none", "staff": "none"},
  "config": {"owner": "full", "manager": "full", "supervisor": "read", "hdo": "own", "staff": "own"}
};
// END MATRIX

/**
 * Commands a reader may still run (need 'report' on the server): B.3 "report only", so department staff whose
 * department does not handle repairs (Work Orders: read) can still report a work order.
 */
export const REPORT_COMMANDS: Record<string, string> = { reportWo: 'workorders' };

/** The refusal for a read-level actor, as Azl_Access::refusal words it; '' when a reader may run this command. */
export function readRefusal(module: string, type: string, label: string = LABELS[module] ?? module): string {
  if (REPORT_COMMANDS[type] === module) return '';
  return Object.values(REPORT_COMMANDS).includes(module)
    ? `You can report a new one in ${label}, but only the help desk or the team that handles it can change it.`
    : `Your role can only view ${label}.`;
}

/** The department whose staff run Cleaning (Azl_Access::CLEANING_DEPT). */
export const CLEANING_DEPT = 'housekeeping';

/** A staff member's job role on a shared phone, as an actor kind (Azl_Access::staff_kind). */
export function kindOfStaffRole(role: string | undefined): Kind | 'none' {
  if (role === 'hdo' || role === 'staff' || role === 'supervisor' || role === 'manager') return role;
  return role === 'owner' ? 'manager' : 'none';
}

/**
 * The level of one module for one actor, as Azl_Access::level(): department staff's "own" is Housekeeping only for
 * Cleaning, and full for a department that handles repairs in Work Orders (else read).
 */
export function levelOf(module: string, who: Who, matrix: Matrix = MATRIX, repairs: (dept: string) => boolean = () => false): Level {
  if (who.kind === 'none') return 'none';
  const level = matrix[module]?.[who.kind] ?? 'none';
  if (level !== 'own' || who.kind !== 'staff') return level;
  if (module === 'cleaning') return who.dept === CLEANING_DEPT ? 'full' : 'none';
  if (module === 'workorders') return who.dept && repairs(who.dept) ? 'full' : 'read';
  return level;
}
