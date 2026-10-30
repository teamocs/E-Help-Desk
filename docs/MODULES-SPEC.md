---
title: Azalea e-Helpdesk: module specification (client prototype v8)
status: draft (AI-written, needs owner review)
source: docs/reference/client-prototype.html
screenshots: docs/reference/client-prototype/ (index.md lists all 84)
date: 2026-10-30
---

# Azalea e-Helpdesk: module specification

This document describes, precisely, what the client's ORIGINAL prototype does, so the WordPress desk can follow its navigation and modules. Part A is the prototype as it is (sidebar, the 11 modules, data model, components, style). Part B compares it with our desk and proposes the build. Part C lists questions for the client.

Source: `docs/reference/client-prototype.html` (a saved copy of the client's single-file prototype; 157 KB, of which about 41 KB is the hosting runtime of the page it was saved from and 116 KB is the app). All state is in the browser's `localStorage` under key `ehd8c`; a fresh browser starts from built-in sample data. It matches the "v8" baseline in `docs/azalea-ehelpdesk-build-brief.md` sections 2.1 to 2.10, with the differences noted in A.15.

Screenshot names below refer to `docs/reference/client-prototype/`.

Conventions in this document:
- "Required" means the prototype refuses to save and shows a toast. The prototype never highlights the field; it only shows the toast text given.
- Times: `ISO` = an ISO-8601 timestamp. `s` = seconds.
- "HD staff" = the help-desk officers list `HD` (see A.13).
- Every save, status change and toast re-renders all modules (one global render function `R()`).

---

# Part A: the prototype

## A.1 Layout and shell

- Left: fixed sidebar, 200 px wide, dark navy (`#162032`), full height, scrolls if needed.
- Right: main area. Top bar (white, sticky, 1 px bottom border) and the module content below with 12 px / 16 px padding.
- Right edge: a slide-in detail drawer (420 px, white, shadow), used only by Requests and Work Orders. Slides in with a 0.2 s transform.
- Centre: one modal at a time (max 600 px wide, max 90% of the viewport high, scrolls inside), over a 40% black backdrop. Clicking the backdrop or pressing Esc closes it.
- Bottom centre: toast.
- At widths of 768 px or less: the sidebar becomes a 44 px icon rail (brand shrinks to 8 px text, labels, badges and the footer are hidden); form grids become one column; the drawer becomes full width; request item rows stack (screenshots 83, 84).

Top bar contents, left to right:
1. Page title (13 px bold) and subtitle (10 px grey), from this table:

| Module key | Title | Subtitle |
|---|---|---|
| dashboard | Dashboard | Command center (note: never shown, the subtitle stays blank on first load until another module is opened and Dashboard re-opened) |
| requests | Requests | Service tickets |
| inquiries | Inquiries | Guest & external |
| cleaning | Cleaning | Room cleaning |
| workorders | Work Orders | Maintenance |
| housestatus | House Status | Incident logs |
| crisis | Crisis Management | Cases |
| transport | Transport Log | Vehicles |
| reminders | Reminders | Follow-ups |
| reports | Reports | View & export |
| config | Configuration | Settings |

Note: the top-bar title differs from the sidebar label for Crisis ("Crisis Management" vs "Crisis Mgmt") and Transport ("Transport Log" vs "Transport").

2. Right side: current date and time (e.g. "Fri, Oct 30, 2026 09:49 PM", 10 px grey), refreshed only on each render, then the user pill: rounded grey pill with a 6 px green dot and the name "Maui A." (hard-coded; there is no sign-in, no menu, no sign-out).

Keyboard (ignored while typing in a field):
- Esc: close the modal and the drawer.
- Alt+R: New Request. Alt+I: New Inquiry. Alt+M: New Reminder. Alt+C: Log Cleaning. (These work from any module.)

Double-tap guard: status actions (relay, on site, done, undo, start, resume, depart, arrive, clock in/out, note/done inquiry, done reminder, escalate, transfer, hand off) are ignored if another such action ran in the last 500 ms.

## A.2 Sidebar (exact)

Header: "Azalea Hotels" (white, 13 px bold) over "e-Helpdesk" (teal `#0d9488`, 9 px, semibold, letter-spaced). 14 px / 12 px padding, a faint bottom divider. No logo.

Items, in this order (each is a button: emoji icon in a 16 px column, label, optional badge pushed to the right):

| # | Label | Icon (emoji) | Badge | What the badge counts |
|---|---|---|---|---|
| 1 | Dashboard | 📊 (bar chart) | none | |
| 2 | Requests | 📋 (clipboard) | yes | request ITEMS (not tickets) whose status is new, relayed, on_site or on_hold |
| 3 | Inquiries | 💬 (speech balloon) | yes | inquiries with status active or noted |
| 4 | Cleaning | 🧹 (broom) | none | |
| 5 | Work Orders | 🔧 (wrench) | yes | work orders whose status is not done (includes scheduled) |
| 6 | House Status | 📝 (memo) | yes | house-status logs whose status is not closed |
| 7 | Crisis Mgmt | 🚨 (police light) | yes | crisis cases whose status is not resolved |
| 8 | Transport | 🚐 (minibus) | none | |
| 9 | Reminders | 🔔 (bell) | yes | reminders with status pending |
| 10 | Reports | 📈 (chart increasing) | none | |
| 11 | Configuration | ⚙️ (gear) | none | |

- No grouping or section headings: one flat list, 1 px gaps.
- Badge style: amber (`#f59e0b`) pill, white 9 px bold text. Badges are always shown, including "0" (see screenshot 01: Crisis Mgmt shows 0).
- Item style: 11 px, 60% white text; hover: background `#1e2d45`, 90% white text; active (current module): teal `#0d9488` background, white text, 5 px radius. Only one item is active. Dashboard is active on load.
- Footer (below a faint divider): a checkbox labelled "Supervisor". Ticking it re-renders but changes nothing visible (the code reads it once in the request drawer and never uses the value). See screenshot 02.
- There is no user area in the sidebar; the user pill is in the top bar.
- Roles: the prototype has no roles, sign-in or permissions. Every module and action is available to everyone. "Supervisor" is the only role hint.

## A.3 Module 1: Dashboard

Purpose: a single command-centre view of open work, service-level performance and quick actions.

Screenshots: 01, 02, 03, 77 (empty).

Layout, top to bottom:
1. Quick-action bar (4 large coloured buttons, each with its shortcut in faded text):
   - "+ New Request (Alt+R)" teal `#0d9488` → New Request modal (A.4.3).
   - "+ New Inquiry (Alt+I)" indigo `#6366f1` → New Inquiry modal.
   - "+ New Reminder (Alt+M)" amber `#f59e0b` → New Reminder modal.
   - "+ Log Cleaning (Alt+C)" green `#16a34a` → Log Cleaning modal.
2. Row of 4 stat cards:
   - "Open Tickets": number of pending items (new/relayed/on_site/on_hold), teal; sub-line "N items pending (a new, b relayed, c on site)". Click → Requests.
   - "Completed": items with status done, green; sub-line "of N items total". Click → sets the Requests filter to Done and opens Requests.
   - "Active Inquiries": inquiries not done, blue. Click → Inquiries.
   - "Avg Relay": average relay time of DONE items in minutes (one decimal) + "min"; sub-line "Within SLA" (green) if the average is 120 s or less, else "Above SLA" (red). Not clickable.
3. Row of 2 stat cards:
   - "Avg Completion": average completion time of done items, minutes; "Within SLA" if 360 s or less, else "Above SLA".
   - "Pending Reminders": count, amber.
4. Row of 2 SLA cards (centred):
   - "Relayed ≤ 2 min": percentage of done items with relay time ≤ 120 s; green if ≥ 80%, else red; "Target: 80%".
   - "Completed ≤ 6 min": percentage of done items with completion time ≤ 360 s; same colours; "Target: 80%".
5. Row of 3 clickable cards:
   - "🚨 Crisis Today": number of cases not resolved (red); sub-line "N today" = cases created today (any status). Click → Crisis Mgmt. (The label says "today" but the big number is all unresolved cases.)
   - "🚐 Transport": trips en route; sub-line "en route". Click → Transport.
   - "🔧 Work Orders": work orders not done; sub-line "pending". Click → Work Orders.
6. "Recent Tickets" card with a "View all" button (→ Requests). Table of the first 10 items (newest tickets first): Code, Room, Item, Qty, Dept, Source (badge), Status (badge), Created (date + time), Action. Row click → request drawer. Actions: new → Relay; relayed → On Site, Done; on_site → Done; others none.

Rules:
- SLA maths (prototype): relay time `rS` = seconds from ticket creation to relay; completion time `cS` = seconds from ticket creation to done (not from relay). Targets are global: relay 120 s, completion 360 s, 80% compliance. Averages and percentages use done items only.
- No date filter: all data ever stored.

Roles: no difference.

Empty state (77): all numbers 0, "Within SLA", both percentages 0% in red, an empty table.

## A.4 Module 2: Requests

Purpose: log guest or staff service requests for a room, each with one or more items routed to departments, and track every item from relay to done.

Screenshots: 04 to 21, 78 (empty).

### A.4.1 List

- Action bar: "+ New Request" (teal).
- Filter bar: "Filter:" tabs All / Active / Done; on the right "From" date, "To" date, and quick tabs Today / Week / All.
  - Active = item status new, relayed, on_site or on_hold.
  - Done = item status done OR transferred.
  - Intended behaviour: the date range filters on the ticket's creation date (inclusive). Today = today to today. Week = Monday of this week to today. All = clears both dates.
  - Actual behaviour (screenshot 07): the filter bar is rebuilt on every render, so the range is applied once from the old inputs and then the inputs show blank again; and dates are compared in UTC, so in the Philippines (UTC+8) "Today" selects yesterday's UTC date and hides today's tickets. See A.16.
- Table, ONE ROW PER ITEM (not per ticket). Columns: Code (`T-0001-1` = ticket number + item position), Room, Item, Qty, Dept, Staff (assignee or "—"), Status (badge), Relay (relay time), Resp (on-site time), Res (completion time), Action. Times print as "Xm Ys" or "—".
- Row click → request drawer for that ticket.
- Row actions by item status:
  - new: Relay.
  - relayed: On Site, Done.
  - on_site: Hold, Done.
  - on_hold: Undo, Resume.
  - done: Undo.
  - transferred: Undo.
  - escalated: none.
- Order: newest ticket first, items in position order.

### A.4.2 Request drawer (detail)

Title: "T-0001 — Room 412".

Section "Ticket" with an "Edit" button: Ticket, Room, Source (badge, plus " — staff name" for staff requests), HDO, Created, Status (ticket status, see rules). Remarks shown in a grey box with 💬. If the ticket was edited, a scrolling list of changes ("time · by: Room: 412 → 414, …"). Screenshot 18.

Section "Items (N)": one card per item:
- Top line: item code (grey), item name with "×qty" if qty > 1, status badge.
- If transferred in or handed off: indigo line "↳ T-0004-1 (HK)" or "↳ Follow-up from T-0003-1 (Engineering)", plus " — reason" when given.
- Meta line: 📁 dept, 👤 assignee, 📤 relayed by, ⏱ relay time, 📍 on-site time, ✅ completion time (each only when set), and when escalated a teal link tag "🔗 WO-0005 (reported)" that opens Work Orders and the WO drawer.
- Hold reason strip (amber): "⏸ reason".
- Item edit history (small, scrolling): "✏ time · by: Item: … → …".
- Actions (only when the item is NOT transferred and NOT escalated):
  - always: Edit.
  - new: Relay.
  - relayed: Undo, On Site, Done, Transfer.
  - on_site: Undo, Hold, Done, Transfer.
  - on_hold: Undo, Resume.
  - done: Undo, Hand Off.
  - plus "→ WO" (red, small) when the item has no WO link, status is on_site or on_hold, and dept is exactly "Engineering" or "IT".
- Transferred and escalated cards are shown at 50% opacity with a purple left border and NO buttons (so the Undo for these two states, although coded, cannot be reached from the drawer; see A.15).
- Inline Transfer form (indigo box under the item): Dept select ("Dept…" + all departments), Staff select (refills with that department's staff, default "—"), Reason text, OK, ✕. Screenshot 10.
- Inline Hand Off form (green box): "HAND OFF:" Dept select, Item select ("(Same)" + that department's items), Staff select, OK, ✕. Screenshot 11.
- Footer: "Close".

### A.4.3 New Request modal (screenshots 19 to 21)

Fields:
- Source: select, "Guest Request" (value guest, default) or "Staff Request" (staff_request).
- Room: text, placeholder "412". Required ("Room required").
- Staff Name (Last, First): text, placeholder "Dela Cruz, Maria"; shown only when Source = Staff Request; then required ("Staff name required").
- ITEMS: one or more item rows, each labelled "Item N":
  - Item (type to search): text with a dropdown of all service items across all departments ("Extra Towels — Housekeeping"), filtered by substring as you type, last entry "Other (not listed)". Picking an item fills Dept and clears the assignee.
  - Dept: read-only grey field showing the item's department; when the item is "Other", a Dept select ("Select…" + departments) plus a "Describe…" text field.
  - Qty: number, min 1, default 1.
  - Assign: select of that department's staff ("—" + names); disabled until a department is known.
  - × remove button (only when there is more than one row).
- "+ Add item" link adds a row.
- Remarks: textarea, 2 rows, optional.
- Buttons: Cancel, Create.

Validation and result:
- At least one valid row: a department and either a listed item or an "Other" description. Rows that are not valid are silently dropped. None valid → toast "Add item".
- Creates ticket `T-NNNN` (4 digits, from a counter), HDO = "Maui A." (the current user; not selectable here), created now, every item status new, relayed-by "Maui A.". Toast shows the ticket number.

### A.4.4 Other request modals

- Edit ticket (14): Room (text), Source (select), Staff Name (shown for staff requests), HDO (select of HD staff), Remarks. Save logs a change entry for Room, Source and HDO changes only.
- Edit item (15): Dept (select; changing it refills Item and Assigned), Item (that department's items + "Other (not listed)"), Describe (when Other), Qty (number, min 1), Assigned (select), Relayed by (select of HD staff). Save logs changes to item, qty, dept, staff and relayed-by.
- Hold item (16): "Reason for hold" textarea, placeholder "e.g. Waiting for parts, guest not in room…". Required ("Reason required"). Button "Hold" (amber).

### A.4.5 Item statuses and transitions

Statuses: `new`, `relayed`, `on_site`, `on_hold`, `done`, `transferred`, `escalated`.

| From | Action | To | Side effects |
|---|---|---|---|
| new | Relay | relayed | ra = now; rS = seconds since ticket creation |
| relayed | On Site | on_site | os = now; oS = seconds since relay |
| relayed / on_site | Done | done | cAt = now; cS = seconds since ticket creation; checkout rule (below) |
| on_site | Hold (reason) | on_hold | holdReason saved |
| on_hold | Resume | on_site | holdReason cleared |
| relayed / on_site | Transfer (dept, staff, reason) | transferred | a NEW item is added to the same ticket: same name and qty, new dept and staff, status new, xFrom "T-0001-1 (Housekeeping) — reason" |
| done | Hand Off (dept, item, staff) | stays done | a NEW item (chosen item or the same name) is added with status new, xFrom "Follow-up from T-0001-1 (dept)" |
| on_site / on_hold, dept Engineering or IT | → WO | escalated | creates a work order (A.7.6); item gets woLink and remembers its previous status |
| done | Undo | on_site if it had an on-site time, else relayed | completion cleared |
| on_hold | Undo | on_site | reason cleared |
| on_site | Undo | relayed | on-site time cleared |
| relayed | Undo | new | relay time cleared |
| transferred | Undo | on_site or relayed | the item created by the transfer is deleted |
| escalated | Undo (code only) | previous status | the linked work order is deleted |
| escalated | its WO is completed | done | cAt = now, cS from ticket creation |

Ticket status (shown in the drawer, derived): ignore transferred items; if none left or all done → done; if all new → new; otherwise in_progress.

Auto rule (checkout → cleaning ready): when an item whose name contains "checkout" or "check out" (any case) is marked Done, the first cleaning task for the same room in status scheduled or queued becomes `ready` with checkout time = now. (Only the Front Office item "Checkout" matches in the sample data.)

Roles: no difference. Timers do not pause on hold.

Sample data (5 tickets, 8 items, all created today): T-0001 Room 412 guest, remarks "Guest urgent": Extra Towels ×3 (Housekeeping, Aljun, on_site), Mini-bar Restock (F&B, Chef Bong, relayed). T-0002 Room 305: AC Not Cooling (Engineering, Engr. Santos, on_site). T-0003 Room 218 staff request "Lynette, HK", remarks "HK found broken TV": TV / Remote Issue (Engineering, done). T-0004 Room 501: Clogged Drain (Housekeeping, transferred) and Clogged Drain (Engineering, relayed, "↳ T-0004-1 (HK)"). T-0005 Room 310: Extra Pillows ×2 and Bathroom Amenities (Housekeeping, done).

Empty state (78): filter bar and an empty table header, no message.

## A.5 Module 3: Inquiries

Purpose: log questions from in-house guests, outside callers and checked-out guests, and close them quickly.

Screenshots: 22 to 25.

List:
- Action bar: "+ New Inquiry".
- Filter bar: All / Active / Done, From / To, Today / Week / All (same behaviour as Requests; Active = not done).
- Table: No (`I-0001`), Type (badge: in_house, external, checked_out), Name, Room, Description, HDO, Status (badge; plus a small green "≤6m" when it was closed within 6 minutes), Created (time only), Action.
- No row click, no detail view, no edit.
- Actions: active → Note, Done; noted → Undo, Done; done → Undo.

New Inquiry modal (25): Type (select: In-house Guest / External / Checked-out; default In-house Guest), Name (text, required), Room (text; "—" when blank), HDO (select of HD staff, default first), Description (textarea, required). Missing name or description → toast "Required". Button "Submit". Creates status active.

Statuses: `active` → Note → `noted`; active or noted → Done → `done` (clA = now; cl6 = true if closed within 360 s of creation). Undo: done → active (clears close time and cl6); noted → active.

Sample data (5): I-0001 Mr. Santos, in_house, 412, "Late checkout", active. I-0002 Maria Cruz, external, "Reservation Dec 20-23", active. I-0003 James Lee, checked_out, 301, "Left charger", noted. I-0004 Room 412, in_house, "WiFi password", done ≤6m. I-0005 Anna Reyes, external, "Wedding venue", done ≤6m.

Empty state: table header only.

## A.6 Module 4: Cleaning

Purpose: track room cleaning tasks, schedule checkout cleans and time each clean by clocking in and out.

Screenshots: 26 to 31.

List:
- Action bar: "+ Log Cleaning" (teal), "Schedule Rooms" (outline).
- Filter: All / Ready / In Progress / Done (no Scheduled or Queued tab; no date filter).
- Table: Room (bold), Type, RA (room attendant, or "—"), Status (badge), Sched (scheduled date or "—"), Clock In (time), Clock Out (time), Duration ("27m"), Action.
- Actions: ready or queued → Clock In; in_progress → Clock Out; scheduled and done → none.

Log Cleaning modal (30): Room (text, required "Room required"), Type (select: Regular, Checkout, Deep Clean, Touch-up, Pre-arrival, VIP Setup, Turndown), RA (select: Aljun, Lynette; hard-coded), Role (select: Lead, Backup), "Clock In now" checkbox (ticked by default). Button "Add". Ticked → status in_progress with clock-in now (toast "Clocked in"); unticked → status queued (toast "Queued").

Schedule Rooms modal (31): Checkout Date (date, default tomorrow, required "Date required"), Type (Checkout or Deep Clean), ROOMS: one text row per room with × to remove and "+ Add room". At least one room ("Add rooms"). Button "Schedule". Creates one task per room: status scheduled, no RA, role Lead, sched date set. Toast "N scheduled".

Statuses and transitions:
- `scheduled` → `ready` (only through the checkout auto rule in A.4.5).
- `queued` → `ready` (through the same rule) or → Clock In.
- `ready` or `queued` → Clock In → `in_progress` (ci = now; if no RA, RA becomes "Aljun").
- `in_progress` → Clock Out → `done` (co = now; duration = whole minutes between clock in and out; toast shows "27m").
- No undo, no edit, no delete, no way to mark a scheduled room ready by hand.

Sample data (5): 201 Regular Aljun done 27m; 202 Checkout Lynette done 45m; 301 Deep Clean Aljun in_progress; 305 Checkout Lynette ready; 408 Checkout unassigned scheduled for tomorrow.

## A.7 Module 5: Work Orders

Purpose: the full maintenance lifecycle: report, assess (in-house or contractor, target dates, estimated cost), execute (start, progress updates, hold, deadline extension, outsource mid-job), complete with actual cost, reopen; each with an audit trail.

Screenshots: 32 to 48, 79 (empty).

### A.7.1 List

- Action bar: "+ Report Work Order".
- Filter: All / Reported / Assessed / In Progress / On Hold / Done (no Scheduled tab even though the status exists; no date filter).
- Table: WO# (`WO-0001`), Area, Location, Description (one line, ellipsis, max 160 px), Pri (badge: low green, medium amber, high/urgent red), Dept, Assigned (staff name, or indigo "⬡ contractor" when outsourced), Reporter (name + "(dept)" in grey), Deadline (target end date if set, else requested date; red and "⚠" when the REQUESTED date is past and the WO is not done), Status (badge), Action.
- Row click → WO drawer.
- Actions: reported → Assess; assessed → Start; in_progress → Hold, Complete; on_hold → Resume; done → Reopen; scheduled → Open.

### A.7.2 Report Work Order modal (38)

Fields: Area (select from AREAS), Location (text, placeholder "Room 305, Lobby…"), Problem / Description (textarea, required "Description required"), Priority (Low / Medium (default) / High / Urgent), Assign to Dept (select of departments). Section "REPORTED BY": Reporter Dept (select of departments; changing it refills Reporter Name), Reporter Name (select "Select…" + that department's staff), Encoded by (HDO) (select of HD staff), "Requested completion *" (date, required "Date required"). Button "Submit". Creates status reported, audit "Reported by NAME (DEPT)" by the encoder. Toast shows the WO number.

### A.7.3 WO drawer (39, 46, 47, 48)

Title "WO-0001 — Room 305".
- "Work Order" grid: WO#, Status, Area, Location, Priority, Dept, Assigned (or "Outsourced — contractor" in indigo), Reporter (name (dept)), Encoded, Requested (date; red + ⚠ when past and not done). Description in a grey box.
- "Assessment" (if any): findings in an indigo box; By, Date, Target start → end.
- Cost box (green, if an estimate or actual exists): Estimated ₱ / Actual ₱ (thousands separators).
- "Actual" (if started): Started, Completed.
- "Updates (N)": "time · by: text", including system lines: "📅 Deadline: old → new — reason", "→ Outsourced: contractor", "⏸ hold reason", "✅ completion notes".
- "Audit Trail": time, by, action (scrolls at 120 px).
- Buttons: Edit (always); reported → Assess; assessed → Start; in_progress → + Update, Hold, Complete; on_hold → + Update, Resume; done → Reopen; then Close.

### A.7.4 WO modals

- Assess (40, 41): summary line "WO-0003 — description". Assessment / Findings (textarea, required "Assessment required"), Assignment (In-house / Outsource), Assign to (that department's staff; shown for In-house) or Contractor (text; shown for Outsource), Assessed by (select of that department's staff), TARGET: Start date, End date (dates), Est. cost (₱) (number). Indigo "Submit". Sets status assessed, assessed_at = now, audit "Assessed".
- Update (42): Progress update (textarea, required "Required"), By (that department's staff + HD staff). Checkbox "Extend deadline" reveals Current (read-only: target end, else requested date), New deadline (date, required "New deadline required" when ticked), Reason (text, placeholder "Parts delayed…"). Checkbox "Transfer to Outsource" (only when not already outsourced) reveals Contractor (required "Contractor required") and Est. cost (₱). Save adds the update, and for each ticked box a system update line and an audit entry ("Deadline extended: old → new", "Outsourced: contractor"); outsourcing clears the assignee.
- Complete (43): Completion notes (optional), Actual cost (₱) (pre-filled with the estimate), By (department staff). Green "Complete". Sets done, actual end = now, completion time, audit "Completed"; if the WO came from a request item, that item becomes done.
- Hold (44): Reason (required "Reason required"). Amber "Hold". Adds "⏸ reason" update and audit "On Hold: reason".
- Edit (45): Area, Location, Description, Priority, Dept, Assigned (free text; edits the contractor when outsourced), Requested date, and a read-only AUDIT TRAIL. Audit "Edited".

### A.7.5 Statuses and transitions

`reported` → Assess → `assessed` → Start → `in_progress` (actual start = now) ⇄ Hold / Resume ⇄ `on_hold`; `in_progress` → Complete → `done`; `done` → Reopen → `assessed` (clears completion, actual end, actual cost). `scheduled` (preventive, sample only; no form creates it) → Open → `reported`. Every transition writes an audit line (by "Maui A." unless a person was chosen).

### A.7.6 Escalation from a request item

"→ WO" on an Engineering/IT item creates: area Room, location "Room NNN", description = item name (+ " — hold reason"), priority medium, same dept and assignee, reporter dept "Helpdesk", reporter = ticket HDO, encoded by Maui A., no requested date, in-house, status reported, srcTicket/srcItem set, audit "Escalated from T-0002-1 (Room 305)". Toast "Created WO-0005".

Sample data (4): WO-0001 Room 305 AC compressor, high, outsourced to CoolAir HVAC, in_progress, est ₱15,000, one update. WO-0002 Lobby restroom faucet leak, medium, in-house, done, est ₱500 / actual ₱450. WO-0003 Room 412 exhaust fan noise, low, reported. WO-0004 Staff quarters 2F exhaust fan, preventive, scheduled.

Empty state (79): table header only.

## A.8 Module 6: House Status

Purpose: a running log of building-wide conditions (water pressure, outages) with timed updates until closed.

Screenshots: 49 to 54, 80 (empty).

List: action bar "+ New Log"; then one card per log, newest first (no filter, no table). Card: number (`HS-0001`), status badge, created date-time on the right; narration; "By name"; every update as a grey row "time · by: text"; buttons. Left border colour: amber = pending, blue = monitoring, green + 70% opacity = closed.

Buttons: not closed → + Update, Close, Edit; closed → Edit, Reopen.

Forms:
- New House Status (50): Incident Narration (textarea, required "Required"), Logged by (HD staff), Status (Monitoring / Pending). Button "Log".
- Update (51): Update (textarea, required), By (HD staff).
- Close Log (52): Closing note (optional; added as "✅ note"). Green "Close". Status closed.
- Edit (53): Narration, Status (Monitoring / Pending / Closed).
- Reopen: status monitoring, update "⟲ Reopened".

Statuses: `monitoring`, `pending`, `closed`. Any → any through Edit.

Sample data: HS-0001 "Water pressure low 3rd floor since 8 AM", monitoring, two updates.

Empty state (80): only the "+ New Log" button.

## A.9 Module 7: Crisis Mgmt

Purpose: log crisis and complaint cases by radio code, follow them with updates and monitoring, and close them with a resolution.

Screenshots: 55 to 63, 81 (empty).

List: action bar "+ New Case" (red). Cards, newest first (no filter). Card: number (`CR-0001`), code in red ("10-9 Medical Emergency"), complaint category in amber (10-28 only), status badge, created date-time; "Reported: name"; "Who: name (type) Where: place"; "What: text"; updates; "Resolution: text" in green when closed. Left border: red = active, blue = monitoring, green faded = resolved.

Buttons: active → + Update, Monitor, Close, Edit; monitoring → + Update, Close, Edit; resolved → Edit, Reopen.

New Crisis Case (56, 57):
- Crisis Code: select of 11 codes (see A.13), default first (10-9 Medical Emergency).
- Complaint Category: select of COMP_CATS, shown only for code 10-28.
- Reported by: text.
- Involved (type): select of WHO_T.
- Involved (name): text.
- Where: select of CR_LOCS (first option "— Not specified —"); "Room" reveals "Room No." (text, stored as "Room 405"); "Other" reveals "Specify" (text).
- What happened: textarea, REQUIRED (toast "Required").
- Button "Log Case" (red). Creates status active, case_st pending, when = now.

Other forms: Update (text required, By HD staff); Monitor (59/60: "Monitoring note" required; status monitoring; update "→ note"); Close Case (62: "Final resolution *" required; status resolved, case_st closed, update "✅ resolution"); Edit (63: same fields as create, labels "Code", "Category", "Involved", "Room", "What"); Reopen (status monitoring, case_st pending, update "⟲ Reopened").

Statuses: `status` active → monitoring → resolved (active can go straight to resolved), resolved → Reopen → monitoring. `case_st` pending/closed follows it. No "call 911 first" banner, no alerting, no sound.

Sample data: CR-0001 10-9 Medical Emergency, Mr. Park, Room 405 (In-house Guest), Lobby, "Guest fainted in lobby", resolved, resolution "Guest released from hospital".

Empty state (81): only the "+ New Case" button.

## A.10 Module 8: Transport

Purpose: log hotel vehicle trips (departures, arrivals, scheduled pickups).

Screenshots: 64 to 69.

List: action bar "+ Log Trip", "Schedule Trip". Filter All / Scheduled / En Route / Arrived. Table: No (`TR-0001`), Vehicle, Driver, Destination, Purpose, Passengers, Departed (time; for scheduled trips the scheduled "date time"), Arrived (time), Status (badge), Action (scheduled → Depart; en_route → Arrived).

Forms (68, 69): Vehicle (select of VEH), Driver (text), Destination (text, required "Destination required"), Purpose (text), Passengers (text). Schedule Trip adds Date (default tomorrow) and Time (default 08:00). Buttons "Depart" (creates en_route, departed now) or "Schedule" (creates scheduled).

Statuses: `scheduled` → Depart → `en_route` (dep = now) → Arrived → `arrived` (arr = now). No edit, cancel or undo.

Sample data (3): TR-0001 Van 1, Danny, Caticlan Airport, Guest pickup, Mr. & Mrs. Lee, arrived. TR-0002 Van 2, Jun, D'Mall, Guest transfer, Room 412, en_route. TR-0003 Shuttle, Danny, Airport, VIP pickup, scheduled tomorrow 14:00.

## A.11 Module 9: Reminders

Purpose: follow-up reminders for help-desk staff, optionally linked to a ticket, work order, house-status log or crisis case.

Screenshots: 70 to 73, 82 (empty).

List: action bar "+ New Reminder". Filter All / Pending / Completed. Card grid (min 240 px columns). Card: description (bold), status badge; 👤 assignee, ⏰ scheduled date-time with red "OVERDUE" when pending and past; link tag "🔗 req:T-0002" (the raw stored value; not clickable); notes; "Done" button when pending. Left border: red = overdue, amber = pending, green faded = completed.

New Reminder (73): Description (text, required "Required"), Assigned (select: "All HD Staff" (default) + HD staff), Scheduled (date-time, optional), Link to (select: "— None —", every ticket "T-0001 Room 412", every WO "WO-0001 first 25 chars", every house log, every crisis case "CR-0001 code"), Notes (textarea). Button "Create".

Statuses: `pending` → Done → `completed` (cA = now). No undo, no edit, no alert when due.

Sample data (4): "Follow up Engineering — 305 AC" Rizza S. 09:00 linked req:T-0002 (overdue); "Call James Lee — charger" Maui A. 10:00; "VIP Room 501" Maui A. 14:00; "Pool check" Aljun completed.

## A.12 Modules 10 and 11: Reports and Configuration

Reports (74, 75): grid of six tiles (category, title, one line). Clicking any tile only shows the toast "Coming soon". No data, no export.

| Category | Title | Line |
|---|---|---|
| SERVICE | Response Time | Distribution & avg times |
| SERVICE | KPI Dashboard | 5-min compliance rate |
| CLEANING | Room Turnaround | Duration by RA & type |
| WORK ORDER | WO Summary | By status, cost, department |
| INQUIRY | Inquiry Volume | Daily trends & types |
| OPERATIONS | Crisis Log | Incident history |

Configuration (76): read-only sections, nothing is editable:
- "Hotel Profile": text "Property name, rooms, departments" only (placeholder).
- "Departments & Staff": each department with its staff as chips.
- "Service Items": each department with its items as chips.
- "Crisis Codes": chips "10-9 Medical Emergency" etc.
- "Vehicles": Van 1, Van 2, Shuttle.
Not shown although they exist in code: HD staff, Areas, Complaint categories, Crisis locations, Involved types, Cleaning types, RA list.

## A.13 Data model (as the prototype implies, for WordPress tables)

Entities (prototype field → meaning):

- Request (ticket): id, tn ticket no `T-NNNN`, rm room, src guest | staff_request, staff_name ("Last, First", staff requests), hdo (HD staff name), ca created ISO, rk remarks, items[], edits[] {changes[], by, at}.
- Request item: id (position within ticket), item name, qty, dept, as assignee name, rb relayed-by (HD staff), st status, ra relayed ISO, os on-site ISO, cAt done ISO, rS/oS/cS seconds, xFrom text, holdReason text, woLink WO number, stBeforeEsc, edits[].
- Inquiry: id, no `I-NNNN`, cn contact name, ct in_house | external | checked_out, rm, desc, hdo, st active | noted | done, ca, clA closed ISO, cl6 closed within 6 min.
- Cleaning task: id, rm, ty type, ra attendant, ro Lead | Backup, sd scheduled date, cot checkout ISO, ci clock-in ISO, co clock-out ISO, dur minutes, st scheduled | queued | ready | in_progress | done.
- Work order: id, no `WO-NNNN`, area, loc, desc, pri low | medium | high | urgent, dept, as, reporter_dept, reported_by, encoded_by, requested_date, assign_type inhouse | outsource, contractor, assessment, assessed_by, assessed_at, target_start, target_end, est_cost, actual_start, actual_end, actual_cost, st reported | assessed | scheduled | in_progress | on_hold | done, ca, cAt, holdReason, schedDate, srcTicket, srcItem, updates[] {text, by, at}, audit[] {act, by, at}.
- House status log: id, no `HS-NNNN`, narration, status monitoring | pending | closed, logged_by, ca, updates[].
- Crisis case: id, no `CR-NNNN`, code (stored as label "10-9 Medical Emergency"), comp_cat, reported_by, who_type, who, what, when, where (text), status active | monitoring | resolved, case_st pending | closed, ca, updates[], resolution.
- Trip: id, no `TR-NNNN`, vehicle, driver, dest, purpose, passengers, dep, arr, st scheduled | en_route | arrived, schedDate, schedTime.
- Reminder: id, desc, as (name or "All HD Staff"), sa scheduled ISO, notes, st pending | completed, ca, cA, link ("req:T-0002", "wo:WO-0001", "hs:HS-0001", "cr:CR-0001").
- Counters: nR, nI, nW, nH, nCr, nTr (next number per series).

Relations: request 1-n items; item 0-1 work order (escalation, both directions); item → item (transfer and hand-off via xFrom text); reminder → any one of request, WO, house log, crisis case; staff referenced by NAME everywhere (no ids).

Ticket and record types: Request (Guest Request / Staff Request), Inquiry (In-house Guest / External / Checked-out), Cleaning task, Work order (reported or escalated, in-house or outsourced), House status log, Crisis case (by code), Trip (logged or scheduled), Reminder.

Configuration lists (hard-coded in the prototype):

| List | Values |
|---|---|
| Departments and service items (DI) | Housekeeping: Extra Towels, Extra Pillows, Bathroom Amenities, Room Cleaning, Iron & Board, Crib / Rollaway, Bed Sheets. Engineering: AC Not Cooling, Plumbing Issue, Light Bulb Replace, TV / Remote Issue, Clogged Drain. F&B: Mini-bar Restock, Room Service Order. IT: IT Maintenance, WiFi Issue. Front Office: Luggage Assistance, Wake-up Call, Checkout. Security: Security Escort. |
| Department staff (DS) | Housekeeping: Aljun, Lynette. Engineering: Engr. Santos, Engr. Reyes. F&B: Chef Bong, Jay. IT: Marco. Front Office: FO Staff 1, FO Staff 2. Security: Guard 1. |
| HD staff (HD) | Maui A., Rizza S., Mary R., Frankie D., Jennifer D. |
| Areas | Room, Public Area, Office, Staff House, Function Room, Basement Parking, Drivers Quarters, Other |
| Crisis codes (CC) | 10-9 Medical Emergency, 10-28 Guest Complaint, 10-1 Fire, 10-2 Earthquake, 10-3 Typhoon, 10-4 Bomb Threat, 10-5 Power Outage, 10-6 Water Interruption, 10-7 Security Threat, 10-8 Civil Disturbance, 10-0 Other |
| Complaint categories | Room Condition, Noise, Cleanliness, Food Quality, Service Attitude, Billing, Amenities, AC / Temperature, WiFi / Internet, Wait Time, Other |
| Crisis locations | (not specified), Room, Lobby, Restaurant, Pool Area, Gym / Fitness Center, Parking Area, Elevator, Hallway / Corridor, Reception / Front Desk, Back Office, Kitchen, Laundry, Staff Area, Function Room, Garden / Outdoor, Other |
| Involved types | In-house Guest, Non-guest, Restaurant Guest, Supplier, Staff |
| Vehicles | Van 1, Van 2, Shuttle |
| Cleaning types | Regular, Checkout, Deep Clean, Touch-up, Pre-arrival, VIP Setup, Turndown |
| Room attendants | Aljun, Lynette (hard-coded in the form, separate from DS) |
| Cleaning roles | Lead, Backup |
| WO priorities | Low, Medium, High, Urgent |
| Service levels | Relay ≤ 120 s, completion ≤ 360 s, target 80%; inquiry closed ≤ 360 s flag |

Not present in the prototype: rooms list, shifts, SLA per item, reminder types, transport types, drivers list.

## A.14 Components inventory

- Modal: header (title + ×), body (two-column field grid; full-width fields span both), footer (Cancel outline + primary). Primary colour varies by meaning: teal default, indigo Assess, green Complete/Close, amber Hold, red Log Case, blue Monitor.
- Detail drawer: right side, sticky header with title and ×, sections with small uppercase headings.
- Toast: navy pill, bottom centre, "✓ text", 2.5 s, also used for validation messages (so errors also show a ✓).
- Status badge: small rounded pill, text = status with underscores as spaces. Colours: blue (new, reported, queued), amber (relayed, in_progress, open, monitoring, ready, on_hold, en_route, medium), magenta (on_site), green (done, completed, closed, resolved, arrived, low), indigo (transferred, noted, assessed, escalated, staff_request), teal (active, guest), violet (pending, scheduled), red (overdue, high, urgent).
- Action chips (small buttons in tables and cards): Relay amber, On Site magenta, Done green, Undo red, Note/Assess indigo, Transfer blue, Edit grey, Hold amber.
- Buttons: primary teal (`.bp`), outline (`.bo`).
- Tabs / filter chips: segmented group, active = teal.
- Filter bar with date range and Today / Week / All.
- Stat card (label, big number, coloured sub-line), clickable variant; SLA card (centred percentage + target).
- Log card with coloured left border (house status, crisis); reminder card; report tile; config chip.
- Inline forms inside the drawer (transfer, hand-off).
- Searchable item picker (type-ahead dropdown with "Other").
- Repeating rows (request items, schedule rooms) with "+ Add" and ×.
- Link tag (teal), audit row, update row, cost box (green), hold strip (amber).
- Timers: static "Xm Ys" values computed at each step (no live ticking clocks).
- Not present: banners, toggles (other than the Supervisor checkbox and form checkboxes), print views, export, sounds, notifications, confirmation dialogs.

## A.15 Visual style tokens

- Font: Arial, Helvetica, sans-serif. Base 11 px. Headings 13 px bold; table header 9 px uppercase grey; badges 9 px.
- Colours (CSS variables): nav `#162032`, nav hover `#1e2d45`, accent/teal `#0d9488` (hover `#0f766e`), teal light `#ccfbf1`, background `#f3f5f8`, surface `#ffffff`, border `#e5e7eb`, text `#1e293b`, text 2 `#64748b`, text 3 `#94a3b8`, amber `#f59e0b` / `#fef3c7`, red `#ef4444` / `#fee2e2`, green `#16a34a` / `#dcfce7`, blue `#3b82f6` / `#dbeafe`; extra: indigo `#4338ca` / `#e0e7ff`, violet `#6d28d9` / `#f5f3ff`, magenta `#a21caf` / `#fae8ff`, quick-action indigo `#6366f1`.
- Radii: cards 7 px, buttons 5 px, badges 8 px, modal 10 px. Light theme only; dense, desktop-first.

## A.16 Prototype defects and ambiguities (do not copy blindly)

1. Undo on transferred or escalated items is coded but not reachable in the drawer; escalated items have no Undo in the list either.
2. The Supervisor checkbox does nothing.
3. Work order "scheduled" status cannot be created by any form and has no filter tab.
4. WO overdue flag compares the original requested date, even after the deadline was extended.
5. "Crisis Today" shows all unresolved cases, not today's.
6. Completion time is measured from ticket creation, not from relay (the brief, section 2.11, asks for two clocks).
7. Date filters are rebuilt on every render and lose their value, and all date logic ("Today", "Week", "Crisis Today", scheduled dates) uses UTC dates, which is wrong for UTC+8: before 8 AM local time "today" is yesterday, and the Today filter shows nothing for the current day (screenshot 07).
8. Validation errors appear as a "✓" toast.
9. People are stored by name; renaming a person breaks history; HDO is always "Maui A.".
10. Escalation is hard-wired to the department NAMES "Engineering" and "IT"; the checkout rule matches the item NAME text.
11. Versus the brief: the brief mentions a `REPS` list, "checkout or inspection" for the cleaning rule, and 14 stub reports; this copy has no REPS, matches "checkout"/"check out" only, and has 6 report tiles.
12. No roles, sign-in, persistence beyond one browser, alerts or media.

---

# Part B: gap analysis against our desk

Our desk today: React desk `src/App.tsx` with 6 sidebar items (Requests, Work orders, Housekeeping, Handover, Insights, Settings), screens in `src/screens/`, domain in `src/domain/`, WordPress plugin `azalea-ehelpdesk/` (tables `azl_staff`, `azl_requests`, `azl_items`, `azl_work_orders`, `azl_clean_tasks`, `azl_incidents`, `azl_handovers`, `azl_events`, `azl_seq`; commands in `includes/Commands.php`; editable lists in `includes/Catalog.php`: departments, requestTypes, bundles, holdReasons, jobTitles, woFindings; roles in `includes/Caps.php`: Hotel Owner, Manager, Supervisor, Shared phone).

## B.1 Module by module

| Prototype module | Our equivalent (file) | Already equivalent | Missing | Different | Mark |
|---|---|---|---|---|---|
| Dashboard | none (parts in `src/screens/Insights.tsx`, `Handover.tsx`) | open, overdue, on-hold counts; WO open count | quick-action bar (New Request / Inquiry / Reminder / Log Cleaning), Avg Relay / Avg Completion cards, Relayed ≤2 / Completed ≤6 SLA cards, Crisis / Transport / WO tiles, Recent Tickets table with row actions | our SLA is per item type, completion from acknowledge, hold pauses | Missing |
| Requests | `Requests.tsx`, `Detail.tsx`, `Composer.tsx`; `store.ts`; `Commands.php` logRequest, relay, onSite, hold, resume, finish, transfer, escalate, undoEscalate | multi-item tickets per department, relay / on site / hold (coded reasons) / resume / done, transfer, escalate to WO with link and undo, checkout auto rule, VIP, log-it-later, bundles, can't-do | per-item TABLE view with Relay/Resp/Res columns, All/Active/Done + date range filter, Edit ticket, Edit item with change history, Hand Off, general Undo of each step, Staff Request with staff name, HDO field, type-to-search across all items, "Other" free item with dept, qty in composer row, assign person at creation | our list is card/row per ticket with filters Open/Overdue/On hold/Done and dept scope; hold reasons are coded, not free text; escalation uses a "handles repairs" flag instead of dept names (better); our source values guest/staff | Partial |
| Inquiries | none | | whole module: list, filters, form, Note/Done/Undo, ≤6m flag, table `azl_inquiries` | | Missing |
| Cleaning | `Housekeeping.tsx`; `clean_tasks`; command cleanSet | statuses scheduled/queued/ready/in_progress/done, checkout auto rule, start/done | Log Cleaning form (type, RA, Lead/Backup, clock-in now), Schedule Rooms form (date, many rooms), clock-in / clock-out times and duration, Sched column, filters, table | we group by status and allow "Mark ready" by hand (prototype cannot); type labels "Deep clean" vs "Deep Clean"; label "Housekeeping" vs "Cleaning" | Partial |
| Work Orders | `Maintenance.tsx` (list + WoDetail); `work_orders`; assessWo, startWo, holdWo, completeWo, reopenWo | reported → assessed → in_progress ⇄ on_hold → done, reopen, in-house/outsource + contractor, estimated vs actual cost, audit, completing closes the source item | "+ Report Work Order" form (today a WO can only come from escalation), reporter chain (reporter dept, reporter, encoder), requested date, target start/end, assessed by, Edit WO, progress updates thread, deadline extension with reason, transfer to outsource mid-job, hold reason, completion notes, priority Urgent/Medium, scheduled status + Open, filters, overdue ⚠, table | our priority low/normal/high; our assess requires an estimate; we store only target_end | Partial |
| House Status | none (`Handover.tsx` is a different thing: shift sign-off) | | whole module: log cards, new/update/close/edit/reopen, table(s) | | Missing |
| Crisis Mgmt | `Safety.tsx` takeover + `azl_incidents`; raiseSafety, downgradeIncident, resolveIncident, record911 | an incident record with a log, "Staff notified (not BFP/911)", "BFP/911 called by … at …", resolve needs manager sign-off, cluster of rooms | crisis CASE log: radio codes 10-x, complaint category, reported by, involved type/name, where (+room/other), what, updates, Monitor, Close with required resolution, Edit, Reopen, list page with cards | ours is a keyword-triggered hazard alert (smoke, gas, flood, medical, threat, lift) with a full-screen takeover; the prototype is a manual logbook with no safety banner | Partial |
| Transport | none | | whole module: trips list, filters, log/schedule forms, depart/arrive, vehicles list, table `azl_trips` | | Missing |
| Reminders | none | | whole module: cards, filters, form with assignee, due time, link to any record, Done, overdue | | Missing |
| Reports | `Insights.tsx` | live department relay/completion %, held-longest list (more than the prototype, whose reports are stubs) | the six report tiles and their pages (Response Time, KPI Dashboard, Room Turnaround, WO Summary, Inquiry Volume, Crisis Log), export (brief 4.7) | ours has no tiles and no export | Partial |
| Configuration | `Settings.tsx`, `Lists.tsx`, `StaffAdmin.tsx`, `Logins.tsx`; `Catalog.php` | departments, service items (request types with SLA and icon), staff by department, plus bundles, hold reasons, job titles, WO findings, logins, preferences | lists: Areas, Crisis codes, Complaint categories, Crisis locations, Involved types, Vehicles, Cleaning types; Hotel profile; HD staff (help-desk officers) as a role | ours is editable (prototype is read-only); label "Settings" vs "Configuration" | Partial |
| (not in prototype) Handover | `Handover.tsx` | | | brief 4.6 requires it; the prototype has no such module | n/a |

Summary: Have 0, Partial 6 (Requests, Cleaning, Work Orders, Crisis Mgmt, Reports, Configuration), Missing 5 (Dashboard, Inquiries, House Status, Transport, Reminders).

## B.2 Target sidebar for our desk

Exactly the prototype's 11 items, in the prototype's order and with its labels. Icons from `src/ui/icons.ts` (Phosphor; generated by `scripts/icons.mjs`). New icons must be added to that generator.

| # | Label | Our icon | Status of icon | Badge (same rule as prototype) |
|---|---|---|---|---|
| 1 | Dashboard | `gauge` (Phosphor Gauge) | NEW | none |
| 2 | Requests | `clip` (clipboard, matches 📋) | have | open items (new, relayed, on_site, on_hold) |
| 3 | Inquiries | `chat` (Phosphor ChatCircle) | NEW | active + noted |
| 4 | Cleaning | `broom` | have | none |
| 5 | Work Orders | `wrench` | have | not done |
| 6 | House Status | `note` (Phosphor NotePencil) | NEW | not closed |
| 7 | Crisis Mgmt | `siren` | have | not resolved |
| 8 | Transport | `van` (Phosphor Van) or reuse `car` | NEW (or have) | none |
| 9 | Reminders | `bell` | have | pending |
| 10 | Reports | `chart` | have | none |
| 11 | Configuration | `gear` | have | none |

Recommendations kept from our desk (not in the prototype, client to confirm): hide a badge at 0 (prototype shows "0"); keep the hotel logo/name header, the "New request" button, the connection chip and the user menu (switch person, sign out); keep the per-hotel palette instead of the prototype's navy/teal; show Handover as a "Shift handover" panel on the Dashboard rather than a 12th item; move "Paper kit" into the user menu. Phone: bottom bar shows Dashboard, Requests, Cleaning, Work Orders + "More" (the other 7).

## B.3 Proposed role matrix (to confirm with the client)

The prototype has no roles. Our WordPress roles: Hotel Owner, Manager, Supervisor, Shared phone (every action needs a staff PIN; the PIN person has a department and a job role). V = sees and acts, R = read only, own = only own department or own items, - = hidden.

| Module | Owner | Manager | Supervisor (HDO lead) | Shared phone, help-desk officer | Shared phone, department staff |
|---|---|---|---|---|---|
| Dashboard | V | V | V | V | - |
| Requests | V | V | V | V | own dept |
| Inquiries | V | V | V | V | - |
| Cleaning | V | V | V | V | Housekeeping only |
| Work Orders | V | V | V | V (report) | repair depts: V; others: report only |
| House Status | V | V | V | V | R |
| Crisis Mgmt | V | V | V (close needs manager?) | log + update | log + update |
| Transport | V | V | V | V | drivers: depart/arrive |
| Reminders | V | V | V | own + All HD | - |
| Reports | V | V | R | - | - |
| Configuration | V (lists, logins) | V (lists) | R (own prefs) | own prefs only | own prefs only |

Today `tabsFor()` in `src/App.tsx` hides Insights and Settings from Shared phone only; per-department filtering exists as the "My department" scope on Requests.

## B.4 Build order, size, tables, commands

Sizes: S about 1 to 3 days, M about 4 to 8 days, L more than 8 days (one developer, including PHP tests and desk tests).

| Step | Work | Size | New or changed tables (prefix `wp_azl_`) | New commands (`Commands.php`) | Lists / roles affected |
|---|---|---|---|---|---|
| 1 | Shell: 11-item sidebar, labels, icons (gauge, chat, note, van), badges, phone "More", role matrix in `tabsFor()`, move Handover and Paper kit | S | none | none | roles: new capability per module, or a per-role module list |
| 2 | Dashboard: quick actions, stat and SLA cards, tiles, Recent Tickets; handover panel | M | none (reads) | none | SLA wording (two clocks vs 2/6 min) |
| 3 | Requests parity: item table view with timers, All/Active/Done + date range, edit ticket and item with history (into `events`), hand off, step undo, staff request + staff name, HDO, type-ahead item search with "Other", assign at creation, qty | M | `requests`: add `hdo` (staff id), `staff_name`, `source` value staff_request; `items`: add `relayed_by`, `on_site_at`, `x_note` | editRequest, editItem, handOff, undoStep (relay/onSite/done/hold/transfer) | requestTypes gains search; holdReasons stay coded with optional free text |
| 4 | Work Orders parity: report form, reporter chain, requested date, targets, assessed by, edit, updates thread, extend deadline, outsource mid-job, hold reason, completion notes, priority urgent/medium, scheduled + Open, filters, overdue | M | `work_orders`: add `reporter_dept`, `reporter_name`, `requested_date`, `target_start`, `assessed_by`, `assessed_at`, `actual_start`, `actual_end`, `hold_reason`, `sched_date`; priority values; new `azl_updates` (entity, entity_id, text, by_staff, created_at, op_id) shared with House Status and Crisis | reportWo, editWo, updateWo (extend, outsource), openWo | new lists: areas, woPriorities (fixed); departments (reporter dept) |
| 5 | Cleaning parity: Log Cleaning, Schedule Rooms, clock in/out, duration, filters, Lead/Backup | S | `clean_tasks`: add `role`, `sched_date`, `checkout_at`, `clock_in`, `clock_out`, `op_id` | logClean, scheduleClean, clockIn, clockOut | new list: cleaningTypes; attendants = Housekeeping staff |
| 6 | Inquiries | S | new `azl_inquiries` (id, inq_no, contact_name, contact_type, room, descr, hdo, status, closed_at, quick_close, op_id, created_at, updated_at); seq `inq` | logInquiry, noteInquiry, closeInquiry, reopenInquiry | none |
| 7 | Reminders | S | new `azl_reminders` (id, descr, assignee nullable = all help desk, due_at, notes, status, link_type, link_id, completed_at, op_id, created_at) | addReminder, doneReminder | role "help-desk officer" needed for "All HD Staff" |
| 8 | House Status | S | new `azl_house_logs` (id, hs_no, narration, status, logged_by, op_id, created_at, updated_at) + `azl_updates`; seq `hs` | logHouse, updateHouse, closeHouse, reopenHouse, editHouse | none |
| 9 | Crisis Mgmt case log, joined to the existing safety lane (an incident can open or link a case; the case page carries "CALL 911 / RADIO FIRST, THEN LOG" and lets the code alone create a case) | M | new `azl_crisis_cases` (id, cr_no, code, comp_cat, reported_by, who_type, who, what, occurred_at, location, status, case_status, resolution, incident_id, called911_by, called911_at, op_id, created_at, updated_at) + `azl_updates`; seq `cr` | logCrisis, updateCrisis, monitorCrisis, closeCrisis, reopenCrisis, editCrisis | new lists: crisisCodes, complaintCategories, crisisLocations, involvedTypes |
| 10 | Transport | S | new `azl_trips` (id, tr_no, vehicle, driver, dest, purpose, passengers, dep_at, arr_at, status, sched_date, sched_time, op_id, created_at, updated_at); seq `tr` | logTrip, scheduleTrip, departTrip, arriveTrip | new list: vehicles (drivers free text or staff) |
| 11 | Configuration: new lists in the Lists editor, Hotel profile, rename Settings → Configuration | M | option `azl_catalog` gains the lists above | catalog save (existing) | all new lists |
| 12 | Reports: six tiles; first real ones (Response Time, WO Summary, Room Turnaround) with CSV export | L | none (queries) | none (REST reads) | Owner/Manager only |

Total: about 6 S, 5 M, 1 L. Steps 1 to 5 bring the existing modules to parity; 6 to 10 add the missing ones; every table change is a `Schema.php` version bump run before the desk deploy (migrations first).

## B.5 Risks

1. Crisis vs safety rules: copying the prototype's crisis form (no 911 banner, "What happened" required before logging) breaks brief section 6. The case log must sit behind the safety lane, not replace it.
2. Two SLA models: the client's dashboard shows 2-minute relay / 6-minute completion from creation; our desk uses per-type targets from acknowledge with hold pausing. Numbers will not match the prototype; needs a client decision.
3. Live data migrations on staging: new columns and value changes (priority normal → medium, source staff → staff_request) on tables that hold real records; must be additive and tested with the existing 80 PHP tests.
4. Scope and screen density: 11 modules on a shared phone; the prototype is dense desktop tables at 11 px, our desk is touch-first. Following the prototype "accurately" on phones needs agreement on what may adapt.
5. Roles are our invention: the prototype gives everyone everything. A wrong matrix either blocks staff or exposes crisis and guest data (brief section 7).
6. Free-text people (reporter, driver, crisis "reported by") vs our staff ids: choose per field, or reporting breaks.
7. Prototype defects (A.16) may be read by the client as features (e.g. 0 badges, no undo on escalated items).

---

# Part C: open questions for the client

1. Our desk has a Shift Handover screen (sign-off by the incoming officer) that the prototype does not have. May we show it as a panel on the Dashboard, or do you want it as a 12th sidebar item?
2. The prototype's "Supervisor" tick box does nothing. Who should see which modules? Please confirm or correct the role table in B.3.
3. Service levels: keep the prototype's single targets (relay within 2 minutes, done within 6 minutes from the time the ticket was created), or the per-item targets measured from acknowledgement that the brief asks for?
4. Crisis: may every crisis screen start with "CALL 911 / RADIO FIRST, THEN LOG" and allow a case to be saved with just the code, with "What happened" filled in later?
5. Should a Crisis Mgmt case close need a manager, as our safety alerts do today?
6. Should sidebar counters hide when they are zero (the prototype shows "0")?
7. Reports: which reports matter first, and do you need Excel/PDF export from day one?
8. Work orders: how are "Scheduled" (preventive) jobs created: by hand with a date, or repeating (e.g. monthly)?
9. Transport: are drivers hotel staff (picked from a list) or typed in? Should a trip link to a room or a request?
10. Look and feel: keep each hotel's own colours and fonts, or switch to the prototype's navy and teal?

---

# Wave 1 done (2026-10-30, plugin 0.4.0; draft, AI-written, needs owner review)

## What was built

- **Sidebar, exactly the prototype's 11 items** in its order and labels: Dashboard (gauge), Requests (clip), Inquiries (chat), Cleaning (broom), Work Orders (wrench), House Status (note), Crisis Mgmt (siren), Transport (van), Reminders (bell), Reports (chart), Configuration (gear). Badges as the prototype counts them, "0" shown: Requests = open items (new, relayed, on site, on hold); Work Orders = not done; Crisis Mgmt = unresolved (until cases exist: active safety alerts); Inquiries, House Status, Reminders = 0 until their data exists. Hiding at zero is one constant (`HIDE_ZERO_BADGES` in `src/modules/registry.ts`). Kept from our desk: hotel logo and name, New request, the connection chip (page header), the user menu at the foot (name, role, Switch person, Paper kit, Sign out). Phone: Dashboard, Requests, Cleaning, Work Orders and More (the other 7 plus Paper kit). The current item is filled with the hotel's accent; badges use the hotel's gold.
- **Existing screens mapped**: Requests as they were; Cleaning = Housekeeping; Work Orders = Maintenance; Reports = Insights; Configuration = Settings (display, feel, staff, logins, lists). New Dashboard: quick actions (New Request works; New Inquiry, New Reminder, Log Cleaning open a "coming in the next update" sheet), counts (open, overdue, on hold, work orders open, rooms ready), Recent Tickets (one row per item, newest ticket first) and the Shift handover panel (the former Handover screen). New Crisis Mgmt page: the "CALL 911 / RADIO FIRST, THEN LOG" banner, a "Log a case" area (wave 2) and the safety incidents as cards that open the existing full-screen alert (911 recording and sign-off unchanged). Inquiries, House Status, Transport Log and Reminders show one shared `ComingNext` placeholder.
- **Client framework** (`src/modules/`): `registry.ts` (ordered `MODULES`), one folder per module, `types.ts` (`ModuleDef`, `lazyScreen`), `access.ts` (the matrix copy), `README.md`. `App.tsx` builds sidebar, phone bar, More sheet, detail panes and routing from the registry only. Snapshot `modules` slice (`moduleData`, typed by declaration merging) and `runModuleCommand` (same outbox, fresh opId).
- **Server framework**: `includes/Modules.php` (`Azl_Module`, `Azl_Modules`), `includes/Modules/*.php` loaded after `includes/*.php`; module schemas join `Azl_Schema` (CREATE TABLE only, refused otherwise; the stored db version includes every module's version, so a new module upgrades once on `plugins_loaded`, which is now hooked); unknown command types fall back to the registry with the same op-id claim and transaction; snapshot slices only for readers allowed by the matrix; module lists in `Azl_Catalog` declared as {label, maxItems, fields, seed}. New shared table `azl_updates` (`Azl_Updates::add/list`) and counters `inq`, `hs`, `cr`, `tr`. Schema version 2; additive only.
- **Role matrix on the server** (`includes/Access.php`): module x actor kind, B.3 as written. Actor kind = WordPress role (owner, manager, supervisor); on a shared phone, the PIN person's job role (hdo, staff with department, supervisor, manager). Every command type belongs to a module and is refused when access is none or read, or (own) for another department's item, or when it needs full (resolving a safety alert). The page sends `window.AZL.user.modules` and `window.AZL.access`.

## Defaults taken (client to confirm)

Handover is a Dashboard panel, not a 12th item. SLA model unchanged (our per-type targets, two clocks). Safety rules unchanged; the hazard takeover stays, and resolving it on a shared phone needs a supervisor or manager PIN (the screen already required it). Hotel palette kept. "0" badges shown. Readings of B.3: "V (report)" = full; Crisis "log + update" = own (no close); department staff's Cleaning = Housekeeping only, Work Orders = full for a repairs department, else read; Configuration "own prefs" = device preferences only (lists, staff and logins keep their capabilities). Department staff on a shared phone no longer see Dashboard (and so cannot sign the handover). The existing Requests, Cleaning, Work Orders and incident data in the snapshot are not filtered by role (only module slices are).

## How to add a module

See `src/modules/README.md`: one folder `src/modules/<id>/` (replace the placeholder) and one file `azalea-ehelpdesk/includes/Modules/<Id>.php`; no shared file changes for the 11 known ids.

## What wave 2 modules may now do independently

Inquiries, House Status, Crisis cases, Transport and Reminders can each, in parallel: create their tables and counters, register commands (with validation, scope and replay numbers), send their snapshot slice, add editable lists, write progress notes to `azl_updates`, and build their screen and badge in their own folder. Requests, Cleaning and Work Orders parity (B.4 steps 3 to 5) change existing tables and commands, so they still touch shared files (`Commands.php`, `Schema.php`, `store.ts`) and should be sequenced, not parallel.

---

# Part D: implementation status (2026-10-31, plugin 0.5.0)

All 11 sidebar modules are built and follow the prototype's navigation, labels, order and badge rules. Deviations are intentional: hotel palettes and fonts, our own response-time model (per item type, from acknowledgement, hold removed), the safety lane kept in front of the Crisis case log ("CALL 911 / RADIO FIRST, THEN LOG"; a case needs only a code to be saved), Handover shown as a Dashboard panel, roles enforced on the server (docs section B.3 as implemented in `includes/Access.php`), everything in the hotel's local time (Asia/Manila, never UTC), Configuration editable.

| Module | State | Where |
|---|---|---|
| Dashboard | built | `src/modules/dashboard` |
| Requests | parity (table, edit, hand off, undo, staff request, history) | `src/screens/Requests.tsx`, `src/modules/requests`, `includes/Modules/Requests.php` |
| Inquiries | built | `src/modules/inquiries`, `includes/Modules/Inquiries.php` |
| Cleaning | parity (log, schedule, clock in/out) | `src/screens/Housekeeping.tsx`, `src/modules/cleaning` |
| Work Orders | parity (report form, updates, extend, outsource, scheduled) | `src/screens/Maintenance.tsx`, `src/modules/workorders` |
| House Status | built | `src/modules/housestatus` |
| Crisis Mgmt | case log behind the unchanged safety lane | `src/modules/crisis`, `includes/Modules/Crisis.php` |
| Transport | built (trips, vehicles list) | `src/modules/transport` |
| Reminders | built | `src/modules/reminders` |
| Reports | six reports, date range, CSV export | `src/modules/reports`, `includes/Modules/Reports.php` |
| Configuration | hotel profile and every list editable | `src/modules/config` |

Open questions for the client remain in Part C (handover placement, role table, service-level model, crisis closing rule, zero badges, report priorities, scheduled work orders, transport drivers, look and feel). Defaults used meanwhile are listed above.
