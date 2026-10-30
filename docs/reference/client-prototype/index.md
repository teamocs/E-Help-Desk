# Client prototype screenshots

Captured from `../client-prototype.html` (the client's original v8 prototype, opened from file:// with its hosting runtime stripped) in headless Chrome at 1440x900, full page, seeded sample data as shipped (today = capture date). Shots 83-84 are at 760 px wide. Reference only: see `../../MODULES-SPEC.md`.

| File | What it shows |
|---|---|
| [01-dashboard.png](01-dashboard.png) | Dashboard (Supervisor checkbox off): quick-action bar, KPI tiles, SLA percentages, crisis/transport/WO tiles, Recent Tickets table. |
| [02-dashboard-supervisor-on.png](02-dashboard-supervisor-on.png) | Dashboard with the sidebar "Supervisor" checkbox ticked: identical to the off state (the toggle has no visible effect). |
| [03-dashboard-toast-relayed.png](03-dashboard-toast-relayed.png) | Toast after pressing Relay on a row (bottom centre, "✓ Relayed"). |
| [04-requests-all.png](04-requests-all.png) | Requests: filter All. One row per item (code T-NNNN-n), with Relay/Resp/Res timers and row actions. |
| [05-requests-active.png](05-requests-active.png) | Requests: filter Active (new, relayed, on_site, on_hold items). |
| [06-requests-done.png](06-requests-done.png) | Requests: filter Done (done and transferred items). |
| [07-requests-date-today.png](07-requests-date-today.png) | Requests after pressing Today: the inputs show blank again and the table is empty (the filter compares UTC dates, so in UTC+8 today's tickets fall outside "today"). A prototype defect. |
| [08-request-detail-T0001.png](08-request-detail-T0001.png) | Request detail drawer (right, 420 px): ticket block with Edit, item cards with timers and per-status actions. |
| [09-request-detail-transferred.png](09-request-detail-transferred.png) | Request detail T-0004: transferred item greyed with purple left border, new item shows "↳ T-0004-1 (HK)". |
| [10-request-detail-transfer-form.png](10-request-detail-transfer-form.png) | Inline Transfer form under an item: Dept, Staff, Reason, OK / ✕. |
| [11-request-detail-handoff-form.png](11-request-detail-handoff-form.png) | Inline Hand Off form on a done item (green): Dept, Item (Same), Staff, OK / ✕. |
| [12-request-detail-escalate-button.png](12-request-detail-escalate-button.png) | T-0002 Engineering item on site: shows the red "→ WO" escalate button. |
| [13-request-detail-escalated.png](13-request-detail-escalated.png) | After "→ WO": item status escalated, link tag "🔗 WO-0005 (reported)", Undo only. |
| [14-modal-edit-ticket.png](14-modal-edit-ticket.png) | Edit ticket modal: Room, Source, Staff Name (staff requests), HDO, Remarks. Changes are logged. |
| [15-modal-edit-item.png](15-modal-edit-item.png) | Edit item modal: Dept, Item (list + Other), Qty, Assigned, Relayed by. |
| [16-modal-hold-item.png](16-modal-hold-item.png) | Hold item modal: free-text reason (required). |
| [17-request-detail-on-hold.png](17-request-detail-on-hold.png) | Item on hold: amber "⏸ reason" strip, actions Undo / Resume / → WO (Engineering/IT only). |
| [18-request-detail-edit-history.png](18-request-detail-edit-history.png) | After editing a ticket: change history list under the ticket block ("Room: 412 → 414"). |
| [19-modal-new-request.png](19-modal-new-request.png) | New Request modal: Source (Guest/Staff Request), Room, item rows (type-to-search, Dept read-only, Qty, Assign), + Add item, Remarks. |
| [20-modal-new-request-search.png](20-modal-new-request-search.png) | Item search dropdown: matches across all departments ("Item — Dept") plus "Other (not listed)". |
| [21-modal-new-request-filled.png](21-modal-new-request-filled.png) | Two items: a catalogue item (dept auto-filled, staff list enabled) and an "Other" item (dept select + describe). Staff Request shows Staff Name. |
| [22-inquiries-all.png](22-inquiries-all.png) | Inquiries: filter All. Type badge, name, room, description, HDO, status (≤6m tag when closed within 6 min). |
| [23-inquiries-active.png](23-inquiries-active.png) | Inquiries: filter Active (active + noted). |
| [24-inquiries-done.png](24-inquiries-done.png) | Inquiries: filter Done. |
| [25-modal-new-inquiry.png](25-modal-new-inquiry.png) | New Inquiry modal: Type (In-house Guest/External/Checked-out), Name, Room, HDO, Description. |
| [26-cleaning-all.png](26-cleaning-all.png) | Cleaning: filter All. Room, Type, RA, Status, Sched, Clock In/Out, Duration, Clock In/Clock Out action. |
| [27-cleaning-ready.png](27-cleaning-ready.png) | Cleaning: filter ready. |
| [28-cleaning-in-progress.png](28-cleaning-in-progress.png) | Cleaning: filter in_progress. |
| [29-cleaning-done.png](29-cleaning-done.png) | Cleaning: filter done. |
| [30-modal-log-cleaning.png](30-modal-log-cleaning.png) | Log Cleaning modal: Room, Type (7 types), RA, Role (Lead/Backup), "Clock In now" checkbox. |
| [31-modal-schedule-rooms.png](31-modal-schedule-rooms.png) | Schedule Rooms modal: Checkout Date (default tomorrow), Type (Checkout/Deep Clean), room rows, + Add room. |
| [32-workorders-all.png](32-workorders-all.png) | Work Orders: filter All. Deadline in red with ⚠ when past the requested date; outsourced shows ⬡ contractor. |
| [33-workorders-reported.png](33-workorders-reported.png) | Work Orders: filter reported. |
| [34-workorders-assessed.png](34-workorders-assessed.png) | Work Orders: filter assessed (empty in the sample data: table header only). |
| [35-workorders-in-progress.png](35-workorders-in-progress.png) | Work Orders: filter in_progress. |
| [36-workorders-on-hold.png](36-workorders-on-hold.png) | Work Orders: filter on_hold (empty in the sample data: table header only). |
| [37-workorders-done.png](37-workorders-done.png) | Work Orders: filter done. |
| [38-modal-report-wo.png](38-modal-report-wo.png) | Report Work Order modal: Area, Location, Problem, Priority, Assign to Dept, REPORTED BY (Reporter Dept, Reporter Name, Encoded by HDO), Requested completion *. |
| [39-wo-detail-in-progress.png](39-wo-detail-in-progress.png) | WO detail (WO-0001 in progress, outsourced): facts grid, Assessment, cost box (estimated vs actual), Actual, Updates, Audit Trail, Edit/+Update/Hold/Complete. |
| [40-modal-wo-assess.png](40-modal-wo-assess.png) | Assess modal (WO-0003): Findings, Assignment In-house/Outsource, Assign to or Contractor, Assessed by, TARGET start/end, Est. cost ₱. |
| [41-modal-wo-assess-outsource.png](41-modal-wo-assess-outsource.png) | Assess modal with Outsource: staff select replaced by Contractor field. |
| [42-modal-wo-update.png](42-modal-wo-update.png) | Update modal: Progress update, By, "Extend deadline" (current, new, reason), "Transfer to Outsource" (contractor, est. cost). |
| [43-modal-wo-complete.png](43-modal-wo-complete.png) | Complete modal: Completion notes, Actual cost ₱ (pre-filled with estimate), By. |
| [44-modal-wo-hold.png](44-modal-wo-hold.png) | Hold modal: Reason (required). |
| [45-modal-wo-edit.png](45-modal-wo-edit.png) | Edit WO modal: Area, Location, Description, Priority, Dept, Assigned, Requested date, read-only AUDIT TRAIL. |
| [46-wo-detail-done.png](46-wo-detail-done.png) | WO detail (WO-0002 done, in-house): actual start/completed, cost box, Reopen button. |
| [47-wo-detail-reported.png](47-wo-detail-reported.png) | WO detail (WO-0003 reported): Edit and Assess only. |
| [48-wo-detail-scheduled.png](48-wo-detail-scheduled.png) | WO detail (WO-0004 scheduled): only Edit; the list row offers "Open" (back to reported). |
| [49-housestatus-list.png](49-housestatus-list.png) | House Status: log cards (left border colour by status), updates thread, + Update / Close / Edit. |
| [50-modal-new-housestatus.png](50-modal-new-housestatus.png) | New House Status modal: Incident Narration, Logged by, Status (Monitoring/Pending). |
| [51-modal-housestatus-update.png](51-modal-housestatus-update.png) | House Status update modal: Update, By. |
| [52-modal-housestatus-close.png](52-modal-housestatus-close.png) | Close Log modal: optional closing note. |
| [53-modal-housestatus-edit.png](53-modal-housestatus-edit.png) | Edit House Status modal: Narration, Status (Monitoring/Pending/Closed). |
| [54-housestatus-states.png](54-housestatus-states.png) | House Status with a pending log (amber border) and a closed log (green border, faded, Edit / Reopen). |
| [55-crisis-list.png](55-crisis-list.png) | Crisis Mgmt: case cards (code in red, who/where/what, updates, resolution). Sample case is resolved: Edit / Reopen. |
| [56-modal-new-crisis.png](56-modal-new-crisis.png) | New Crisis Case modal: Crisis Code (11 codes), Reported by, Involved type/name, Where, What happened; red "Log Case". |
| [57-modal-new-crisis-complaint-room.png](57-modal-new-crisis-complaint-room.png) | Code 10-28 Guest Complaint reveals Complaint Category; Where = Room reveals Room No. |
| [58-crisis-active-case.png](58-crisis-active-case.png) | New case logged: active (red border) with + Update / Monitor / Close / Edit. |
| [59-modal-crisis-update.png](59-modal-crisis-update.png) | Crisis update modal: Update, By. |
| [60-modal-crisis-monitor.png](60-modal-crisis-monitor.png) | Monitor modal: Monitoring note (required); moves case to monitoring. |
| [61-crisis-monitoring-case.png](61-crisis-monitoring-case.png) | Case in monitoring (blue border): + Update / Close / Edit. |
| [62-modal-crisis-close.png](62-modal-crisis-close.png) | Close Case modal: Final resolution * (required). |
| [63-modal-crisis-edit.png](63-modal-crisis-edit.png) | Edit crisis case modal (same fields as create). |
| [64-transport-all.png](64-transport-all.png) | Transport Log: filter All. Vehicle, Driver, Destination, Purpose, Passengers, Departed (or schedule), Arrived, Status, Depart/Arrived. |
| [65-transport-scheduled.png](65-transport-scheduled.png) | Transport: filter scheduled. |
| [66-transport-en-route.png](66-transport-en-route.png) | Transport: filter en_route. |
| [67-transport-arrived.png](67-transport-arrived.png) | Transport: filter arrived. |
| [68-modal-log-trip.png](68-modal-log-trip.png) | Log Trip modal: Vehicle, Driver, Destination, Purpose, Passengers; button "Depart" (starts en route now). |
| [69-modal-schedule-trip.png](69-modal-schedule-trip.png) | Schedule Trip modal: same plus Date (default tomorrow) and Time (default 08:00). |
| [70-reminders-all.png](70-reminders-all.png) | Reminders: card grid; red border + OVERDUE when past due and pending; link tag; Done button. |
| [71-reminders-pending.png](71-reminders-pending.png) | Reminders: filter Pending. |
| [72-reminders-completed.png](72-reminders-completed.png) | Reminders: filter Completed. |
| [73-modal-new-reminder.png](73-modal-new-reminder.png) | New Reminder modal: Description, Assigned (All HD Staff or a person), Scheduled (date-time), Link to (any ticket/WO/HS/CR), Notes. |
| [74-reports.png](74-reports.png) | Reports: six report tiles (category, title, one line). All are stubs. |
| [75-reports-coming-soon.png](75-reports-coming-soon.png) | Clicking a report tile only shows the toast "Coming soon". |
| [76-configuration.png](76-configuration.png) | Configuration: read-only chips: Hotel Profile (text only), Departments & Staff, Service Items, Crisis Codes, Vehicles. |
| [77-empty-dashboard.png](77-empty-dashboard.png) | Empty data: dashboard shows zeros, "Within SLA", 0% (red) and an empty Recent Tickets table. |
| [78-empty-requests.png](78-empty-requests.png) | Empty requests: no empty-state message (table header only, or a bare action bar). |
| [79-empty-workorders.png](79-empty-workorders.png) | Empty workorders: no empty-state message (table header only, or a bare action bar). |
| [80-empty-housestatus.png](80-empty-housestatus.png) | Empty housestatus: no empty-state message (table header only, or a bare action bar). |
| [81-empty-crisis.png](81-empty-crisis.png) | Empty crisis: no empty-state message (table header only, or a bare action bar). |
| [82-empty-reminders.png](82-empty-reminders.png) | Empty reminders: no empty-state message (table header only, or a bare action bar). |
| [83-narrow-760-requests.png](83-narrow-760-requests.png) | Width ≤ 768 px: sidebar collapses to a 44 px icon rail (labels, badges and footer hidden); modals single-column. |
| [84-narrow-760-new-request.png](84-narrow-760-new-request.png) | Width ≤ 768 px: New Request modal with stacked item fields. |
