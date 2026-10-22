# Azalea e-Helpdesk: Stack Feature Matrix vs. Phase 1 Acceptance Tests

**Purpose:** Show the gap between a WordPress-plugin build and a full-stack build against the Phase 1 acceptance tests in the build brief (§5) and the pre-pilot must-haves (§9).
**Basis:** Audit of `azalea-ehelpdesk-build-brief.md` only. The v8 prototype and the source Google Doc were not reviewed. Effort figures are rough estimates, not quotes.

## The four build options compared

| Code | Option | What it means |
|---|---|---|
| **WP-C** | WordPress plugin, cloud-hosted | Typical OCS hosting. Dedicated WP instance, React PWA front end, system cron. |
| **WP-L** | WordPress plugin on a hotel LAN box | Same plugin, running on a mini PC at the property on a UPS. |
| **FS-S** | Full stack, Standard tier | React PWA, local-first sync, Supabase/Postgres in the cloud. Device queue only. |
| **FS-R** | Full stack, Resilient tier | FS-S plus per-property edge node, Android shell, local alerts. |

**Legend:** ✅ Pass · 🟡 Partial (workaround or extra build needed) · ❌ Fail

## A. Phase 1 acceptance tests (brief §5)

| # | Acceptance test | WP-C | WP-L | FS-S | FS-R | Notes |
|---|---|---|---|---|---|---|
| A1 | A full shift runs on it | 🟡 | 🟡 | 🟡 | ✅ | Cloud options fail the shift if the ISP drops mid-shift. WP-L is limited by polling and cron reliability. |
| A2 | Pull the internet: on-site sync still works across stations | ❌ | 🟡 | ❌ | ✅ | Needs a LAN server. WP-L can do it but only with polling refresh (10–15 s). |
| A3 | Pull a device's WiFi: it queues and reconciles, no false escalation | 🟡 | 🟡 | ✅ | ✅ | WP needs a hand-built JS queue and merge logic. "Unreachable vs. unacknowledged" needs reliable server-side heartbeat checks, which WP-Cron can't guarantee. |
| A4 | Pull power: stations keep logging on battery, then paper, with working re-entry | 🟡 | 🟡 | 🟡 | ✅ | Needs an online UPS on the server and a defined paper re-entry process. Process work is the same on every stack. |
| A5a | Safety keyword fires a local alert on the originating device, offline | ✅ | ✅ | ✅ | ✅ | Device-side JS rule. Stack-independent. |
| A5b | Safety alert reaches other staff devices offline | ❌ | 🟡 | ❌ | ✅ | Needs a LAN socket and a native Android foreground service. |
| A6 | Every v8 action behaves as in the prototype (WO assess/outsource/cost, request→WO escalation with undo, auto cleaning-ready rule) | ✅ | ✅ | ✅ | ✅ | Ordinary workflow logic. Use custom tables on WP, not post meta. |
| A7 | Common request logs faster than a radio call with a real HDO | ✅* | ✅* | ✅ | ✅ | *Only with a React PWA front end. wp-admin screens would fail this test. |

## B. Pre-pilot must-haves (brief §9) and related requirements

| Requirement | WP-C | WP-L | FS-S | FS-R | Notes |
|---|---|---|---|---|---|
| Offline-first PWA with LAN sync and device store-and-forward | ❌ | 🟡 | 🟡 | ✅ | Constraint #1 in the brief. Only FS-R meets it cleanly. |
| Fast PIN/badge auth, no per-open login, per-user attribution | 🟡 | 🟡 | ✅ | ✅ | WP auth model needs custom endpoints. |
| SLA timers, escalation, quiet hours, orphan detection | 🟡 | 🟡 | ✅ | ✅ | WP-Cron fires on page visits. A real system cron is mandatory. |
| Real-time board and instant alerts | ❌ | ❌ | ✅ | ✅ | PHP has no native websocket server. |
| Reliable on-LAN alerts with the screen locked | ❌ | ❌ | ❌ | ✅ | PWAs can't run a foreground service. Needs a native Android shell. |
| Alert budget, mute-rate and alert-to-action telemetry | 🟡 | 🟡 | ✅ | ✅ | Digests and rate caps depend on reliable scheduling. |
| Shift-handover view | ✅ | ✅ | ✅ | ✅ | Orphan detection needs reliable cron on WP. |
| Department-level-only reporting, no per-person rankings | ✅ | ✅ | ✅ | ✅ | Design rule, not stack. |
| Tamper-evident crisis, key and lost-and-found logs | 🟡 | 🟡 | ✅ | ✅ | Hash chain plus write-once backup. Avoid the word "immutable" on WP: admins and DB users can edit rows. |
| Photo/video that never blocks the ticket write | 🟡 | 🟡 | ✅ | ✅ | PHP upload limits, chunked upload needed. |
| Real tenant isolation | 🟡 | 🟡 | ✅ | ✅ | No row-level security in MySQL. Postgres RLS in the full stack. |
| Month-end report pack with no internet | ❌ | 🟡 | 🟡 | ✅ | WP-L must run system cron and heavy PDF/Excel jobs on the box. |
| Crisis screens carry "CALL 911 / RADIO FIRST, THEN LOG" | ✅ | ✅ | ✅ | ✅ | UI copy. |
| Paper fallback and re-entry procedure | ✅ | ✅ | ✅ | ✅ | Process, not software. |
| Dead-zone WiFi survey (go-live gate) | n/a | n/a | n/a | n/a | Required on every option. |

## C. Scorecard

Counts are over the 22 rated rows in sections A and B (the survey row is excluded). Rows marked ✅* count as Pass.

| | WP-C | WP-L | FS-S | FS-R |
|---|---|---|---|---|
| ✅ Pass | 7 | 7 | 15 | 22 |
| 🟡 Partial | 9 | 13 | 4 | 0 |
| ❌ Fail | 6 | 2 | 3 | 0 |

## D. What each option can honestly be sold as

| Option | Honest pitch | Do NOT claim |
|---|---|---|
| WP-C | Service request, maintenance and handover tracker; devices tolerate dead zones. | Works without internet. Real-time alerts. |
| WP-L | Same, plus basic LAN operation during an ISP outage. | Instant alerts. Trustworthy timers without extra ops work. |
| FS-S | Outage-tolerant devices, strong timers and tenant isolation, cloud dashboards. | Shared visibility during an ISP outage. |
| FS-R | The brief's full offline-first promise, within its limits. | A life-safety system. iOS critical alerts. Surviving total power loss. |

## E. Recommendation

1. **Go full stack (React PWA), not a WP plugin**, for anything sold as "offline-first". WP-C fails the central acceptance tests (A2, A5b), and WP-L only partially recovers them.
2. **Ship in tiers from one codebase.** FS-S is the entry product. FS-R adds the edge node and the Android shell.
3. **If WP is chosen anyway** for speed or familiarity, make the plugin a thin REST API (custom tables, UUIDs, event tables) behind a separate React PWA, and use it for Phase 0 shadow mode and Phase 1a only. That keeps a later backend swap cheap.
4. **Before building either**, run the sync spike (2 candidate engines, partition test, clock-skew test) and resolve the five blocking issues from the audit: device policy, offline voice-to-text, voice-call paging, the safety-lane liability wording, and device-timestamp trust.

## F. Caveats

- Ratings are my judgment against the brief's wording, not benchmark results.
- A 🟡 can be upgraded with extra engineering. The cost of that engineering is the real comparison, and it is largest for WP on A2, A3 and the alerting rows.
- Philippine legal citations in the brief were not verified.
