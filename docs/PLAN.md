# E-Help Desk: SaaS build plan

**Date:** 2026-10-22. **Supersedes** the stack choices in `azalea-ehelpdesk-stack-matrix.md` and `azalea-ehelpdesk-spike-and-phase1a.md` (Supabase, edge node, Android shell). Those docs stay as background.
**Pilot tenant:** Azalea Hotels. **First user:** teamocsph@gmail.com (owner).

## Decisions (Jev-scored, all "act" ≥ 0.92 unless noted)

| Topic | Decision | Why |
|---|---|---|
| Framework | Next.js App Router, at the repo root | Vercel + Neon Auth are first-class there. One deploy, no separate backend. |
| Database | Neon Postgres, plain SQL migrations in `db/migrations/*.sql`, `@neondatabase/serverless` `sql` tag | No ORM. Types already exist in `prototype/src/domain/types.ts`; reuse them. |
| Tenancy | One schema, `org_id` on every table, Postgres RLS | Simplest model that is real isolation. Per-tenant DBs only if a client contract demands it. |
| Auth | Neon Auth for owner/manager email login. Staff use a 4-digit PIN on a device already signed in to the org (`staff.pin_hash`). | Matches the prototype's Lock screen. No Clerk, no hand-rolled sessions. |
| Repo layout | `docs/` specs, `prototype/` frozen reference, Next.js app at root (Phase 1) | Jev abstained (0.45); my call. Keeps Vercel zero-config once the app lands. |

## Tenant model

`orgs` (Azalea Hotels) → `properties` (Boracay, Baguio) → `staff` (name, role, dept, pin_hash) and `members` (Neon Auth user ↔ org, role owner/manager).
Domain tables, straight from `types.ts`, each with `org_id` + `property_id`: `requests`, `items`, `work_orders`, `clean_tasks`, `incidents`, and one `events` table (replaces the per-row `events[]` / `audit[]` / `log[]` arrays, append-only).

## Phases

| # | What | Done when | ECC skills | Model |
|---|---|---|---|---|
| 0 | Repo cleanup, git, GitHub remote | Pushed to `teamocs/E-Help-Desk` | git-workflow | — |
| 1 | Scaffold Next.js at root, port `prototype/src` screens/ui/lib/styles as client components, keep in-memory store | Deployed on Vercel, looks identical to prototype, 23 store tests pass | nextjs-turbopack, react-patterns, vite-patterns (for the port) | Sonnet (mechanical) |
| 2 | Neon schema + RLS + Neon Auth; seed Azalea org, properties and the owner user | teamocsph@gmail.com can sign in and sees only Azalea data | database-migrations, postgres-patterns, security-review; database-reviewer agent | Opus |
| 3 | Swap store actions (`logRequest`, `relay`, `escalate`, `assessWo`, …) for server actions; store becomes an optimistic client cache | Two browsers see the same tickets after refresh | backend-patterns, api-design, tdd-workflow (port existing tests) | Opus for actions, Sonnet for wiring |
| 4 | Live updates (Neon realtime or polling) + device outbox (IndexedDB queue, idempotent op ids) | A3 from the brief: Wi-Fi drop queues and reconciles, no duplicates | verification-loop, e2e-testing | Opus |
| 5 | Self-serve onboarding for tenant #2 (create org, invite manager) | A second org signs up without SQL | security-review | Sonnet |

## Skipped on purpose

- **CI/CD:** none. Vercel's git deploy is enough. Add a test step when a second developer joins.
- **Billing (Stripe):** add when tenant #2 is paying.
- **Edge node, Android shell, LAN sync:** the Resilient tier. Revisit after the pilot proves the cloud loop.
- **Photos, voice-to-text, PMS integration:** as in the Phase 1a doc, later.
- **The Network simulator screen:** demo-only. Kept behind a demo flag, not wired to real data.

## Still open (from the brief, needs Azalea/OCS)

Pilot property (Boracay or Baguio), booking system, staff phones (issued or personal), and the safety-lane wording review.
