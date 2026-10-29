import { launch, startMock, newPage, steps, C, digits } from './lib.mjs';
const b = await launch(); const m = await startMock();
const c = await newPage(b, { vp: 'desktop', url: `${m.base}/helpdesk/?role=owner&hotel=baguio` });
await steps(c.page, [C('n', { btn: 'New request', within: '.side' })]);
await new Promise((r) => setTimeout(r, 800));
console.log(await c.page.evaluate(() => {
  const q = (s) => document.querySelector(s); const info = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return `${e.className} pos=${s.position} ov=${s.overflowY} top=${Math.round(r.top)} h=${Math.round(r.height)} sh=${e.scrollHeight} ch=${e.clientHeight}`; };
  return [info(q('.sheet')), info(q('.sheet-body')), info(document.documentElement), info(document.body), info(q('.main')), info(q('.screen')), String(window.scrollY)].join('\n');
}));
await b.close(); m.kill();
