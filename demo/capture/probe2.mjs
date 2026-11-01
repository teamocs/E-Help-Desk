// Dev helper: node capture/probe2.mjs '<json steps>' [role] [vp]; steps: ["Module"] or {btn,within,css,has,type,select}. Dumps the open sheet or the page.
import { launch, startMock, newPage, steps, C, T, sleep, locate } from './lib.mjs';
const list = JSON.parse(process.argv[2] ?? '[]'); const role = process.argv[3] ?? 'owner'; const vp = process.argv[4] ?? 'desktop';
const b = await launch(); const m = await startMock();
const c = await newPage(b, { vp, url: `${m.base}/helpdesk/?role=${role}&hotel=baguio${process.env.EXTRA ?? ''}` });
for (const s of list) {
  const spec = typeof s === 'string' ? { btn: s, within: vp === 'phone' ? '.tabbar' : '.side' } : s;
  if (spec.type !== undefined) { const el = await locate(c.page, spec); await el.click(); await c.page.keyboard.type(spec.type); await sleep(200); continue; }
  if (spec.select !== undefined) { const el = await locate(c.page, spec); await el.select(spec.select); await sleep(200); continue; }
  if (spec.scroll) { const el = await locate(c.page, spec); await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); continue; }
  await steps(c.page, [C('s', spec)]); await sleep(500);
}
await sleep(600);
await c.page.screenshot({ path: process.env.PROBE_OUT ?? 'probe.png' });
console.log(await c.page.evaluate(() => {
  const root = document.querySelector('.sheet') ?? document.querySelector('.insp') ?? document.querySelector('main') ?? document.body;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const t = (e) => (e.getAttribute('aria-label') || e.innerText || e.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const els = [...root.querySelectorAll('button,a,select,input,textarea,summary,h1,h2,h3,label')].filter(vis).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.type ? '[' + e.type + ']' : ''}.${String(e.className).split(' ')[0]}: ${t(e)}`);
  return `ROOT ${root.className}\n` + els.join('\n');
}));
await b.close(); m.kill();
