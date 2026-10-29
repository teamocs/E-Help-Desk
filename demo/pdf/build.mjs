// Builds docs/pdf/Azalea-HelpDesk-Help-Guide.pdf and ...-Quick-Start.pdf from the Markdown guides.
// Markdown -> HTML (marked + cheerio) -> Chrome PDF; the guide goes through paged.js for real contents page numbers.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { marked } from 'marked';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { launch } from '../capture/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const DOCS = join(ROOT, 'docs');
const BUILD = join(here, 'build');
const OUTDIR = join(DOCS, 'pdf');
const VERSION = 'Version 0.3.0';
const DATE = 'October 2026';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const slug = (t) => t.toLowerCase().trim().replace(/[^\p{L}\p{N}\- ]/gu, '').replace(/ /g, '-');

mkdirSync(join(BUILD, 'img'), { recursive: true });
mkdirSync(join(BUILD, 'fonts'), { recursive: true });
mkdirSync(OUTDIR, { recursive: true });
for (const f of ['amaranth-400-latin.woff2', 'figtree-variable-latin.woff2']) copyFileSync(join(ROOT, 'azalea-ehelpdesk', 'assets', 'fonts', f), join(BUILD, 'fonts', f));
copyFileSync(join(here, 'guide.css'), join(BUILD, 'guide.css'));
copyFileSync(join(here, 'quick.css'), join(BUILD, 'quick.css'));
copyFileSync(join(here, 'common.css'), join(BUILD, 'common.css'));

const YES = '<svg class="yes" viewBox="0 0 12 12" role="img" aria-label="Yes"><path d="M2 6.4l2.7 2.7L10 3.3"/></svg>';
const md = (s) => marked.parse(s, { gfm: true }).replaceAll('✔', YES);
const mdi = (s) => marked.parseInline(s, { gfm: true }).replaceAll('✔', YES);

/* ---------- images: downscale to 1400 px wide JPEG ---------- */
async function image(src) {
  const input = join(DOCS, src);
  const name = src.replace(/^help\/img\//, '').replace(/[\\/]/g, '-').replace(/\.png$/i, '.jpg');
  const out = join(BUILD, 'img', name);
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(input).mtimeMs) {
    await sharp(input).resize({ width: 1150, withoutEnlargement: true }).jpeg({ quality: 74, mozjpeg: true, chromaSubsampling: '4:2:0' }).toFile(out);
  }
  const m = await sharp(out).metadata();
  return { file: `img/${name}`, w: m.width, h: m.height };
}

/* ---------- pointer groups: an image line followed by its numbered list ---------- */
async function figures(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^!\[(.*)\]\((.*)\)\s*$/);
    if (!m) { out.push(lines[i]); continue; }
    const [, alt, src] = m;
    const img = await image(src);
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const items = [];
    if (j - i <= 2) while (j < lines.length && /^\d+\.\s/.test(lines[j])) {
      let [, n, t] = lines[j].match(/^(\d+)\.\s+(.*)$/);
      let label = n;
      const r = t.match(/^to (\d+)\.\s+(.*)$/);
      if (r) { label = `${n}–${r[1]}`; t = r[2]; }
      const c = t.indexOf(': ');
      const html = c > 0 && c < 70 ? `<b>${mdi(t.slice(0, c))}</b>${mdi(t.slice(c))}` : mdi(t);
      items.push(`<li${r ? ' class="rng"' : ''} data-n="${label}">${html}</li>`);
      j++;
    }
    const cls = ['fg', src.includes('/phone/') ? 'phone' : 'desk', /boracay/i.test(src) ? 'boracay' : ''].filter(Boolean).join(' ');
    out.push('', `<div class="${cls}"><figure><img src="${img.file}" width="${img.w}" height="${img.h}" alt="${esc(alt)}"><figcaption>${mdi(alt)}</figcaption></figure>${items.length ? `<ol class="pointers">${items.join('')}</ol>` : ''}</div>`, '');
    i = items.length ? j - 1 : i;
  }
  return out.join('\n');
}

/* ---------- the guide ---------- */
async function buildGuide() {
  let src = readFileSync(join(DOCS, 'HELP-GUIDE.md'), 'utf8').replace(/\r\n/g, '\n');
  src = src.replace(/^# .*\n+For hotel owners.*\n+/, ''); // cover replaces the title and audience line
  src = src.replace(/^(?:\s*- \[.*\]\(#.*\)\n)+/m, ''); // contents list is rebuilt below with page numbers
  const $ = cheerio.load(`<body>${md(await figures(src))}</body>`, null, false);

  // ids for headings (same slugs GitHub uses, so the guide's own links resolve)
  $('h2, h3').each((_, el) => { $(el).attr('id', 's-' + slug($(el).text())); }); // 's-' prefix: paged.js needs ids that are valid CSS selectors
  $('a[href^="#"]').each((_, a) => { $(a).attr('href', '#s-' + $(a).attr('href').slice(1)); });

  // callouts
  $('p').each((_, el) => {
    const p = $(el);
    const label = p.children('strong').first().text();
    const only = p.contents().length === 1 && p.children('strong').length === 1;
    if (only && (label === 'Good to know' || label === 'If something looks wrong')) {
      const next = p.next('ul');
      const box = $(`<div class="callout ${label === 'Good to know' ? 'good' : 'wrong'}"><div class="ctitle">${label}</div></div>`);
      p.before(box); next.length ? box.append(next) : null; p.remove();
    } else if (p.text().startsWith('Call 911 or use the radio first. Then log.')) p.addClass('call911');
  });
  $('blockquote').each((_, el) => { $(el).replaceWith(`<div class="callout safe"><div class="ctitle">Safety first</div>${$(el).html()}</div>`); });

  // chapters
  const toc = [];
  const body = $('<div class="body"></div>');
  let cur = null;
  $.root().children().each((_, el) => {
    const n = $(el);
    if (el.tagName === 'h2') {
      const t = n.text();
      const [, num, title] = t.match(/^(\d+)\.\s+(.*)$/);
      const web = num === '10';
      cur = $(`<section class="chapter c${num}${web ? ' web' : ''}"></section>`);
      cur.append(`<header class="opener">${web ? '<div class="kick">For the web team</div>' : '<div class="kick">Chapter</div>'}<div class="num">${num}</div><h2 id="${n.attr('id')}" data-chap="${esc(t)}">${esc(title)}</h2><div class="rule"></div></header>`);
      body.append(cur);
      toc.push({ lvl: 0, id: n.attr('id'), num: `${num}.`, title });
    } else {
      if (el.tagName === 'h3') { const [, num, title] = n.text().match(/^([\d.]+)\s+(.*)$/); toc.push({ lvl: 1, id: n.attr('id'), num, title }); }
      cur.append(n);
    }
  });

  // chapter 8 questions and chapter 9 glossary
  body.find('.c8 > p').each((_, el) => {
    const p = $(el); const s = p.children('strong').first();
    if (!s.length) return;
    p.before(`<div class="q">${s.html()}</div>`); s.remove();
    p.html(p.html().trim());
    if (!p.text().trim()) p.remove();
  });
  const dl = $('<dl class="glossary"></dl>');
  body.find('.c9 > p').each((_, el) => { const p = $(el); const s = p.children('strong').first(); const t = s.text().replace(/\.$/, ''); s.remove(); dl.append(`<div class="g"><dt>${t}</dt><dd>${p.html().trim()}</dd></div>`); p.remove(); });
  body.find('.c9').append(dl);
  body.find('.c10 > p, .c10 > ul').each((_, el) => { $(el).addClass('tech'); });
  body.find('table').each((_, el) => { $(el).wrap('<div class="tbl"></div>'); });

  // check every internal link has a target
  const ids = new Set(); body.find('[id]').each((_, e) => ids.add($(e).attr('id')));
  const bad = []; body.find('a[href^="#"]').each((_, a) => { if (!ids.has($(a).attr('href').slice(1))) bad.push($(a).attr('href')); });
  if (bad.length) console.warn('Broken internal links:', bad);

  const tocHtml = `<section class="toc"><h1 class="toc-title" data-chap="Contents">Contents</h1><div class="rule"></div><ol class="toc-list">${toc.map((e) => `<li class="l${e.lvl}"><a class="t" href="#${e.id}"><span class="n">${e.num}</span>${esc(e.title)}</a><span class="lead"></span><a class="pg" href="#${e.id}"></a></li>`).join('')}</ol></section>`;
  const cover = `<section class="cover"><div class="top"><span class="ring r1"></span><span class="ring r2"></span><div class="brand">Azalea Hotels &amp; Residences</div><h1>Azalea e-Helpdesk</h1><p class="sub">Help Guide for hotel owners and staff</p><div class="grule"></div><p class="for">For Azalea Hotels &amp; Residences Baguio and Boracay</p></div><div class="bottom"><p class="inside">Signing in &middot; Logging requests &middot; Safety alerts &middot; Work orders<br>Housekeeping &middot; Shift handover &middot; Settings &middot; When the internet drops</p><p class="ver">${VERSION}<span>${DATE}</span></p><div class="band"><i></i><b></b></div></div></section>`;
  const back = `<section class="back"><div class="mid"><h2>Need help?<br>Ask your hotel owner or manager.</h2><div class="grule"></div><p>Azalea e-Helpdesk Help Guide<br>${VERSION} &middot; ${DATE}</p></div><div class="band"><i></i><b></b></div></section>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Azalea e-Helpdesk Help Guide</title><meta name="author" content="Azalea Hotels &amp; Residences"><link rel="stylesheet" href="common.css"><link rel="stylesheet" href="guide.css"><script>window.PagedConfig={auto:false};</script></head><body>${cover}${tocHtml}${$.html(body)}${back}</body></html>`;
  writeFileSync(join(BUILD, 'guide.html'), html);
  return { toc };
}

/* ---------- the quick start ---------- */
function buildQuick() {
  const src = readFileSync(join(DOCS, 'QUICK-START.md'), 'utf8').replace(/\r\n/g, '\n');
  const parts = src.split(/\n(?=## )/);
  const head = parts.shift();
  const lead = head.split('\n').filter((l) => l.trim() && !l.startsWith('# '));
  const intro = lead.map((l) => l.replace(/ The full guide is `docs\/HELP-GUIDE\.md`\./, ' The full Help Guide shows every screen.'));
  const secs = {};
  let table = '';
  for (const p of parts) {
    const m = p.match(/^## (?:(\d)\. )?(.*)\n([\s\S]*)$/);
    if (m[1]) secs[m[1]] = { title: m[2], html: md(m[3].trim()) };
    else table = md(m[3].trim());
  }
  const card = (n, extra = '') => `<section class="card ${extra}"><h2><span class="b">${n}</span>${secs[n].title}</h2>${secs[n].html}</section>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Azalea e-Helpdesk Quick Start</title><meta name="author" content="Azalea Hotels &amp; Residences"><link rel="stylesheet" href="common.css"><link rel="stylesheet" href="quick.css"></head><body><div class="page">
<header><div><div class="brand">Azalea Hotels &amp; Residences</div><h1>Azalea e-Helpdesk <span>Quick start</span></h1></div><div class="intro">${intro.map((l) => `<p>${mdi(l)}</p>`).join('')}</div></header>
<main><div class="col">${card(1)}${card(3)}${card(5)}</div><div class="col">${card(2)}${card(4, 'safe')}<section class="card who"><h2>Who can do what</h2>${table}</section></div></main>
<footer><h2>${secs[6].title}</h2>${secs[6].html}</footer><div class="band"><i></i><b></b></div></div></body></html>`;
  writeFileSync(join(BUILD, 'quick.html'), html);
}

/* ---------- PDF ---------- */
async function finish(file, title, subject) {
  const doc = await PDFDocument.load(readFileSync(file));
  doc.setTitle(title); doc.setAuthor('Azalea Hotels & Residences'); doc.setSubject(subject);
  doc.setCreator('Azalea e-Helpdesk docs build'); doc.setProducer('Chrome + paged.js');
  writeFileSync(file, await doc.save({ useObjectStreams: true }));
  return doc.getPageCount();
}

const { toc } = await buildGuide();
buildQuick();
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => { // paged.js reads stylesheets with XHR, which file:// forbids
  try { const f = join(BUILD, decodeURIComponent(req.url.split('?')[0])); res.setHeader('content-type', TYPES[f.slice(f.lastIndexOf('.'))] || 'text/plain'); res.end(await readFile(f)); } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const browser = await launch();
try {
  const pdfOpts = { printBackground: true, preferCSSPageSize: true, outline: true, tagged: true, timeout: 0 };

  const page = await browser.newPage();
  page.on('pageerror', (e) => console.warn('page error:', e.message));
  await page.goto(`${base}/guide.html`, { waitUntil: 'networkidle0', timeout: 0 });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ path: join(here, 'node_modules', 'pagedjs', 'dist', 'paged.polyfill.js') });
  await page.evaluate(async () => { await window.PagedPolyfill.preview(); await document.fonts.ready; });
  const pages = await page.evaluate(() => document.querySelectorAll('.pagedjs_page').length);
  console.log('paged.js pages:', pages);
  const guide = join(OUTDIR, 'Azalea-HelpDesk-Help-Guide.pdf');
  await page.pdf({ ...pdfOpts, path: guide });
  await page.close();

  const q = await browser.newPage();
  await q.goto(`${base}/quick.html`, { waitUntil: 'networkidle0' });
  await q.evaluate(() => document.fonts.ready);
  const quick = join(OUTDIR, 'Azalea-HelpDesk-Quick-Start.pdf');
  await q.pdf({ ...pdfOpts, path: quick });
  await q.close();

  const gp = await finish(guide, 'Azalea e-Helpdesk Help Guide', 'Help Guide for hotel owners and staff');
  const qp = await finish(quick, 'Azalea e-Helpdesk Quick Start', 'One-page quick start for hotel owners and staff');
  const mb = (f) => (statSync(f).size / 1048576).toFixed(1);
  console.log(`Guide: ${gp} pages, ${mb(guide)} MB\nQuick start: ${qp} page(s), ${mb(quick)} MB`);
  writeFileSync(join(BUILD, 'toc.json'), JSON.stringify(toc, null, 1));
} finally { await browser.close(); server.close(); }
