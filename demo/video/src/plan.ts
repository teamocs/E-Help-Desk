// Turns demo/shots/manifest.json into a timeline. Pure data: no React here.

export const FPS = 30;
export const W = 1920;
export const H = 1080;

// ---------- manifest types ----------
export type Box = {x: number; y: number; w: number; h: number};
export type Target = {label: string; box: Box; action: 'click' | 'type' | 'look'; typed?: string};
export type Shot = {
  id: string; file: string; viewport: 'desktop' | 'phone'; hotel: string; role: string;
  chapter?: string; title: string; say: string; targets: Target[]; skipInVideo?: boolean;
};
export type ChapterInfo = {id?: string; name: string; role?: string; summary?: string};
export type Manifest = {imageSize?: Record<string, {w: number; h: number}>; chapters?: ChapterInfo[]; shots: Shot[]};

// ---------- timeline types ----------
export type Pt = {x: number; y: number};
export type Action = {
  kind: Target['action']; label: string; box: Box; typed?: string;
  start: number; move: number; hover: number; dwell: number; from: Pt; to: Pt; zoom: boolean;
};
type Base = {frames: number; fadeIn: number; from: number};
export type StepItem = Base & {
  type: 'step'; shot: Shot; caption: string; compressed: boolean; actions: Action[];
  cursorStart: Pt; chapterIndex: number; img: {w: number; h: number};
};
export type ChapterItem = Base & {type: 'chapter'; name: string; summary: string; role: string; perUser: boolean; index: number; hotel: string};
export type Item =
  | StepItem | ChapterItem
  | (Base & {type: 'intro'})
  | (Base & {type: 'agenda'; names: string[]; offset: number; page: number; pages: number})
  | (Base & {type: 'outro'});
export type Plan = {items: Item[]; total: number; chapters: string[]; stats: {steps: number; compressed: number; merged: number; skipped: number; seconds: number}};

// ---------- layout (frame pixels) ----------
export const DESKTOP_STAGE = {x: 240, y: 76, w: 1440, h: 810};
export const PHONE_SCREEN_H = 888;
export function stageFor(viewport: Shot['viewport'], img: {w: number; h: number}) {
  if (viewport === 'phone') {
    const scale = PHONE_SCREEN_H / img.h;
    return {x: 330, y: 96, w: img.w * scale, h: PHONE_SCREEN_H, scale};
  }
  return {...DESKTOP_STAGE, scale: DESKTOP_STAGE.w / img.w};
}

// ---------- timing knobs ----------
const READ_CPS = 14;
const MIN_READ = 2.6;
const SETTLE = 8; // let the cross-fade finish before the cursor moves
const FADE_FLOW = 6;
const FADE_CARD = 12;
const CHAPTER_FRAMES = 66;
const INTRO_FRAMES = 120;
const AGENDA_FRAMES = 75;
const OUTRO_FRAMES = 180;
const MAX_FRAMES = Math.round((8 * 60 + 45) * FPS); // leave room under the 9 minute ceiling

const readFrames = (text: string) => Math.ceil(Math.max(MIN_READ, text.length / READ_CPS) * FPS);
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
// Title words that say nothing about the screen itself.
const core = (t: string) => t.replace(/^[^:]{1,20}:/, ' ').replace(/\b(on a phone|phone|the|a|an|on|of|to|is|it)\b/gi, ' ');
const jaccard =(a: string, b: string) => {
  const A = words(a), B = words(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(1, new Set([...A, ...B]).size);
};

// Boxes from the capture can be off-screen or have negative height; drop what we cannot point at.
function usable(t: Target, img: {w: number; h: number}): Target | null {
  const {x, y, w, h} = t.box;
  if (!(w > 6 && h > 6)) return null;
  const cx = Math.max(0, x), cy = Math.max(0, y);
  const cw = Math.min(img.w, x + w) - cx, ch = Math.min(img.h, y + h) - cy;
  if (cw <= 0 || ch <= 0 || (cw * ch) / (w * h) < 0.6) return null;
  return {...t, box: {x: cx, y: cy, w: cw, h: ch}};
}

function pickTargets(ts: Target[]) {
  return ts.length > 4 ? [...ts.slice(0, 3), ts[ts.length - 1]] : ts;
}

function buildActions(targets: Target[], start: Pt, stage: ReturnType<typeof stageFor>, img: {w: number; h: number}) {
  let t = SETTLE;
  let pos = start;
  const actions: Action[] = targets.map((tg) => {
    const to = {x: stage.x + (tg.box.x + tg.box.w / 2) * stage.scale, y: stage.y + (tg.box.y + tg.box.h / 2) * stage.scale};
    const move = Math.round(Math.min(26, Math.max(12, 10 + Math.hypot(to.x - pos.x, to.y - pos.y) / 70)));
    const hover = 5;
    const dwell = tg.action === 'click' ? 14 : tg.action === 'type' ? 12 + Math.min((tg.typed ?? '').length, 40) * 2 : 36;
    const zoom = tg.action === 'look' && tg.box.w < 0.5 * img.w && tg.box.h < 0.5 * img.h;
    const a: Action = {kind: tg.action, label: tg.label, box: tg.box, typed: tg.typed, start: t, move, hover, dwell, from: pos, to, zoom};
    t += move + hover + dwell + 4;
    pos = to;
    return a;
  });
  return {actions, end: t, pos};
}

// Spread spare time between actions so the cursor never rushes, and a final click lands just before the cut.
function spread(actions: Action[], end: number, frames: number) {
  const slack = frames - 10 - end;
  if (slack <= 0 || !actions.length) return;
  const lastClick = actions[actions.length - 1].kind === 'click';
  const gaps = lastClick ? actions.length : actions.length + 1;
  const g = slack / gaps;
  actions.forEach((a, i) => (a.start = Math.round(a.start + g * (i + (lastClick ? 1 : 0.5)))));
}

type Draft = {shot: Shot; chapterIndex: number; firstInChapter: boolean; compressed: boolean; dropped: boolean; img: {w: number; h: number}};

function stepItem(d: Draft, cursor: Pt, captions: Record<string, string>): {item: StepItem; pos: Pt} {
  const {shot, img} = d;
  const stage = stageFor(shot.viewport, img);
  const valid = shot.targets.map((t) => usable(t, img)).filter((t): t is Target => !!t);
  let caption = captions[shot.id] ?? shot.say;
  let targets = pickTargets(valid);
  if (d.compressed) {
    // A lead-in names the one thing being tapped; the title chip already names the screen.
    const lastClick = [...valid].reverse().find((t) => t.action === 'click');
    targets = lastClick ? [lastClick] : valid.slice(-1);
    const t = targets[0];
    caption = !t ? shot.title : t.action === 'click' && !/^(tap|pick|choose|open|press)\b/i.test(t.label) ? `Tap ${t.label}.` : `${t.label}.`;
  }
  const {actions, end, pos} = buildActions(targets, cursor, stage, img);
  // A lead-in only needs the short title read and the one click that opens the next screen.
  const frames = d.compressed ? Math.max(54, Math.ceil((caption.length / READ_CPS) * FPS), end + 6) : Math.max(SETTLE + readFrames(caption) + 12, end + 14);
  spread(actions, end, frames);
  return {
    item: {type: 'step', frames, fadeIn: d.firstInChapter ? FADE_CARD : FADE_FLOW, from: 0, shot, caption, compressed: d.compressed, actions, cursorStart: cursor, chapterIndex: d.chapterIndex, img},
    pos,
  };
}

export type Options = {captions?: Record<string, string>; skip?: string[]};

export function buildPlan(m: Manifest, {captions = {}, skip = []}: Options = {}): Plan {
  const size = (v: string) => m.imageSize?.[v] ?? (v === 'phone' ? {w: 780, h: 1688} : {w: 1920, h: 1080});
  const all = m.shots.filter((s) => !s.skipInVideo && !skip.includes(s.id));
  const skipped = m.shots.length - all.length;

  // Chapters in the order the shots meet them.
  const chapterNames: string[] = [];
  let current = '';
  const drafts: Draft[] = all.map((shot) => {
    const name = shot.chapter ?? current ?? '';
    const first = (!!shot.chapter && shot.chapter !== current) || !chapterNames.length;
    if (first) {
      current = name || 'The desk';
      if (!chapterNames.includes(current)) chapterNames.push(current);
    }
    return {shot, chapterIndex: chapterNames.indexOf(current), firstInChapter: first, compressed: false, dropped: false, img: size(shot.viewport)};
  });

  const info = (name: string) => m.chapters?.find((c) => c.name === name);
  const groups = Math.ceil(chapterNames.length / 5);
  const per = Math.ceil(chapterNames.length / Math.max(1, groups));

  const assemble = (): Item[] => {
    const items: Item[] = [{type: 'intro', frames: INTRO_FRAMES, fadeIn: 0, from: 0}];
    for (let g = 0; g < groups; g++) {
      items.push({type: 'agenda', frames: AGENDA_FRAMES, fadeIn: FADE_CARD, from: 0, names: chapterNames.slice(g * per, g * per + per), offset: g * per, page: g + 1, pages: groups});
    }
    let cursor: Pt = {x: W / 2, y: H - 120};
    drafts.forEach((d) => {
      if (d.dropped) return;
      if (d.firstInChapter) {
        const name = chapterNames[d.chapterIndex];
        const c = info(name);
        items.push({type: 'chapter', frames: CHAPTER_FRAMES, fadeIn: FADE_CARD, from: 0, name, summary: c?.summary ?? '', role: c?.role ?? d.shot.role, perUser: /^a day (as|on) /i.test(name), index: d.chapterIndex, hotel: d.shot.hotel});
      }
      const {item, pos} = stepItem(d, cursor, captions);
      cursor = pos;
      items.push(item);
    });
    items.push({type: 'outro', frames: OUTRO_FRAMES, fadeIn: FADE_CARD, from: 0});
    let at = 0;
    items.forEach((it) => {
      at -= it.fadeIn;
      it.from = at;
      at += it.frames;
    });
    return items;
  };

  let items = assemble();
  const total = () => items.reduce((s, it) => s + it.frames - it.fadeIn, 0);

  // Too long? Merge away the most repetitive shots: near-duplicates go, steps whose click opens
  // the next screen become quick lead-ins (title + that click). Most redundant first, until it fits.
  const redundancy = (i: number) => {
    const d = drafts[i];
    const seen = drafts.slice(0, i).map((o) => jaccard(core(o.shot.title), core(d.shot.title)));
    let r = 3 * Math.max(0, ...seen);
    if (d.shot.viewport === 'phone' && drafts.some((o, j) => j !== i && o.shot.viewport === 'desktop' && jaccard(core(o.shot.title), core(d.shot.title)) >= 0.4)) r += 3;
    if (/^a day /i.test(chapterNames[d.chapterIndex])) r += 0.5;
    if (!d.shot.targets.some((t) => t.action !== 'look')) r += 0.5;
    if (d.shot.targets.some((t) => t.action === 'type')) r -= 1;
    if (i > 0 && drafts[i - 1].shot.role !== d.shot.role) r -= 2; // a different user type is new information
    return r;
  };
  const order = drafts.map((_, i) => i).filter((i) => !drafts[i].firstInChapter).sort((a, b) => redundancy(b) - redundancy(a) || b - a);
  for (const i of order) {
    if (total() <= MAX_FRAMES) break;
    if (redundancy(i) >= 2.5) drafts[i].dropped = true;
    else drafts[i].compressed = true;
    items = assemble();
  }
  for (const i of order) {
    if (total() <= MAX_FRAMES) break;
    if (drafts[i].compressed) drafts[i].dropped = true, (items = assemble());
  }
  // More than two lead-ins in a row reads as flashing: merge the extras away,
  // then spend the time saved on turning the least repetitive lead-ins back into full steps.
  let run: Draft[] = [];
  const flush = () => {
    if (run.length > 2) run.forEach((d, k) => k % 2 === 1 && k !== run.length - 1 && (d.dropped = true));
    run = [];
  };
  for (const d of drafts) {
    if (d.dropped) continue;
    if (d.compressed && !d.firstInChapter) run.push(d);
    else flush();
  }
  flush();
  items = assemble();
  // Round-robin over chapters so every part gets its fair share of full steps.
  const queues = chapterNames.map((_, c) => [...order].reverse().filter((i) => drafts[i].chapterIndex === c && drafts[i].compressed && !drafts[i].dropped));
  for (let progress = true; progress; ) {
    progress = false;
    for (const q of queues) {
      const i = q.shift();
      if (i === undefined) continue;
      drafts[i].compressed = false;
      items = assemble();
      if (total() > MAX_FRAMES) (drafts[i].compressed = true), (items = assemble());
      else progress = true;
    }
  }

  const t = total();
  return {
    items,
    total: t,
    chapters: chapterNames,
    stats: {
      steps: drafts.filter((d) => !d.dropped).length,
      compressed: drafts.filter((d) => d.compressed && !d.dropped).length,
      merged: drafts.filter((d) => d.dropped).length,
      skipped,
      seconds: Math.round(t / FPS),
    },
  };
}

// Words the audience should never read on screen.
export const JARGON = /\b(API|sync|snapshot|token|endpoint|cache|REST|plugin)\b/;
