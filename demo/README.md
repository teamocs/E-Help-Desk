# Demo screenshots

1. Install: `cd demo && npm install` (puppeteer only; set `CHROME_PATH` if its Chromium download is blocked, a cached or installed Chrome is also found).
2. Capture: `npm run capture` starts `scripts/mock-wp.mjs` on a free port (build the desk first with `npm run build:wp` in the repo root), walks every scene, then runs the checks. `npm run capture -- --only=B,C` runs some chapters; `npm run check` re-checks.
3. Outputs in `demo/shots/`: `desktop/` (1920x1080), `phone/` (780x1688), `pins/desktop|phone/` (same pictures with numbered pointers), `manifest.json`, `contact-sheet.html`.
4. `manifest.json`: `chapters[{id,name,role,summary}]` and `shots[{id,file,viewport,hotel,role,title,say,chapter?,targets[{label,action,box,typed?}],pins[{n,label,box,at}],pinsFile}]`; boxes are in image pixels, targets are in the order the cursor visits them.
5. Sign-in pictures come from the real staging sites (GET only, plus one fake sign-in on Baguio); the rest comes from the mock, so no real data is shown.
