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
