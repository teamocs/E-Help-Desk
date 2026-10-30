# Mock modules

Each `scripts/mock/<id>.mjs` extends the sample server for one module. Default export:

```js
export default {
  id: "inquiries",                                  // snapshot.modules.inquiries
  commandModule: { logInquiry: "inquiries" },        // which module a command belongs to (access checks)
  commands: { logInquiry: (c, x) => { /* change x.db; return { ok:false, error } to refuse */ } },
  snapshot: (x) => ({ items: x.db.inquiries ?? [] }), // x = { db, staff, catalog, ev, role }
};
```
Optional `routes` answer extra REST reads under `/wp-json/azl-ehd/v1`:

```js
routes: {
  "GET /reports/<id>": (url, x) => ({ ok: true }),            // JSON, 200; <name> matches one path segment
  // or { status: 403, data: {...} } for another status, or { status, headers, raw } for a non-JSON body (CSV)
},
```
`x` adds `role`, `actor`, `level(moduleId)` (the viewer's level from the role matrix) and `body()` (a promise of the JSON body, for PUT and POST) to the usual fields; a handler may be async.

Optional `catalog: (cat) => cat` adds lists and their definitions to the hotel's lists at start (config.mjs: the module lists and `catalog.defs`), and `usage: ({ db, catalog }) => ({ list: { key: n } })` counts records that use a module list's keys (`usage.lists`).

Seed your sample data on `x.db` lazily inside `snapshot`/`commands`, or at import time through a shared `db` export if you need it.
