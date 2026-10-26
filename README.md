# E-Help Desk

Hotel service-request and maintenance desk, built as multi-tenant SaaS. Azalea Hotels is the pilot tenant.

- `docs/PLAN.md` — current build plan and stack decisions
- `docs/ORCHESTRATION.md` — how the work is run (Jev routing, sprints, skills). Draft
- `src/` — the Next.js app: the demo at `/` (in-memory data), plus `/sign-in` and `/dashboard` (Neon Auth, tenant data). `npm install`, then `npm run dev`, `npm test`, `npm run lint`, `npm run build`
- `db/` — SQL migrations, seed, and `apply.mjs` / `verify-neon.mjs` for a real Neon branch. Needs `DATABASE_URL` (owner), `APP_DATABASE_URL` (app_user), `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` in `.env.local` or the Vercel project. Never commit these.
- `docs/` — build brief, stack matrix, Phase 1a plan, built prototype (`azalea-ehelpdesk-prototype.html`)
- `prototype/` — Vite + React source of the prototype (`npm install && npm run dev`)
