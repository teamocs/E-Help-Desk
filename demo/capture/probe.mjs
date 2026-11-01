// Dev helper: prints what is on screen for a module. node capture/probe.mjs <role> <module label> [vp]
import { launch, startMock, newPage, steps, C, sleep } from './lib.mjs';
const [role = 'owner', mod = 'Dashboard', vp = 'desktop', extra = ''] = process.argv.slice(2);
const b = await launch(); const m = await startMock();
const c = await newPage(b, { vp, url: `${m.base}/helpdesk/?role=${role}&hotel=baguio${extra}` });
if (mod !== 'Dashboard') await steps(c.page, [C('n', { btn: mod, within: vp === 'phone' ? '.tabbar' : '.side' })]);
await sleep(800);
await c.page.screenshot({ path: process.env.PROBE_OUT ?? 'probe.png' });
console.log(await c.page.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const t = (e) => (e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const btns = [...document.querySelectorAll('button,a,[role=tab],[role=radio],select,input,textarea,summary')].filter(vis).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).split(' ')[0]}: ${t(e)}`);
  const heads = [...document.querySelectorAll('h1,h2,h3,.group-title,.card-title')].filter(vis).map((e) => `${e.tagName}.${String(e.className).split(' ')[0]}: ${t(e)}`);
  return 'HEADS\n' + heads.join('\n') + '\nBTNS\n' + btns.join('\n');
}));
await b.close(); m.kill();
