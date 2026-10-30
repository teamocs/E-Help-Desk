// The Requests commands of wave 2 as the desk sends them (azalea-ehelpdesk/includes/Commands.php validates each one
// again). The new types (editRequest, editItem, handOff, undoStep) belong to the Requests module on the server
// (includes/Modules/Requests.php); the extended ones (logRequest rows, transfer note) keep their old fields working.
// They go through remote.sendModule: the same outbox, a fresh opId each, so a resend never applies twice.

/** Target time of an "Other" item, from acknowledgement (Azl_Commands::OTHER_SLA_MIN). */
export const OTHER_SLA_MIN = 30;
export const QTY_MAX = 99;
export const NOTE_MAX = 191;
export const NAME_MAX = 120;
export const ROOM_MAX = 40;

/** One New Request row: a request type of the hotel's list, or "Other" (free text with a department). */
export interface NewRow {
  type?: string;
  other?: string;
  dept?: string;
  qty?: number;
  /** Staff id, someone of the item's department. */
  assignee?: string;
}

export type Source = 'guest' | 'staff_request';

export type RequestCommand =
  | {
      type: 'logRequest';
      requestId: string;
      itemIds: string[];
      room: string;
      presets?: string[];
      rows?: NewRow[];
      bundle?: string;
      remarks?: string;
      later?: boolean;
      vip?: boolean;
      source?: Source;
      staffName?: string;
      /** Only when someone else than the person logging is the HDO (the server defaults to the actor). */
      hdoId?: string;
    }
  | { type: 'completeRequest'; requestId: string; itemIds: string[]; presets?: string[]; rows?: NewRow[] }
  | { type: 'transfer'; itemId: string; newItemId: string; dept: string; note?: string; assignee?: string }
  | { type: 'editRequest'; requestId: string; room?: string; remarks?: string; vip?: boolean; source?: Source; staffName?: string; hdoId?: string }
  | { type: 'editItem'; itemId: string; name?: string; qty?: number; dept?: string; assignee?: string | null; remarks?: string }
  | { type: 'handOff'; itemId: string; newItemId: string; dept: string; name?: string; assignee?: string; note?: string }
  | { type: 'undoStep'; itemId: string };
