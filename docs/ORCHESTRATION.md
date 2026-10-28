# How we build it: orchestration plan

**Status: DRAFT (AI-written, 2026-10-27).** Not a recorded decision until the owner approves it. Builds on `docs/PLAN.md`, which holds the stack and phase decisions. This file only says how the work is run.

## Layers

| Layer | Role |
|---|---|
| Jev (MCP) | Decision layer. Routes model tier per task and gives go/no-go verdicts. It judges only the evidence passed to it. It is not a fact-checker. |
| ponytail | Orchestrator. Read first, then climb the ladder (reuse, stdlib, native, existing dependency), then the smallest change plus one runnable check. |
| ECC agents and skills | Specialist workers per phase (below). |
| Frontend skills | Used only where UI changes. |

## Jev rule

- Confidence 0.8 or above: act.
- 0.5 to 0.8: act, then a reviewer checks the result.
- Below 0.5: move up one model tier, or ask the owner.
- Haiku is for seed data, READMEs and boilerplate tests. In the first routing run Jev picked Sonnet for every real engineering task.

## Sprints

| Sprint | Phase (see PLAN.md) | Jev routing | Worker | Done when |
|---|---|---|---|---|
| 1 | 0 and 1: repo, Next.js scaffold, port the prototype | Sonnet (0.94) | Sonnet. `nextjs-turbopack`, `react-patterns` | Looks identical, 23 tests pass, `impeccable detect` clean, then deployed on Vercel (needs approval) |
| 2 | 2: Neon schema, RLS, Neon Auth, seed | Sonnet (0.88) | Sonnet writes; `database-reviewer` and `security-reviewer` review RLS | Owner signs in and sees only Azalea data; a second test org sees none of it |
| 3 | 3: server actions replace the store | Abstain (0.38), so Opus | Opus. `tdd-workflow` ports the existing tests first | Two browsers show the same tickets after refresh |
| 4 | 4: live updates and offline outbox | Review (0.61), so Opus | Opus. `e2e-runner`, `verification-loop` | Dead-zone test passes with no duplicates |
| 5 | 5: tenant #2 onboarding | | Sonnet. `security-review` | A second org signs up without SQL |

## Frontend skills

- `/impeccable`: run `detect` after each UI batch, `polish` on the port. `prototype/DESIGN.md` stays the token source of truth.
- `/ecc:motion-advanced`: keep sheets, swipe rows and the sync indicator as in the prototype.
- `/gpt-taste`: only for the Phase 5 sign-up and marketing page. The operator app stays Apple-style.

## Gaps in PLAN.md to close

1. Row-level security is bypassed when server actions use one database role. Set the org inside each transaction (for example `set_config('app.org_id', ..., true)`) and test it with two orgs.
2. A 4-digit PIN needs lockout, rate limits and a per-device token.
3. Neon Realtime status is unconfirmed. Plan on polling first.
4. A sync engine, if added later, needs a direct (non-pooled) Neon connection.
5. The safety alert stays behind the legal review before any real hotel uses it.

## Approvals needed (outward-facing or paid)

Push to `teamocs/E-Help-Desk`, create the Neon project, create the Vercel project. Each is asked for when reached.

## Known limits after Sprint 6 (DRAFT)

- **"Back to the manager account" still has no PIN for owner and manager logins.** Sprint 7 added restricted device accounts: a shared phone signs in with its own `device` account, which cannot manage staff or invite anyone and has no manager mode, so every command needs a staff PIN. Use that on shared phones. An owner or manager who signs in on a shared phone with their own login can still drop to the manager account, so do not.
- **A device account needs a real mailbox** (for example frontdesk@yourhotel.com) because Neon Auth verifies the email by code. Anyone who can read that mailbox can sign in as the device account (but still needs staff PINs to act).
- **Acting-staff cookie is bound to one property.** If an org gets a second property, a command for another property is recorded without a named person until property switching sets the cookie per property.
- **A PIN reset or removal does not end a staff session already open** (up to 10 hours); removal is enforced on the next command because the person must still be active, a reset is not.
- **PINs are four digits.** If the database and the auth secret both leak, all 10,000 values can be recovered. Rotating `NEON_AUTH_COOKIE_SECRET` invalidates every PIN and staff session; a manager resets them.

## Invite codes for new hotels (Sprint 8, DRAFT)

Creating a hotel now needs an invite code from OCS (migration 0007). Anyone can still sign up, but they cannot create a hotel without a code.

1. After a hotel signs with OCS, an operator issues a code: `node --env-file=.env.neon-main db/issue-code.mjs --uses 1 --days 14 --note "Rose Hotel, Maria Cruz"`. Use `.env.neon-dev` for testing.
2. The script stores only a sha256 hash and prints the 160-bit code once. Send it to the owner through a private channel, such as a direct message or a phone call. Do not put it in shared email threads or tickets. If the code is lost, issue a new one.
3. The owner signs up, verifies their email and enters the hotel name, the property name and the code. A wrong, used or expired code all get the same refusal. Five wrong codes lock that user out of hotel creation for 15 minutes. The cap of 20 new hotels per hour still applies.
4. To withdraw a code before it is used, run `update signup_codes set uses_left = 0 where note = '...'` as the owner. `used_by_org` and `used_at` show which hotel used each code.

Still open: there is no CAPTCHA, and Neon Auth sign-up and email-code sending are not rate limited by us (Neon manages that). Spam accounts can still be created, but they cannot create hotels. Deploy migration 0007 and the new `createHotel` together, because the old five-argument `create_org` is dropped.

## Sprint 8: page structure, sign-up codes, handover (DRAFT)

- **Routing (Jev):** the page-structure work went to Sonnet (0.94); sign-up abuse controls and server-side handover went to Opus (0.98 and 1.0), run as parallel agents on separate files, then reviewed by `security-reviewer`.
- **Page frame:** sign-in, verification, hotel setup, the account dashboard, 404 and error pages all use `src/ui/frame.tsx` (brand header, skip link, `main` landmark, footer). Each route has its own page title. `/gpt-taste` was used only for the sign-in and sign-up panel, in the restrained Apple style (no GSAP or stock images): the operator app keeps the existing design system.
- **Dashboard per role:** `src/app/dashboard/Account.tsx` draws every state from one data object: owner (invite, revoke, "Right now" counts per property), manager (counts, leave), shared phone (how it works, one way into the desk), no hotel (setup form with a code), unverified (code entry). In development only, `/dev/owner`, `/dev/manager`, `/dev/device`, `/dev/empty`, `/dev/unverified` and `/dev/no-hotel` show them from fixture data. They return 404 in a production build.
- **Deploy order for this sprint:** migrations 0006 and 0007 go to production together with the app. 0007 drops the old five-argument `create_org`, so hotel creation fails briefly if the database and the app are out of step; everything else keeps working. No hotel can be created until OCS issues a code: `node --env-file=.env.neon-main db/issue-code.mjs --uses 1 --days 14 --note "Hotel name, owner"`.
- **Still open:** connect GitHub to Vercel (needs a GitHub Login Connection on the Teamocsph Vercel account, then `vercel git connect`), CAPTCHA or rate limit on Neon Auth sign-up itself, per-property staff scoping.

## Workflow (decided 2026-10-28, owner-approved)

- Work directly on `main`: no feature branches, worktrees or PRs. Only the owner and Claude work in this repo, and the project is not live yet.
- Every push to `main` deploys to production through the Vercel GitHub connection.
- Database migrations are the exception: apply them to production (`db/apply.mjs` with `.env.neon-main`) before pushing code that needs them. Dev branch first, then production.
- Still run `tsc`, lint, tests and build before pushing.
