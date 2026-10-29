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
5. Open `/helpdesk/` signed in as a manager. A signed-out visitor is sent to the login page; a signed-in user
   without the `azl_use_desk` capability sees a "No access" page.

If `/helpdesk/` shows the site's 404 page, visit wp-admin > Settings > Permalinks and press Save once.
With plain permalinks the desk is at `/?azl_helpdesk=1`.

**Caching and firewalls.** The desk page sends `Cache-Control: no-store` and defines `DONOTCACHEPAGE`. If WP Rocket,
another page cache, or Wordfence is switched on, also exclude `/helpdesk/` and `/wp-json/azl-ehd/` from page
caching and from any rule that blocks the REST API for signed-in users.

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
