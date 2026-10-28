import type { Q } from "../lib/db";
import { OPEN_STATUSES } from "./snapshot";

// What an owner or manager needs from a glance at the hotel, per property: is anything waiting, is
// anything late, is a work order open, is a safety incident live. Runs inside tx(orgId, ...), so row-level
// security keeps it to one hotel.

export interface PropertySummary {
  id: string;
  name: string;
  /** Guest requests not yet finished (including ones on hold). */
  open: number;
  /** Open requests past their target time. A request on hold has its clock stopped, so it is not late. */
  overdue: number;
  workOrders: number;
  incidents: number;
}

export async function loadSummary(q: Q): Promise<PropertySummary[]> {
  const r = await q(
    `select p.id, p.name,
            (select count(*) from items i where i.property_id = p.id and i.status = any($1::text[]))::int as open,
            (select count(*) from items i
              where i.property_id = p.id and i.status in ('new', 'relayed', 'on_site')
                and now() - i.created_at - i.held_ms * interval '1 millisecond' > i.sla_min * interval '1 minute')::int as overdue,
            (select count(*) from work_orders w where w.property_id = p.id and w.status <> 'done')::int as work_orders,
            (select count(*) from incidents x where x.property_id = p.id and x.status = 'active')::int as incidents
       from properties p
      order by p.name`,
    [OPEN_STATUSES],
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, open: x.open, overdue: x.overdue, workOrders: x.work_orders, incidents: x.incidents }));
}
