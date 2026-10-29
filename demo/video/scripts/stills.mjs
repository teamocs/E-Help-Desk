// Renders a few key frames as PNG into demo/out/frames/ for a quick visual check.
// Frames are picked from the plan, so they follow the manifest as it grows.
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'out', 'frames');
mkdirSync(out, {recursive: true});

const serveUrl = await bundle({entryPoint: join(here, '..', 'src', 'index.ts')});
const composition = await selectComposition({serveUrl, id: 'AzaleaDemo', inputProps: {}});
const {items} = composition.props.plan;
const steps = items.filter((i) => i.type === 'step');
const actAt = (s, kind) => {
  const a = s.actions.find((x) => x.kind === kind);
  return a ? s.from + a.start + a.move + a.hover : null;
};
const pick = (name, frame) => frame != null && picks.push([name, Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(frame)))]);
const picks = [];
const by = (pred) => items.find(pred);

pick('01-intro', 70);
pick('02-agenda', by((i) => i.type === 'agenda').from + 50);
pick('03-chapter', by((i) => i.type === 'chapter').from + 50);
const click = steps.find((s) => !s.compressed && s.shot.viewport === 'desktop' && s.actions.some((a) => a.kind === 'click'));
pick('04-click', click && actAt(click, 'click') + 3);
const look = steps.find((s) => s.actions.some((a) => a.zoom));
pick('05-look-zoom', look && actAt(look, 'look') + 16);
const type = steps.find((s) => s.actions.some((a) => a.kind === 'type'));
const ta = type?.actions.find((a) => a.kind === 'type');
pick('06-typing', type && actAt(type, 'type') + ta.dwell * 0.6);
const phone = steps.find((s) => s.shot.viewport === 'phone' && !s.compressed);
pick('07-phone', phone && phone.from + phone.actions[0].start + phone.actions[0].move + 10);
const perUser = by((i) => i.type === 'chapter' && i.perUser);
pick('08-user-chapter', perUser && perUser.from + 50);
const short = steps.find((s) => s.compressed);
pick('09-shortened-step', short && short.from + 30);
const longest = [...steps].sort((a, b) => b.caption.length - a.caption.length)[0];
pick('10-longest-caption', longest.from + longest.frames - 20);
const role = steps.find((s) => s.shot.role !== 'owner' && s.shot.viewport === 'desktop');
pick('11-role-badge', role && role.from + 40);
pick('12-end', composition.durationInFrames - 30);
// Every chapter card, and the first full step of each user-type chapter ("A day as ...").
items.forEach((it, k) => {
  if (it.type !== 'chapter') return;
  const n = String(it.index + 1).padStart(2, '0');
  pick(`card-${n}`, it.from + 50);
  if (!it.perUser) return;
  const step = items.slice(k + 1).find((s) => s.type !== 'step' || !s.compressed);
  if (step?.type === 'step') pick(`user-${n}-${step.shot.id}`, step.from + Math.min(step.frames - 10, (step.actions[0]?.start ?? 0) + (step.actions[0]?.move ?? 0) + 12));
});
const {stats} = composition.props.plan;
console.log(`${stats.steps} steps (${stats.compressed} lead-ins, ${stats.merged} merged, ${stats.skipped} skipped), ${composition.props.plan.chapters.length} chapters, ${(composition.durationInFrames / 30 / 60).toFixed(2)} min`);

for (const [name, frame] of picks) {
  await renderStill({serveUrl, composition, frame, output: join(out, `${name}.png`)});
  console.log(`${name}.png  frame ${frame}`);
}
