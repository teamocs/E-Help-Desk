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
Seed your sample data on `x.db` lazily inside `snapshot`/`commands`, or at import time through a shared `db` export if you need it.
