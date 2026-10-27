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

- **"Back to the manager account" has no PIN.** The signed-in owner or manager account is the trust root of a shared phone, so anyone holding it can drop out of staff mode and change staff. The fix is separate, restricted device accounts (a device role with no staff management), not more PINs.
- **Acting-staff cookie is bound to one property.** If an org gets a second property, a command for another property is recorded without a named person until property switching sets the cookie per property.
- **A PIN reset or removal does not end a staff session already open** (up to 10 hours); removal is enforced on the next command because the person must still be active, a reset is not.
- **PINs are four digits.** If the database and the auth secret both leak, all 10,000 values can be recovered. Rotating `NEON_AUTH_COOKIE_SECRET` invalidates every PIN and staff session; a manager resets them.
