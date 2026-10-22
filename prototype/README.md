# Azalea e-Helpdesk prototype

Interactive prototype of the Azalea e-Helpdesk for hotel staff: requests, work orders, housekeeping, shift handover, insights and network resilience.

Stack: React 19, Vite, TypeScript, motion/react for animation, Phosphor icons.

All data is synthetic and held in memory. There is no backend, no network calls and no persistence. Reloading the page resets the demo.

## Run

```
npm install
npm run dev     # local dev server
npm test        # vitest, 23 tests in src/domain/store.test.ts
npm run build   # tsc --noEmit, then vite build to a single-file dist/index.html
```

Sign-in: pick a name on the lock screen, then enter any four digits.

## Folder map

```
src/
  main.tsx              entry point
  App.tsx               shell: sidebar and tab bar, screen routing, keyboard shortcuts, sheets
  domain/
    types.ts            State, Item, Request, WorkOrder, Incident, Net, Prefs
    rules.ts            staff, presets, bundles, hazards, safety regex, SLA clock, hubUp()
    seed.ts             synthetic starting data
    store.ts            observable store, actions, sync and UPS simulation, tick()
    store.test.ts       23 tests
  lib/
    motion.ts           motion tokens, spring presets, useSafeMotion()
    haptics.ts          haptic patterns, tone() sounds, event bus
  ui/
    kit.tsx             primitives: Button, Icon, Group, Row, Segmented, Switch, Pill, Ring, Toasts, NetPill, Screen
    sheet.tsx           modal sheet
  screens/
    Cover.tsx           entry screen, before the PIN lock
    Lock.tsx            shared-device PIN sign-in
    Requests.tsx        request list
    Composer.tsx        log a request (presets, room, bundles)
    Detail.tsx          ticket detail and item actions
    Safety.tsx          red safety takeover
    Maintenance.tsx     work orders list and detail
    Housekeeping.tsx    room board
    Handover.tsx        shift handover and acknowledgement
    Insights.tsx        department scorecards, shadow mode
    Network.tsx         network toggles, layers, Station B, edge console
    Settings.tsx        text size, contrast, motion, haptics, theme
  demo/
    Guide.tsx           the 12 guided demo steps (STEPS array)
  styles.css            design tokens and component styles
```

## Design system (src/styles.css)

- iOS-style grouped lists (Group, Row), large titles (.t-large, .t-title1) and 16px rounded cards.
- Glass materials (--glass with backdrop blur) on the nav bar and tab bar.
- 44pt targets: --hit is 2.75rem, and controls meet it.
- Dynamic Type: every size is rem. The root font size is calc(16px * var(--ts)), so the Settings text size scales the whole app.
- Colour is all tokens on :root. Dark tokens apply under prefers-color-scheme or data-theme="dark". data-contrast="more" raises text and separator contrast.
- Department colours: --d-housekeeping, --d-engineering, --d-it, --d-fnb, --d-frontdesk, --d-security, each with a -bg variant.
- Motion: tokens and springs in src/lib/motion.ts (snappy, gentle, sheet, instant, release). Reduced motion is honoured through data-motion="reduce", prefers-reduced-motion and MotionConfig.
- Haptics: patterns in src/lib/haptics.ts (select, light, medium, heavy, success, warning, error). Where navigator.vibrate is missing, a HUD shows what a phone would feel.

## Presenter talk track

| # | Step | Say (one sentence) | Point at |
|---|------|--------------------|----------|
| 1 | Log a request in seconds | A guest asks for towels, and the desk taps a room and items instead of typing. | Timer in the composer; new ticket at the top of Requests. |
| 2 | Route it and close the loop | Each team relays, goes on site and finishes on its own phone, so the desk is not the data clerk. | Item steps moving; the target-time ring. |
| 3 | Pull the internet | The ISP is down, but on the Resilient tier the on-site edge node still shares tickets. | Station B card stays in sync; Hotel network layer. |
| 4 | Same outage, cloud-only tier | On Standard there is no on-site node, so this device keeps working and catches up later. | Waiting changes in the header; Station B falls behind, then catches up. |
| 5 | A dead zone in the stairwell | A phone out of Wi-Fi saves each tap with its real time and sends them on reconnect. | "Waiting" count rises, then "Caught up". |
| 6 | A power cut | Battery backup keeps the edge node and Wi-Fi up; when it runs out, the team switches to paper. | Battery bar on Network; run it down for the paper-mode banner. |
| 7 | Safety words | Words like "usok" or "amoy gas" are caught on the device, before any AI, with a local alert. | Red takeover; "Staff notified (not BFP/911)"; manual 911 field. |
| 8 | A leak becomes a work order | One tap on Leak creates the repair and a cleanup that waits for the fix. | Waiting cleanup item, then the work order and its link to the ticket. |
| 9 | Checkout turns the room ready | When the checkout inspection is done, the room flips to Ready with no radio call. | Room 305 moving to Ready to clean on Housekeeping. |
| 10 | Shift handover | The next officer sees open items, overdue items and guest promises. | Orphaned item, then the acknowledgement. |
| 11 | Reports that stay fair | Managers see departments, not personal rankings; shadow mode hides timers until trust is built. | Shadow mode card, then department scorecards. |
| 12 | Made for everyone | Larger text, high contrast, reduced motion, haptics, dark mode and full keyboard use. | Whole app scaling up, then back to normal. |

Presenter notes:

- Keyboard: n opens a new request; 1 to 7 jump to tabs in sidebar order (Requests, Work orders, Housekeeping, Handover, Insights, Network, Settings). Shortcuts are ignored while typing or in a dialog.
- Network screen: toggles for Internet connection, This device's Wi-Fi and Mains power. Service level switches between Standard (cloud) and Resilient (edge node). "Restore everything" turns the three toggles back on. The edge node console (sync, interfaces, logging) is read-only.
- Demo PIN: any four digits.
- "Reset demo data" is on the Network screen and in the guide. Steps that already ran say so; reset to replay them.

## Simulated vs real

Simulated in the prototype:

- Sync: commit() queues changes as ops while the hub is unreachable. Station B refreshes 450 ms after a successful write. reconcile() flushes the queue after 1.3 s. There are no conflicts to resolve.
- Hub reachability: hubUp() in rules.ts. Resilient is reachable over the on-site LAN (mains or UPS). Standard needs internet and mains. Both also need device Wi-Fi.
- UPS: tick() drains 4 points per second on mains loss and recharges 10 per second on mains. At 0 the app enters paper mode.
- Edge node: a state flag and canned console output, not a server.
- Safety alert: detectSafety() is a regex over English and Filipino terms, run on the device. It is not a validated classifier. Sound and haptics are local.
- Auth: the PIN accepts any four digits. There are no sessions and no server checks.
- Data: synthetic seed, in memory only.

What a production build would need:

- Edge node: on-site hardware or service with a local database, replication, failover, health monitoring and tested UPS integration.
- Native Android shell for staff devices: background sync, a durable offline store, push notifications, alerting and device management.
- Real sync engine: durable local queue, idempotent operations, server-side ordering, retries and conflict resolution.
- Auth: real identity (PIN or SSO), device binding, server-enforced roles and audit logs.
- Integrations: property management, booking and guest messaging. Data protection and privacy review.
- Safety: a reviewed emergency procedure matching the hotel's fire and security protocols, with drills. Integration with alarm hardware and local emergency services.
- Security testing, accessibility audit and observability.

This prototype is not a life-safety system. It does not replace fire alarms, smoke detectors or emergency services. In an emergency, call the emergency number and use the radio first.
