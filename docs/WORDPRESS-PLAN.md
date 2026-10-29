# Azalea e-Helpdesk on WordPress: Design and Build Plan

**Status:** DRAFT for owner review, 2026-10-29. Replaces `docs/PLAN.md` (the Next.js + Neon + Vercel build, retired).
**One line:** one plugin, installed separately on the Azalea Baguio and Azalea Boracay WordPress sites, that gives each hotel its own live service-request and maintenance desk at `/helpdesk/`, with the same screens and rules as the prototype.

---

## 1. Decision and what it changes

The full-stack build (Next.js, Neon Postgres, Neon Auth, Vercel) is dropped. The help desk now lives inside the two hotel websites as a custom plugin.

| | Before (retired) | Now |
|---|---|---|
| Hosting | Vercel + Neon | The hotel's own WordPress host |
| Accounts | Neon Auth, email verification | WordPress users and roles, plus staff PINs |
| Tenancy | One database, many hotels, row-level security | **One install per hotel.** Each site is its own tenant. No cross-tenant code. |
| Backend | TypeScript server actions | PHP REST API in the plugin |
| Front end | Next.js pages | The same React desk, built as a static bundle the plugin serves |
| Deploy | git push, Vercel | Plugin zip, installed through Novamira, WP-CLI or wp-admin |

**What is reused unchanged:** the screens (`src/screens`), the UI kit (`src/ui`), the rules (`src/domain/rules.ts`), the store and offline outbox (`src/domain/store.ts`, `outbox.ts`, `remote.ts`), the command contract (`src/server/contract.ts`). The desk keeps working as designed in `docs/azalea-ehelpdesk-build-brief.md`.

**What is rewritten:** the server half. `src/server/mutations.ts` and `snapshot.ts` become PHP classes with the same behaviour and the same tests in spirit.

**Retired:** Neon, Vercel, Neon Auth, setup codes, the account dashboard and sign-in pages, per-org row-level security. The code stays in git history. Nothing in the Neon database needs migrating (test data only).

## 2. The two target sites (read from the Novamira connectors, 2026-10-29)

Both staging sites are reachable through Novamira (`azaleabaguio-staging2`, `azaleaboracay-staging2`). The live sites (`azaleabaguio.com`, `azaleaboracay.com`) are **not** touched until the owner approves.

| Fact | Baguio staging | Boracay staging |
|---|---|---|
| WordPress | 7.1.4 | 7.1.4 |
| PHP | 8.1.34 | 8.1.34 |
| Theme | Azalea Baguio Child (GeneratePress) | Azalea Boracay Child (GeneratePress) |
| Page tools | GenerateBlocks (+Pro), GP Premium, Smart Slider 3 | same |
| Forms | Fluent Forms 6.2 | Fluent Forms 6.2 |
| SEO and tracking | Yoast, Meta Pixel, PixelYourSite, Clarity | Yoast, PixelYourSite, Clarity |
| Backups | UpdraftPlus 1.26 | UpdraftPlus 1.26 |
| Security | Wordfence installed, **inactive** | Wordfence **inactive**, WP Rocket **inactive** |
| Data-modelling plugin (ACF, Pods, etc.) | none | none |
| Connector user | WP user 1 | WP user 2 |


**Where staging really lives (checked through the connectors).** The staging sites are folders inside the live domains, each with its own database and search-engine indexing off:

| Site | Staging URL | Files | Database |
|---|---|---|---|
| Baguio | `https://azaleabaguio.com/staging2-baguio` | `/home/azalea9/public_html/azaleabaguio/staging2-baguio/` | `azalea9_wp53` |
| Boracay | `https://azaleaboracay.com/staging2` | `/home/azalea9/public_html/staging2/` | `azalea9_wp768` |

Because cPanel sets PHP **per domain**, changing PHP for `azaleabaguio.com` or `azaleaboracay.com` changes the live site and its staging folder together. The cPanel entries `staging.azaleabaguio.com` and `staging.azaleaboracay.com` are separate domains and do not affect these staging folders. To test a new PHP version on staging alone, point one of those staging subdomains at the staging folder (or accept a short, backed-up switch of the live domain with an instant rollback). The plugin's `/helpdesk/` URL on staging is therefore `.../staging2-baguio/helpdesk/` and `.../staging2/helpdesk/`.

**Consequences for the design**
- No ACF or similar owns data, so the plugin may register its own tables and types.
- **PHP 8.1 is end-of-life** and the connector reports a PHP security advisory (2026-10-21) that affects PHP itself, not WordPress. The plugin must run on 8.1 (the installed version) and be tested on 8.3. The owner should ask the host to move both sites to a supported PHP. This is a host task, not part of this build.
- Wordfence is installed but off, and WP Rocket (Boracay) is off. If either is switched on before launch, exclude `/helpdesk/` and `/wp-json/azl-ehd/` from page caching and from any firewall rule that blocks REST.
- Take an UpdraftPlus backup before the first activation on each site.
- The Novamira plugin itself must never be modified, deactivated or removed.

## 3. Architecture

```
Staff phone / front-desk PC
   |  https://azalea...com/helpdesk/        (login required)
   v
Plugin route  ->  static React desk (assets/desk/)
   |  fetch, cookie auth + X-WP-Nonce
   v
REST  /wp-json/azl-ehd/v1/{snapshot, command, poll, pin/..., staff/...}
   |
   v
PHP services (rules, SLA, routing, idempotency)  ->  $wpdb  ->  azl_* tables (same site database)
```

- **One plugin, two installs.** Folder `azalea-ehelpdesk/`, text domain `azl-ehd`, table prefix `{$wpdb->prefix}azl_`. A site setting names its property ("Azalea Baguio") and its room list.
- **Front-end route.** The plugin adds a rewrite for `/helpdesk/` that renders only the app shell (no theme header or footer), after a login check. wp-admin gets a small "E-Help Desk" menu for settings, staff, and reports. A shortcode is not used.
- **Live updates.** WordPress has no websockets. The desk polls `GET /poll?since=<seq>` every 5 seconds while open, using a cheap indexed query and an ETag so an unchanged desk costs almost nothing. Offline behaviour is the existing outbox (idempotent op ids).
- **No theme or plugin coupling.** The plugin does not edit the theme, Fluent Forms or any other plugin's data.

### 3.1 Data model: custom tables, and why not post types

WordPress guidance prefers post types and meta. They are insufficient here, so the plugin uses its own tables, created and upgraded with `dbDelta` and a stored `azl_db_version`:

| Need | Why a post type is wrong |
|---|---|
| Append-only audit log | Posts are editable and deletable by design. |
| Idempotent commands (op id unique) | No unique constraint on post meta. |
| "Open and overdue" and per-department queues | Meta queries are slow and unindexed at shift-change volumes. |
| Atomic ticket numbers (`REQ-0123`) | Needs a counter row with a lock. |

Tables (one install is one property): `azl_requests`, `azl_items`, `azl_work_orders`, `azl_clean_tasks`, `azl_incidents`, `azl_handovers`, `azl_events` (append-only, unique on op id + entity + what), `azl_staff`, `azl_seq` (ticket counters). Every changeable table has `created_at` and `updated_at`. Settings use the Options API (`azl_settings`). Incident and ticket records are **kept forever**, matching the owner's retention decision of 2026-10-29.

### 3.2 Accounts and roles

| Who | How they sign in | Can do |
|---|---|---|
| Owner / group manager | Their own WordPress account (role `azl_manager` or WP Administrator) | Everything, settings, staff admin, reports |
| Manager / supervisor | Own WP account (`azl_supervisor`) | Run the desk, assign, assess work orders, no settings |
| Shared phone (front desk, housekeeping) | One WP account per device (`azl_device`), kept signed in | Open the desk; every action needs a staff PIN |
| Staff (HDO, housekeeper, engineer) | Pick name, enter PIN on the shared phone. They need no WP account | Only their own work queue and actions |

- Staff live in `azl_staff` (optional `wp_user_id` link for managers). PINs are stored with `password_hash`, never reversible.
- PIN rules carried over from the Neon build: 4 digits, weak PINs refused, 5 wrong tries lock that person for 15 minutes, a wrong-PIN answer is identical for unknown and locked people, lockout counters are per person, never per device.
- After a correct PIN the server returns a signed, short-lived "acting staff" token (HMAC with a site secret, 12 hours, bound to the WP session). Every command records who acted; commands without a valid acting staff from a device account are refused.
- Staff-per-property scoping is unnecessary: each site is one property.

### 3.3 REST API (namespace `azl-ehd/v1`)

| Route | Purpose |
|---|---|
| `GET /snapshot` | Everything the desk shows for this property (same shape as the prototype's snapshot) |
| `POST /command` | One command from the contract (log request, relay, ack, hold, done, escalate, assess work order, raise safety, record 911, handover, and so on), validated, idempotent by op id |
| `GET /poll?since=` | Cheap "has anything changed" check, returns the new sequence or the changes |
| `POST /pin/sign-in`, `POST /pin/sign-out` | Staff PIN session |
| `POST /staff`, `PATCH /staff/<id>` | Manager-only staff admin, set PIN, deactivate |

Rules for every route: cookie authentication plus the `X-WP-Nonce` header, a capability check first (`azl_use_desk`, `azl_manage_staff`, `azl_manage_settings`), input validated and sanitised, SQL only through `$wpdb->prepare`, JSON errors with a user-safe message, no stack traces. Responses are never cached (`Cache-Control: no-store`).

### 3.4 Safety lane (unchanged rules, from brief section 6)

Smoke, fire, gas and flood reports raise a safety incident, merge repeat reports from other rooms into the open incident, and show a one-tap "BFP/911 called" record that can be set once. The call is shown by the staff member's name ("a manager" when a manager account recorded it). The app never replaces calling 911 or the radio. This lane is excluded from any rate limiting, polling back-off or alert budget.

## 4. Build phases

| # | What | Done when |
|---|---|---|
| **P0 Prototype (this sprint)** | Plugin on **both staging sites**: tables, REST, roles, the React desk served at `/helpdesk/`, PIN sign-in, request logging, routing to departments, status changes, work orders, safety lane, handover, polling | A tester logs a request on one phone and sees it on another within 10 seconds; a Wi-Fi drop queues and reconciles with no duplicates; a Boracay request never appears on Baguio |
| P1 Pilot | Choose pilot property, seed real staff and rooms, shadow mode (brief section 5 Phase 0) | One week of real use beside the radio, HDO logs a common request faster than a radio call |
| P2 Integrity and reports | Resolution integrity and recovery (brief 4.8), manager one-glance view, reports, email alerts through `wp_mail`, web push | Brief Phase 2 acceptance |
| P3 Group and extras | Group view across both hotels (signed REST between sites), guest QR request form (Fluent Forms or a plugin form), PMS pull, photos | Brief Phase 3 acceptance |

Staging first, always. Production activation needs the owner's written go-ahead per site.

## 5. Security and privacy

- Capability checks on every route; nonces on every state change; output escaped; inputs sanitised.
- No guest personal data beyond room number and an optional name in the remark. No payment, no ID data.
- The log of who did what is append-only in the database. The plugin offers no delete route for it.
- Secrets: the signing key is generated on activation and stored in the options table, never in the bundle. No credentials in the repo.
- Brute force: PIN lockout as above, plus WordPress's own login protections. If Wordfence is enabled later, allow-list the REST namespace for logged-in users.
- Uninstall keeps all data by default. A setting "delete all help desk data on uninstall" exists and is off.
- Backups: UpdraftPlus already covers the database. Take one before each activation.
- Updates: the plugin version and `azl_db_version` are separate. A failed upgrade leaves the previous version running (upgrades are idempotent `dbDelta`).

## 6. Deploying with Novamira

Staging only. Novamira exposes `write-file` (PHP only inside `wp-content/novamira-sandbox/`), `create-upload-link` (zips and binaries), `run-wp-cli`, `execute-php` and `read-file`.

1. Build the plugin zip locally (`npm run build:wp` then zip `azalea-ehelpdesk/`).
2. Back up with UpdraftPlus (wp-admin), or note the existing backup time.
3. Create an upload link, upload the zip, unzip into `wp-content/plugins/`, then `wp plugin activate azalea-ehelpdesk` through `run-wp-cli`.
4. Visit `/helpdesk/` signed in, run the smoke checklist (section 7), record the result in `docs/ORCHESTRATION.md`.
5. Roll back by `wp plugin deactivate azalea-ehelpdesk`. Data stays.

Never modify, deactivate or delete the Novamira plugin or revoke the connector user's application passwords.

## 7. Test plan

- **Rules in PHP:** plain-PHP tests per service (routing, SLA clock including hold, safety merge, idempotency, PIN lockout) that run without WordPress, using a stubbed `$wpdb` or SQLite where possible.
- **REST on staging:** a smoke script of authenticated calls: snapshot, log a request, replay the same op id (no duplicate), forbidden role, wrong PIN, lockout.
- **Two-browser check:** two phones on one site see each other's changes; two sites never see each other's data.
- **Offline check:** go offline, log three requests, reconnect, all three arrive once.
- **Caching check:** with a cache plugin on, `/helpdesk/` and `/wp-json/azl-ehd/` are never cached.
- **Syntax and standards:** `php -l` on 8.1 and 8.3, WordPress Coding Standards where available.

## 8. Risks and open decisions

| # | Item | Owner |
|---|---|---|
| 1 | PHP 8.1 is end-of-life and the host may not have patched it | Ask the host for a supported PHP |
| 2 | Which property pilots first (Boracay or Baguio) | Azalea / OCS |
| 3 | Polling load on shared hosting (5 s per open desk) | Measure in P0; fall back to 10 to 15 s |
| 4 | Staff phones: hotel-issued shared phones or personal ones | Azalea |
| 5 | Booking system / PMS for later room and guest data | Azalea |
| 6 | Safety-alert wording review | Azalea safety lead |
| 7 | Go-ahead to activate on the live sites | Owner |
| 8 | Group view across the two hotels: build in P3 or earlier | Owner |

## 9. Repository layout

```
azalea-ehelpdesk/            WordPress plugin (the deliverable)
  azalea-ehelpdesk.php        header, activation, route, enqueue
  includes/                   Rest.php, Schema.php, Rules.php, Staff.php, Commands/*.php, Snapshot.php
  assets/desk/                built React desk (committed build output)
  uninstall.php
src/                          React desk source (unchanged screens and domain)
src/wp/                       WordPress adapter for the store (REST + nonce)
docs/WORDPRESS-PLAN.md        this file
```

## 10. Definition of done for the prototype

1. The plugin installs and activates on both staging sites without errors or PHP notices.
2. `/helpdesk/` shows the desk to a signed-in manager; a signed-out visitor is sent to the login page.
3. A request logged on phone A appears on phone B within 10 seconds, with the right department and ticket number.
4. Status changes, work-order escalation, the safety lane, and handover sign-off work and survive a reload.
5. A replayed command does not duplicate anything. A wrong role is refused. Five wrong PINs lock a person.
6. Nothing from one site appears on the other.
7. Deactivating the plugin leaves the sites working as before.


## 11. Prototype status (2026-10-30)

**Installed and running on both staging sites** (plugin 0.1.1, PHP 8.3.36 after the owner's cPanel switch): `https://azaleabaguio.com/staging2-baguio/helpdesk/` and `https://azaleaboracay.com/staging2/helpdesk/`. Live sites are untouched.

Verified on the real staging MySQL: tables and roles created; staff and PIN sign-in, wrong-PIN answers identical, lockout after five tries; request logging with gap-free ticket numbers; the same command sent twice changes nothing; relay and finish; smoke reports from two rooms merge into one incident; the 911 call records once; handover sign-off; poll counter; a browser session (cookie + nonce) logs a request that is routed to the right department; the two sites show no data from each other.

**Findings that changed the plan**
- Staging is a folder inside each live domain (own database, search indexing off). cPanel sets PHP per domain, so the PHP move applied to live and staging together. All four sites were checked after the switch: home pages load, no fatal errors, plugin counts unchanged.
- The live sites are not copies of staging: live uses `GeneratePress Child 0.1` and has Wordfence active; staging uses the newer child theme (2.0.0) and has Fluent Forms. Before going live, test the plugin with Wordfence on.
- The host's ModSecurity blocked file uploads and page requests from command-line tools (HTTP 406) until the owner turned it off. **Turn it back on** and confirm the plugin still works: browser sessions are not affected, but uploads of new versions will need it off again or a manual wp-admin upload.
- The host caches PHP files for 90 seconds, so a freshly uploaded version takes up to 90 seconds to take effect.
- The install zips remain in `wp-content/uploads/azl-ehd-upload/` on both staging sites and are publicly downloadable. Delete them (cPanel File Manager) or block that folder; the connector cannot write an `.htaccess`.
- Test data on staging: Baguio has 3 test staff ("Test HDO", "Test Housekeeper", "Test Locked"), 2 requests, 1 safety incident and 1 handover; Boracay has 1 test staff and 1 request. The plugin has no delete route for the audit log by design.

**Known limitations and next steps**
1. A command queued while offline is credited to whoever is signed in with a PIN when it finally sends.
2. The desk drops a command that arrives without a valid PIN and shows the server's message (the backend note says keep it queued: decide).
3. No device-wide PIN limit: someone can try one PIN against every person (per-person lockout only).
4. All writes lock one counter row, so heavy simultaneous use queues; a deadlock returns an error and resending is safe. Measure on real use.
5. WordPress sessions last 24 hours, then the desk shows a sign-in prompt.
6. The bundle is 198 KB compressed; most of it is the icon set.
7. Run the SQL checks listed in the backend report on the real database under concurrent load (two phones on one op id, two 911 taps at once).
8. P1: choose the pilot property, seed real staff and rooms, add `/helpdesk/` to the staff phones' home screens, shadow mode beside the radio.

## 12. Version 0.2 (2026-10-30): clean repo, hotel design, roles, secure login

**Repo cleanup.** The retired Next.js, Neon and Vercel code, the database migrations, the frozen prototype and the demo-only screens (Cover, Network simulator, Guided demo) were deleted. The repo is now `azalea-ehelpdesk/` (plugin), `src/` (the React desk plus `src/wp` adapter), `scripts/`, `docs/`. Run `npm test`, `npm run build:wp`, `npm run zip:wp`, `php azalea-ehelpdesk/tests/run.php`. Shared command and snapshot types live in `src/domain/contract.ts`. `npm run mock:wp` serves the desk with fake data at `http://localhost:8787/helpdesk/?role=owner&hotel=baguio` for UI work without WordPress.

**Each hotel's own design, light theme only.** The plugin picks Baguio ("Pine & Lamplight": forest green on oatmeal, gold only as small tags) or Boracay (teal on warm cream) from the setting "Look" (auto-detected from the site address) and injects 25 CSS variables (`--azl-*`) into the desk and login pages. Headings are Amaranth 400, body Figtree, both bundled as local font files (no external requests). Pill buttons 48 px, cards 16 px, inputs 8 px. Dark mode is removed. A test checks the colour pairs for WCAG AA.

**Roles (WordPress users, no wp-admin for hotel staff).**

| Role | Desk | Staff (PINs) | Logins (accounts) | wp-admin |
|---|---|---|---|---|
| WordPress administrator (agency) | all | yes | yes | yes |
| Hotel Owner (`azl_owner`) | all | yes | yes | **no** |
| Manager (`azl_manager`) | all | yes | no | **no** |
| Supervisor (`azl_supervisor`) | Requests, Work orders, Housekeeping, Handover, Insights | no | no | **no** |
| Shared phone (`azl_device`) | four tabs, every action needs a staff PIN | no | no | **no** |

Hotel roles hold no WordPress capabilities at all (checked on the live staging sites), wp-admin redirects them to the desk, the admin bar is hidden, and any login lands on `/helpdesk/`. The agency creates the first Hotel Owner in wp-admin (Users, Add New, role "Hotel Owner"). After that the owner adds managers, supervisors and shared phones inside the desk (Settings, Logins): the person gets an email to set a password. Accounts can be disabled, never deleted.

**Login at `/helpdesk/login/`.** A branded page per hotel (no theme chrome), with forgot-password and reset pages. Security: a signed, expiring CSRF token; the same generic message for unknown user, wrong password, disabled account and no desk access; lockout after 5 failures per account and address for 15 minutes and 20 per address per hour (HTTP 429 with Retry-After); throttled reset requests that always answer the same; same-site redirects only; session lengths (owner, manager, supervisor 7 days or 12 hours; shared phone 30 days); strict Content-Security-Policy with a per-request nonce, no framing, no sniffing, no caching. REST: `auth/login`, `auth/logout`, `auth/forgot`, `auth/reset`, `accounts`.

**Verified on both staging sites (plugin 0.2.x, PHP 8.3):** both login pages in the right palette and logo; wrong logins answer identically and the fifth is locked; the four roles' capabilities; the desk in the hotel's colours with the real "Online" chip, empty states and role label; Settings with the Logins section. Not yet exercised with a real non-admin account (the connector user is an administrator): sign in as an owner and confirm wp-admin redirects to the desk, and that the reset email arrives from the host.

**Still open.** The marketing plugins on the sites set a tracking cookie on `/helpdesk/` (the page loads none of their scripts, but exclude `/helpdesk/` in PixelYourSite and Clarity); an owner whose phone is shared signs out other phones using the same account; no CAPTCHA (lockouts only); property name and room list are edited by the agency in wp-admin (Settings, E-Help Desk).

**Customising lists (0.3.0).** Departments, request types, bundles, hold reasons, job titles and work-order findings are each hotel's own lists, edited by the owner and managers in Settings, Lists (capability `azl_manage_lists`; supervisors and shared phones only read them). They live in one option, `azl_catalog` (JSON with a `catalogRev`), seeded from the old constants, and travel inside every snapshot, so phones pick up a change on their next poll. Keys are made from the name and never change; names, short codes, targets, icons, departments, order and the active flag can. A department or hold reason that any person, request item or work order uses cannot be deleted, only archived: it disappears from new choices while old records keep showing its name. Each department has a "Handles repairs" switch (`repairs`; on for Engineering and IT at first, off for new departments): only on-site items of an active department with it can be escalated to a work order. Work orders already open carry on if their department is renamed, archived or loses the switch, and while any is open one active department must keep it. At least one department and one hold reason stay active, and an active request type or bundle must use an active department. A save replaces one whole list and is refused (`azl_stale`) when someone else saved since the editor loaded; the editor then reloads and says so. Statuses, staff roles, work-order priority and lifecycle (work orders take the department of the item they came from; there is no separate department picker), safety hazards and their trigger words, and cleaning statuses stay fixed because the desk's logic depends on them.
