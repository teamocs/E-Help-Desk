# Azalea e-Helpdesk

Hotel service-request and maintenance desk, shipped as a WordPress plugin for the two Azalea sites. The plugin (`azalea-ehelpdesk/`) is a PHP REST backend that serves a React desk built from `src/`.

## Layout

- `azalea-ehelpdesk/` — the plugin: PHP (`includes/`, `tests/`) and the built desk in `assets/desk/` (generated, committed).
- `src/` — the React desk: `screens/`, `ui/`, `domain/` (store, rules, command contract), `wp/` (REST client, poller, WordPress shell), `styles.css`.
- `scripts/` — `zip-wp.mjs` (package the plugin to `dist/`), `lint-php.mjs`.
- `docs/` — plans and history. `WORDPRESS-PLAN.md` is current; the rest describes the retired Next.js/Neon build.

## Commands

- `npm install`
- `npm test` — vitest on `src/`
- `npm run lint`, `npx tsc --noEmit`
- `npm run build:wp` — bundle the desk into `azalea-ehelpdesk/assets/desk/` (`npm run dev:wp` rebuilds on change)
- `npm run zip:wp` — build the installable zip in `dist/`
- `php azalea-ehelpdesk/tests/run.php` — PHP tests

Deploying to the sites: see `docs/WORDPRESS-PLAN.md` section 6.
