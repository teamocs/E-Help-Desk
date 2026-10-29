// Checks demo/shots (every file exists, right size, not blank, manifest sane) and writes shots/contact-sheet.html.
// Run by capture.mjs at the end; also: npm run check
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, launch } from './lib.mjs';

const SIZE = { desktop: [1920, 1080], phone: [780, 1688] };
const BANNED = /\b(api|rest|snapshot|sync|syncing|endpoint|token)\b/i;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function check() {
  const problems = [];
  const m = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
  const seen = new Set();
  const files = [];
  for (const s of m.shots) {
    if (seen.has(s.id)) problems.push(`${s.id}: duplicate id`);
    seen.add(s.id);
    const [W, H] = SIZE[s.viewport];
    if (s.title.trim().split(/\s+/).length > 6) problems.push(`${s.id}: title longer than 6 words`);
    for (const t of [s.title, s.say, ...s.targets.map((x) => x.label)]) if (BANNED.test(t)) problems.push(`${s.id}: technical word in "${t}"`);
    for (const f of [s.file, s.pinsFile].filter(Boolean)) {
      const p = join(OUT, f);
      if (!existsSync(p)) { problems.push(`${s.id}: missing ${f}`); continue; }
      const b = readFileSync(p);
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
      if (w !== W || h !== H) problems.push(`${f}: ${w}x${h}, expected ${W}x${H}`);
      if (statSync(p).size < 15000) problems.push(`${f}: suspiciously small`);
      files.push({ f, b });
    }
    for (const t of s.targets) {
      const { x, y, w, h } = t.box;
      if (x < 0 || y < 0 || x + w > W || y + h > H || w < 4 || h < 4) problems.push(`${s.id}: box of "${t.label}" outside the image or empty (${x},${y},${w},${h})`);
    }
    if (s.pins.length !== s.targets.length) problems.push(`${s.id}: pins do not match targets`);
  }
  // Not blank: look at a small copy of every picture in the browser.
  const browser = await launch();
  const page = await browser.newPage();
  const flat = await page.evaluate(async (list) => {
    const out = [];
    for (const [f, b64] of list) {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas'); c.width = 48; c.height = 48;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 48, 48);
      const d = g.getImageData(0, 0, 48, 48).data;
      const colours = new Set();
      for (let i = 0; i < d.length; i += 4) colours.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`);
      if (colours.size < 6) out.push(f);
    }
    return out;
  }, files.map(({ f, b }) => [f, b.toString('base64')]));
  for (const f of flat) problems.push(`${f}: looks blank`);

  // Contact sheet.
  const by = (vp) => m.shots.filter((s) => s.viewport === vp);
  const card = (s) => `<figure id="${esc(s.id)}"><a href="${esc(s.pinsFile ?? s.file)}"><img loading="lazy" src="${esc(s.file)}" alt=""></a><figcaption><b>${esc(s.id)}</b><br>${esc(s.title)}<br><small>${esc(s.role)} · ${esc(s.hotel)}${s.pins.length ? ` · ${s.pins.length} pins` : ''}</small></figcaption></figure>`;
  const section = (vp) => {
    let html = `<h2>${vp === 'desktop' ? 'Desktop' : 'Phone'} (${by(vp).length})</h2><div class="grid ${vp}">`;
    for (const s of by(vp)) html += (s.chapter ? `</div><h3>${esc(s.chapter)}</h3><div class="grid ${vp}">` : '') + card(s);
    return html + '</div>';
  };
  writeFileSync(join(OUT, 'contact-sheet.html'), `<!doctype html><meta charset="utf-8"><title>Azalea e-Helpdesk shots</title>
<style>body{font:14px system-ui,sans-serif;margin:20px;background:#f4f1ea;color:#201e1d}h2{margin:32px 0 4px}h3{margin:20px 0 6px}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}.grid.phone{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}figure{margin:0}img{width:100%;display:block;border:1px solid #0002;border-radius:6px;background:#fff}figcaption{font-size:12px;margin-top:4px}small{color:#666}a{color:inherit}</style>
<h1>Azalea e-Helpdesk: ${m.shots.length} shots</h1><p>Click a picture to open its numbered-pins version.</p>${section('desktop')}${section('phone')}`);
  await browser.close();
  return problems;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const p = await check();
  console.log(p.length ? `Problems (${p.length}):\n  ${p.join('\n  ')}` : 'All checks passed.');
  process.exitCode = p.length ? 1 : 0;
}
