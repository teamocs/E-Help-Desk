// Small helpers for capture.mjs: mock server, browser pages, locators, stable screenshots, pins, manifest.
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
export const OUT = join(here, '..', 'shots');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- mock server ---------- */
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

export async function startMock() {
  const port = await freePort();
  const proc = spawn(process.execPath, [join(ROOT, 'scripts', 'mock-wp.mjs')], { env: { ...process.env, PORT: String(port) }, cwd: ROOT, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${base}/logo.svg`)).ok) return { base, kill: () => proc.kill() }; } catch { /* not up yet */ }
    await sleep(100);
  }
  proc.kill();
  throw new Error('The mock server did not start. Run npm run build:wp in the repo root if the desk bundle is missing.');
}

/* ---------- browser ---------- */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache', 'puppeteer', 'chrome');
  try {
    const exe = process.platform === 'win32' ? join('chrome-win64', 'chrome.exe') : join('chrome-linux64', 'chrome');
    const found = readdirSync(cache).sort().reverse().map((v) => join(cache, v, exe)).find(existsSync);
    if (found) return found;
  } catch { /* no cache */ }
  return undefined; // puppeteer's own download
}
export const launch = () => puppeteer.launch({ headless: true, executablePath: chromePath(), args: ['--no-sandbox', '--font-render-hinting=none', '--hide-scrollbars'] });

const VIEWPORTS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1.5 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/* ---------- page-side finder (serialised into the page) ---------- */
function findInPage(spec) {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const lab = (e) => norm(e.getAttribute('aria-label') || e.innerText || e.textContent || e.placeholder);
  let root = document;
  if (spec.within) {
    const w = typeof spec.within === 'string' ? { css: spec.within } : spec.within;
    let c = [...document.querySelectorAll(w.css)].filter(vis);
    if (w.has) { c = c.filter((e) => norm(e.textContent).includes(w.has)); c = c.filter((e) => !c.some((x) => x !== e && e.contains(x))); }
    root = w.has ? c[w.nth ?? 0] : c[c.length - 1];
    if (!root) return null;
  }
  let list = [];
  if (spec.css) list = [...root.querySelectorAll(spec.css)].filter(vis);
  else if (spec.btn) {
    const t = spec.btn.toLowerCase();
    const all = [...root.querySelectorAll('button,a,[role=radio],[role=switch],label,summary,select,input,textarea')].filter(vis);
    const l = (e) => lab(e).toLowerCase();
    list = all.filter((e) => l(e) === t);
    if (!list.length) list = all.filter((e) => l(e).startsWith(t));
    if (!list.length) list = all.filter((e) => l(e).includes(t));
  } else if (spec.text) {
    const t = spec.text.toLowerCase();
    const all = [...root.querySelectorAll('*')].filter((e) => vis(e) && norm(e.textContent).toLowerCase().includes(t));
    list = all.filter((e) => ![...e.children].some((ch) => all.includes(ch)));
  }
  if (spec.has) list = list.filter((e) => norm(e.textContent).includes(spec.has));
  const n = spec.nth ?? 0;
  return list[n < 0 ? list.length + n : n] ?? null;
}

export async function locate(page, spec) {
  const h = await page.evaluateHandle(findInPage, spec);
  const el = h.asElement();
  if (!el) throw new Error(`Not found on the page: ${JSON.stringify(spec)}`);
  return el;
}

/* ---------- target helpers ---------- */
export const C = (label, spec, extra = {}) => ({ label, ...spec, action: 'click', ...extra });
export const L = (label, spec) => ({ label, ...spec, action: 'look' });
export const T = (label, spec, typed) => ({ label, ...spec, action: 'type', typed });
export const digits = (s, pad) => [...s].map((d) => C(`Tap ${d} on the number pad`, { btn: d, within: pad }));

/* ---------- state ---------- */
export const state = { shots: [], chapters: [], counts: { desktop: 0, phone: 0 }, errors: [], skipped: [], pending: null, chapter: null, mute: false, current: '' };

export async function newPage(browser, { vp, url, mock = true, hotel = 'baguio', role = 'owner' }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const v = VIEWPORTS[vp];
  await page.setViewport(v);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }]);
  page.on('dialog', (d) => d.accept());
  const log = (kind, text) => { if (!state.mute && mock) state.errors.push(`${state.current} [${kind}] ${text}`); };
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location()?.url ?? '')) log('console', `${m.text()} ${m.location()?.url ?? ''}`); });
  page.on('pageerror', (e) => log('pageerror', String(e)));
  if (mock) {
    // The desk's clock only moves in 30 second steps, so a ring or an age never changes while we look.
    await page.evaluateOnNewDocument(() => { const real = Date.now.bind(Date); Date.now = () => Math.ceil(real() / 30000) * 30000; });
  }
  const c = { page, vp, hotel, role, dsf: v.deviceScaleFactor, W: Math.round(v.width * v.deviceScaleFactor), H: Math.round(v.height * v.deviceScaleFactor), mock, url };
  if (url) await open(c, url);
  return c;
}

export async function open(c, url) {
  const r = await c.page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  if (!r || r.status() >= 400) throw new Error(`HTTP ${r?.status()} for ${url}`);
  if (c.mock) await c.page.waitForSelector('.side, .tabbar, .lockwrap', { timeout: 20000 });
  await settle(c.page);
  return r.status();
}

export async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 8000 }).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(250);
}

/** Two shots in a row that are byte-identical mean nothing is still moving. */
async function snap(page) {
  let prev = await page.screenshot({ type: 'png', captureBeyondViewport: false });
  for (let i = 0; i < 8; i++) {
    await sleep(140);
    const cur = await page.screenshot({ type: 'png', captureBeyondViewport: false });
    if (Buffer.compare(cur, prev) === 0) return cur;
    prev = cur;
  }
  return prev;
}

export async function act(page, t) {
  if (t.action === 'look') return;
  const el = await locate(page, t);
  if (t.keys) { await el.focus(); for (const k of t.keys) await page.keyboard.press(k); return; }
  if (t.value !== undefined) { await el.select(t.value); return; }
  for (let i = 0; i < (t.repeat ?? 1); i++) { try { await el.click(); } catch { await el.evaluate((e) => e.click()); } if (t.repeat) await sleep(120); }
  if (t.action === 'type') {
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.type(t.typed, { delay: 12 });
  }
  await sleep(350);
}

export async function scrollTo(page, spec, block = 'center') {
  const el = await locate(page, spec);
  await el.evaluate((e, b) => e.scrollIntoView({ block: b }), block);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Save one picture (plus a pins copy) and its manifest entry, then perform the click/type targets in order.
 * o: {slug, title, say, targets, prep(page), scroll:{spec,block}, keepToast, noact, mute}
 */
export async function shot(c, o) {
  const { page } = c;
  state.current = `${c.vp}:${o.slug}`;
  if (o.prep) await o.prep(page, c);
  if (o.scroll) await scrollTo(page, o.scroll.spec ?? o.scroll, o.scroll.block);
  await page.evaluate((hide) => {
    if (!document.getElementById('__shotstyle')) {
      const s = document.createElement('style'); s.id = '__shotstyle';
      s.textContent = '*{caret-color:transparent!important}html[data-hide-toasts] .toasts{display:none!important}';
      document.head.appendChild(s);
    }
    if (hide) document.documentElement.setAttribute('data-hide-toasts', ''); else document.documentElement.removeAttribute('data-hide-toasts');
  }, !o.keepToast);
  await settle(page);

  const targets = [];
  for (const t of o.targets ?? []) {
    let el;
    try { el = await locate(page, t); } catch (e) { if (t.soft) { state.skipped.push(`${state.current}: target "${t.label}" not on the page`); continue; } throw e; }
    // A heading found by its words: point at the words, not at the whole row it sits in.
    const r = await el.evaluate((e, words) => {
      let b = e.getBoundingClientRect();
      if (words) { const g = document.createRange(); g.selectNodeContents(e); const q = g.getBoundingClientRect(); if (q.width > 0) b = q; }
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }, !!(t.text || t.words));
    targets.push({ t, r });
  }
  const n = ++state.counts[c.vp];
  const num = String(n).padStart(c.vp === 'desktop' ? 3 : 2, '0');
  const id = `${c.vp === 'phone' ? 'p' : 'd'}${num}-${o.slug}`;
  const file = `${c.vp}/${num}-${o.slug}.png`;
  mkdirSync(join(OUT, c.vp), { recursive: true });
  writeFileSync(join(OUT, file), await snap(page));

  const img = (r) => {
    const x = Math.max(0, Math.round(r.x * c.dsf)), y = Math.max(0, Math.round(r.y * c.dsf));
    return { x, y, w: Math.min(c.W - x, Math.round(r.w * c.dsf)), h: Math.min(c.H - y, Math.round(r.h * c.dsf)) };
  };
  const entry = {
    id, file, viewport: c.vp, hotel: c.hotel, role: c.role, title: o.title, say: o.say,
    ...(state.pending ? { chapter: state.pending } : {}),
    targets: targets.map(({ t, r }) => ({
      label: t.label, ...(t.css ? { selector: t.css } : {}), ...(t.btn || t.text ? { text: t.btn ?? t.text } : {}), ...(t.within ? { within: typeof t.within === 'string' ? t.within : t.within.css } : {}),
      action: t.action, ...(t.typed !== undefined ? { typed: t.typed } : {}), box: img(r),
    })),
  };
  state.pending = null;

  if (targets.length) {
    const pinsFile = `pins/${c.vp}/${num}-${o.slug}-pins.png`;
    const accent = await page.evaluate((fallback) => getComputedStyle(document.documentElement).getPropertyValue('--azl-accent').trim() || fallback, c.hotel === 'boracay' ? '#177280' : '#3f7052');
    await page.evaluate((rects, accent) => {
      const root = document.createElement('div');
      root.id = '__pins';
      root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
      rects.forEach((r, i) => {
        const d = 30;
        // Words get their pin to the right; buttons and rows get it inside their top right corner.
        const small = r.w < 130 || r.h < 40;
        const ox = r.words ? r.x + r.w + d / 2 + 4 : small ? r.x + r.w + 2 : r.x + r.w - 4;
        const oy = r.words ? r.y + r.h / 2 : small ? r.y - 2 : r.y + 4;
        const cx = Math.min(innerWidth - d / 2 - 4, Math.max(d / 2 + 4, ox));
        const cy = Math.min(innerHeight - d / 2 - 4, Math.max(d / 2 + 4, oy));
        const p = document.createElement('div');
        p.textContent = String(i + 1);
        p.style.cssText = `position:absolute;left:${cx - d / 2}px;top:${cy - d / 2}px;width:${d}px;height:${d}px;border-radius:50%;background:${accent};color:#fff;font:700 16px/${d}px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-sizing:border-box;box-shadow:0 3px 10px rgba(0,0,0,.35)`;
        root.appendChild(p);
      });
      document.body.appendChild(root);
    }, targets.map((x) => ({ ...x.r, words: !!(x.t.text || x.t.words) })), accent);
    await sleep(100);
    mkdirSync(join(OUT, 'pins', c.vp), { recursive: true });
    writeFileSync(join(OUT, pinsFile), await snap(page));
    await page.evaluate(() => document.getElementById('__pins')?.remove());
    entry.pinsFile = pinsFile;
    entry.pins = targets.map(({ t, r }, i) => {
      const b = img(r);
      return { n: i + 1, label: t.label, box: b, at: pinAt(t, b, c) };
    });
  } else entry.pins = [];
  state.shots.push(entry);

  if (!o.noact) for (const { t } of targets) await act(page, t);
}

export function chapter(id, name, role, summary) {
  state.pending = name;
  state.chapters.push({ id, name, role, summary });
}

export function writeManifest() {
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
    generated: 'by demo/capture/capture.mjs',
    imageSize: { desktop: { w: 1920, h: 1080 }, phone: { w: 780, h: 1688 } },
    chapters: state.chapters, shots: state.shots,
  }, null, 2));
}

/** Do targets without a picture (setting a scene up). */
export async function steps(page, targets) { for (const t of targets) await act(page, t); }

/** Centre of a pin in image pixels (same rule as the overlay). */
function pinAt(t, b, c) {
  const k = c.dsf, d = 15 * k + 4 * k;
  const w = !!(t.text || t.words);
  const small = b.w / k < 130 || b.h / k < 40;
  const x = w ? b.x + b.w + d : small ? b.x + b.w + 2 * k : b.x + b.w - 4 * k;
  const y = w ? b.y + b.h / 2 : small ? b.y - 2 * k : b.y + 4 * k;
  return { x: Math.round(Math.min(c.W - d, Math.max(d, x))), y: Math.round(Math.min(c.H - d, Math.max(d, y))) };
}
