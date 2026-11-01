# Demo screenshots

The pictures show the 11-area desk: Dashboard (with the shift handover panel), Requests, Inquiries, Cleaning, Work Orders, House Status, Crisis Mgmt, Transport, Reminders, Reports and Configuration.

1. Install: `cd demo && npm install` (puppeteer only; set `CHROME_PATH` if its Chromium download is blocked, a cached or installed Chrome is also found).
2. Capture: `npm run capture` starts `scripts/mock-wp.mjs` on a free port (build the desk first with `npm run build:wp` in the repo root), walks every scene, then runs the checks. `npm run capture -- --only=B,C` runs some chapters (later chapters may need the data an earlier one made); `npm run check` re-checks.
   - To leave `azalea-ehelpdesk/assets/` alone, build into a private folder and point the mock at it: `AZL_OUT=<dir>/desk npm run build:wp` (repo root, copy `azalea-ehelpdesk/assets/fonts` to `<dir>/fonts`), then `AZL_ASSETS=<dir> npm run capture`.
   - `SHOTS_OUT=<dir>` writes the pictures somewhere else than `demo/shots/` (handy while trying a chapter).
   - `node capture/probe.mjs <role> "<area>" [desktop|phone]` lists what is on screen in an area; `node capture/probe2.mjs '<json steps>' [role] [vp]` clicks through steps and lists the open sheet (set `PROBE_OUT` for the picture).
3. Outputs in `demo/shots/`: `desktop/` (1920x1080), `phone/` (780x1688), `pins/desktop|phone/` (same pictures with numbered pointers), `manifest.json`, `contact-sheet.html`.
4. `manifest.json`: `chapters[{id,name,role,summary}]` and `shots[{id,file,viewport,hotel,role,title,say,chapter?,targets[{label,action,box,typed?}],pins[{n,label,box,at}],pinsFile}]`; boxes are in image pixels, targets are in the order the cursor visits them.
5. Sign-in pictures come from the real staging sites (GET only, plus one fake sign-in on Baguio); the rest comes from the mock, so no real data is shown.
6. Chapters (files in `capture/`): A sign-in, B Dashboard, B2 two hotels, C Requests, D working on a request, E safety alerts (`scenes-desk.mjs`); F Inquiries, G Cleaning, H Work Orders, I House Status, K Crisis Mgmt, L Transport, M Reminders (`scenes-modules.mjs`); R Reports, S Configuration (`scenes-admin.mjs`); PH phone (`scenes-phone.mjs`); J shared phone, N who sees what, O no internet, Q1 to Q4 a day as each role, P a quiet day (`scenes-roles.mjs`).
7. Limits of the mock: `?empty=1` only empties the request, work order and cleaning data of the old desk, so the quiet-day chapter shows the Dashboard, Requests and Reports but not an empty Inquiries, House Status, Crisis, Transport or Reminders.
