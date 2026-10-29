# Azalea e-Helpdesk (WordPress plugin)

Live service-request, maintenance and safety desk for one hotel, served at `https://<site>/helpdesk/`.
One install is one property. Requires WordPress 6.4+ and PHP 8.1+.

## Build the zip (developer machine)

```
npm ci
npm run build:wp     # React desk -> azalea-ehelpdesk/assets/desk/ (+ manifest.json)
npm run lint:php     # php -l on every plugin file (PHP=/path/to/php8.1 to test 8.1)
npm run zip:wp       # -> dist/azalea-ehelpdesk-<version>.zip (plugin folder only)
```

## Install and activate (staging first, always)

1. Take an UpdraftPlus backup (or note the time of the latest one).
2. Install the zip: wp-admin > Plugins > Add New > Upload, or upload and unzip into `wp-content/plugins/`
   (Novamira `create-upload-link`), or `wp plugin install dist/azalea-ehelpdesk-<version>.zip`.
3. Activate: wp-admin > Plugins, or `wp plugin activate azalea-ehelpdesk`.
   Activation creates the `azl_*` tables, the help desk roles and capabilities, and the `/helpdesk/` address.
4. wp-admin > E-Help Desk > Settings: set the property name and the room list, then save.
5. Open `/helpdesk/`. A signed-out visitor is sent to `/helpdesk/login/`; a signed-in user without the
   `azl_use_desk` capability sees a "No access" page.

If `/helpdesk/` shows the site's 404 page, visit wp-admin > Settings > Permalinks and press Save once.
With plain permalinks the desk is at `/?azl_helpdesk=1`.

**Caching and firewalls.** The desk page sends `Cache-Control: no-store` and defines `DONOTCACHEPAGE`. If WP Rocket,
another page cache, or Wordfence is switched on, also exclude `/helpdesk/` and `/wp-json/azl-ehd/` from page
caching and from any rule that blocks the REST API for signed-in users.

## Accounts, roles and sign-in

| Role | Label | Desk role | Capabilities |
|---|---|---|---|
| `azl_owner` | Hotel Owner | owner | use desk, act directly, manage staff, manage accounts |
| `azl_manager` | Manager | manager | use desk, act directly, manage staff |
| `azl_supervisor` | Supervisor | supervisor | use desk, act directly |
| `azl_device` | Shared phone | device | use desk (every action needs a staff PIN) |
| administrator | (WordPress) | owner | every `azl_*` capability; the only accounts that use wp-admin |

- Desk roles hold no core WordPress capability (`read` is stored as false). Signed-in desk accounts are sent from
  wp-admin to the desk (admin-ajax.php and admin-post.php stay open), get no admin bar, and land on the desk after
  any sign-in, wp-login.php included. Roles are re-applied once per `Azl_Caps::ROLES_VERSION` (option
  `azl_roles_version`); users keep their roles.
- Sign-in pages: `/helpdesk/login/`, `/helpdesk/forgot/`, `/helpdesk/reset/` (plain permalinks: `/?azl_auth=login`).
  Signed-out visitors to anything under `/helpdesk/` go to the login page with a checked `redirect_to`.
- REST (namespace `azl-ehd/v1`): `POST auth/login`, `POST auth/logout` (X-WP-Nonce), `POST auth/forgot`,
  `POST auth/reset`; `GET|POST accounts`, `PATCH accounts/<id>` (owners and administrators only; no delete).
- Limits: 5 failed sign-ins per account and address lock that pair for 15 minutes; 20 per address in an hour lock the
  address for an hour; forgot and reset: 3 per hour per email/account and per address. Answers 429 with Retry-After.
- Behind a reverse proxy or CDN only: `wp option update azl_trust_proxy_headers 1` makes the limits use the
  right-most `X-Forwarded-For` address. Leave it off otherwise (a client can forge that header).
- Sessions: shared phones 30 days; people 7 days with "Keep me signed in", else 12 hours.
- Every `/helpdesk/` page sends a nonce-based Content-Security-Policy, `X-Frame-Options: DENY`, `no-store` and
  `DONOTCACHEPAGE`. If Wordfence or a security plugin blocks the REST API for signed-out visitors, allow
  `/wp-json/azl-ehd/v1/auth/` or nobody can sign in.
- Look: E-Help Desk > Settings > Look picks the Baguio or Boracay design (default: detected from the site address).
  Fonts (Amaranth, Figtree; SIL OFL, see `assets/fonts/OFL.txt`) are served from the plugin.

## Update

Install the new zip over the old one (wp-admin offers "Replace current with uploaded"), or
`wp plugin install <zip> --force`. Table upgrades run on activation and are idempotent.

## Roll back

- **Switch it off:** `wp plugin deactivate azalea-ehelpdesk` (or wp-admin > Plugins > Deactivate).
  The site works as before; `/helpdesk/` stops answering; all data stays.
- **Go back a version:** deactivate, install the previous zip with `--force`, activate again.
- **Remove completely:** delete the plugin in wp-admin. Data is **kept** unless
  E-Help Desk > Settings > "Delete all help desk data when the plugin is deleted" was switched on first.
  If the database must go back, restore the UpdraftPlus backup taken in step 1.

Never modify, deactivate or remove the Novamira plugin while working on this one.
