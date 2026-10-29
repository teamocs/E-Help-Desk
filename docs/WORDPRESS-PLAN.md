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
