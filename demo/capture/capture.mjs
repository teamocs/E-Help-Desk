// Repeatable screenshots of every Azalea e-Helpdesk feature + shots/manifest.json. See ../README.md.
// Usage: npm run capture            (all chapters)
//        npm run capture -- --only=B,C   (some chapters; later ones may need the earlier ones' data)
import { rmSync, mkdirSync } from 'node:fs';
import { OUT, launch, startMock, newPage, open, shot, chapter, state, writeManifest, C, L, T, digits, sleep, steps, act, scrollTo } from './lib.mjs';
import { chapters } from './chapters.mjs';
import { check } from './check.mjs';
import './scenes-desk.mjs';
import './scenes-more.mjs';
import './scenes-admin.mjs';
import './scenes-roles.mjs';

const ORDER = ['A', 'B', 'B2', 'PH', 'C', 'E', 'D', 'F', 'G', 'H', 'I', 'J', 'N', 'K', 'L', 'M', 'O', 'Q', 'P'];
const plan = ORDER.map((id) => chapters.find((c) => c[0] === id)).filter(Boolean);

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
if (!only) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await launch();
const mock = await startMock();
const env = { browser, mock, sleep, steps, act, scrollTo, state, newPage, open, shot, chapter, C, L, T, digits, desks: {} };
console.log(`Mock desk at ${mock.base}`);

try {
  for (const [id, run] of plan) {
    if (only && !only.includes(id)) continue;
    const before = state.shots.length;
    try {
      await run(env);
    } catch (e) {
      console.error(`Chapter ${id} stopped: ${e.message}`);
      state.skipped.push(`Chapter ${id} stopped after ${state.shots.length - before} shots: ${e.message}`);
    }
    console.log(`${id}: ${state.shots.length - before} shots`);
  }
} finally {
  writeManifest();
  await browser.close();
  mock.kill();
}
const by = (vp) => state.shots.filter((s) => s.viewport === vp).length;
console.log(`Done: ${by('desktop')} desktop, ${by('phone')} phone shots.`);
if (state.skipped.length) console.log('Not captured:\n  ' + state.skipped.join('\n  '));
if (state.errors.length) console.log(`Console errors (${state.errors.length}):\n  ` + [...new Set(state.errors)].slice(0, 20).join('\n  '));
const problems = await check();
console.log(problems.length ? 'Checks found ' + problems.length + ' problems:' + String.fromCharCode(10) + '  ' + problems.join(String.fromCharCode(10) + '  ') : 'Checks passed: files, sizes, not blank, manifest, contact-sheet.html written.');
