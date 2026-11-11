# Desk modules

The sidebar, the phone bar, the More sheet and the routing all come from `registry.ts`. One module = one folder.

## Add or build a module (client)

1. Create `src/modules/<id>/index.tsx` exporting a `ModuleDef` as default (`types.ts`): `id` (the server's id), `label` (the prototype's), `icon` (from `src/ui/icons.ts`; new ones go in `scripts/icons.mjs`, then `npm run icons`), `badge(state)`, `Screen: lazyScreen(() => import('./MyScreen').then((m) => m.MyScreen))`, `phoneTab` (only the four bottom tabs).
2. The 11 sidebar modules each have a folder with their screen. A brand-new id is the one line to add to the `MODULES` array in `registry.ts`.
3. Your data: `moduleData(state, '<id>')`, typed by adding `declare module '../../domain/store' { interface ModuleSlices { <id>: MySlice } }` in your own file.
4. Your actions: `runModuleCommand('<id>', 'myCommand', { recordId: crypto.randomUUID(), ... }, optimisticUpdate)`. It goes through the offline outbox with a fresh opId, like every built-in command.
5. Who sees it comes from the server's role matrix (`window.AZL.access`, copy in `access.ts`); never hard-code roles in a screen.

## Server side (PHP)

Create `azalea-ehelpdesk/includes/Modules/<Id>.php` with a class extending `Azl_Module` (see `includes/Modules.php`): `id()`, `schema()` (CREATE TABLE only), `sequences()`, `commands()` (each: `run`, optional `validate`, `ids`, `need`, `scope`, `prior`), `snapshot($who)`, `catalogLists()`, and end the file with `Azl_Modules::register( new ... )`. Progress notes go in `Azl_Updates::add()`. Tables appear on the next request; bump `version()` when you change them. Tests: copy `azalea-ehelpdesk/tests/fixtures/ExampleModule.php` and `tests/cases/modules.php`.

## Status rules (state machines)
Every record's allowed status changes live in one table: command => [from statuses, to status]. The server enforces it; the desk mirrors it for buttons and optimistic changes; a test fails when the two differ. To change a rule, edit both tables, then run `npm test` and `php azalea-ehelpdesk/tests/run.php`. Do not add a status check as a loose `if`.

| Record | Server (enforces) | Desk (mirror) | Parity test |
|---|---|---|---|
| Request items | `Azl_Commands::ITEM_STEPS` (undo: `undo_target`) | `ITEM_STEPS`, `undoTarget` in `src/domain/rules.ts` | `src/modules/transitions.test.ts` |
| Work orders | `Azl_Module_WorkOrders::TRANSITIONS` | `src/modules/workorders/model.ts` | `workorders.test.tsx` |
| Cleaning | `Azl_Module_Cleaning::TRANSITIONS` | `src/modules/cleaning/model.ts` | `workorders.test.tsx` |
| Transport | `Azl_Module_Transport::TRANSITIONS` | `src/modules/transport/model.ts` | `transitions.test.ts` |
| Inquiries | `Azl_Module_Inquiries::TRANSITIONS` | `src/modules/inquiries/data.ts` | `transitions.test.ts` |
| House Status | `Azl_Module_HouseStatus::TRANSITIONS` | `src/modules/housestatus/model.ts` | `transitions.test.ts` |
| Crisis cases | `Azl_Module_Crisis::TRANSITIONS` | `src/modules/crisis/model.ts` | `transitions.test.ts` |

Not tabled (one step each, or not status-driven): Reminders (pending to completed), safety alerts (active, downgraded, resolved), item closing and transfer (`finish`, `transfer`, `escalate` in `Commands.php`).
