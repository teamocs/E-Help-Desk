# Help guide PDFs
Builds `docs/pdf/Azalea-HelpDesk-Help-Guide.pdf` and `docs/pdf/Azalea-HelpDesk-Quick-Start.pdf` from `docs/HELP-GUIDE.md` and `docs/QUICK-START.md`.
Rebuild: `cd demo/pdf && npm install && npm run build` (about 10 seconds).
Needs Chrome: set `CHROME_PATH` or let it find the cached one (same as `demo/capture`); also run `npm install` in `demo/` once for puppeteer.
Look is in `common.css`, `guide.css`, `quick.css`; the Markdown to HTML steps are in `build.mjs`. `build/` is a throwaway folder.
