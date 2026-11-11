# Testing build log

A running record of the work to give Collage Maker a test suite. It tracks the plan, progress on each PR, the bugs found and how they were fixed, and anything else learned along the way.

**Plan source:** [HANDOFF-testing.md](HANDOFF-testing.md). Item numbers like "#7" refer to its "What has never been run" list.
**Started:** 2026-11-10

## Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-11-10 | Use **Playwright** for browser tests. Add a `package.json` with Playwright as the only dev dependency. The app itself stays dependency-free. | It handles downloads, file inputs, dialogs, drag-and-drop and screenshot comparison out of the box, and runs Chromium, Firefox and WebKit (#15). |
| 2026-11-10 | Use plain `node:test` + `fetch` for server tests. No browser. | It's fast and needs no dependencies. It covers #13 cheaply. |
| 2026-11-10 | Split the work into 8 PRs, one branch each (`CM-1` … `CM-8`). | A single PR would be too large to review. Each PR leaves the suite green and makes sense on its own. |
| 2026-11-10 | Check state before screenshots: act through the UI, then assert on `CM.app.doc`. | It keeps the tests stable and fast. Screenshots are kept for things that only exist as pixels. |
| 2026-11-10 | Add a dependency-free `package.json` in CM-1, so `npm test` is the one command from the start. CM-2 adds Playwright to it. | Node 24's `node --test` needs a glob rather than a folder name, so a script saves everyone from remembering it. |
| 2026-11-10 | Browser tests live in `e2e/`, server tests stay in `test/`. Test pictures are generated in code, never copied from `library/`. | The two runners stay separate and simple. Generated pictures are small, known and free to publish, which the portfolio plan needs (F6). |
| 2026-11-10 | The `page` fixture fails any test that logs a page error or `console.error`. | The earlier manual runs used "no errors" as their main check, so it should be automatic. It caught B5 straight away. |
| 2026-11-10 | `server.js` exports `createServer({ dataDir })` and only listens when run directly. `PORT=0` now means "pick a free port". | Tests start a server in-process on a temp folder and a free port, with no child process to manage. Before this, `PORT=0` silently fell back to 5173. |

## PR plan

Ordered so the riskiest gaps (losing a user's work) get covered first, and so the refactor in CM-7 lands only after browser tests can catch regressions.

| PR | Branch | Scope | Handoff items | Status |
| --- | --- | --- | --- | --- |
| 1 | `CM-1` | This log. Add a `COLLAGE_DATA_DIR` env var so the server can use a temp folder. Server tests on `node:test`. Fix any server bugs found. | Step 1, #13 | Merged ([#1](https://github.com/ktocdev/collage-maker/pull/1)) |
| 2 | `CM-2` | Playwright added to `package.json`, Playwright config, a fixture that starts the server on a temp data dir and a free port, and a smoke test (page loads, no console errors). Then the Save → reload → Open round trip. | Step 2, #1 | In progress |
| 3 | `CM-3` | Re-editing an art layer already on the canvas (`delta` compensation for rotated, scaled, flipped and trimmed layers, with and without keyframes). Canvas undo and redo. | #2, #3 | Not started |
| 4 | `CM-4` | Selection handles (resize, Shift-stretch, rotate, Shift-snap, on flipped and rotated layers). Timeline: scrub, retime, drop-on-key, double-click delete, duration and fps changes. Playback, motion presets and easing values. | #6, #7, #8 | Not started |
| 5 | `CM-5` | Library input paths (upload, drop files, drag to canvas, double-click). Layer panel. Properties panel. The rest of the editor. | #9, #10, #11, #12 | Not started |
| 6 | `CM-6` | PNG export, HTML export (screenshot compared with a tolerance), video export (non-empty WebM at most). Reference images for every pattern, texture and effect. | #4, #5, #14, Step 4 | Not started |
| 7 | `CM-7` | Move the pure maths out of the `app.js` IIFE (`evalBase`, `evalLayer`, easings, `shapeD`, `toDoc`/`unrot`, `snapT`, `cloneLayer`) and unit-test it in Node. | Step 3 | Not started |
| 8 | `CM-8` | Run the suite on Firefox and WebKit, and fix or document the differences. Optional GitHub Actions CI. Update README and ARCHITECTURE (both currently say there are no tests). Final check against the definition of done. | #15, DoD | Not started |
| 9 | `CM-9` | *Proposed, scope not agreed.* A static build for hosting on a portfolio, with no `server.js`. See F6. | — | Proposed |

Every PR also:
- updates this log (its progress, bugs and findings),
- runs the full suite from a clean checkout with one command,
- never writes into the real `library/` or `exports/` folders.

## Progress

### CM-1: server testability and server tests

- [x] Branch created
- [x] Handoff, architecture doc and `server.js` read. PR plan written (above)
- [x] `COLLAGE_DATA_DIR`: the data root for `library/` and `exports/`, defaulting to the project folder. It covers the API and the static `/library/` and `/exports/` routes (F1)
- [x] Server tests: 32 tests in [test/server.test.js](test/server.test.js). They cover the library list, uploads (name sanitising, collisions including concurrent ones, exactly 40 MB vs over 40 MB, kinds), exports (file-list validation, slugs, collisions, base64 vs text, malformed payloads, the 300 MB limit), the origin check on both endpoints, path traversal (encoded `/` and `\`, out of both roots), 400, 404, 405 and HEAD
- [x] Bugs found and fixed: B1, B2, B3 (below)
- [x] Static files restricted to an allowlist (F2). 35 tests now
- [x] Suite passes 3 runs in a row (about 1.7 s). The real `library/` and `exports/` are untouched
- [x] ARCHITECTURE.md updated for the new env var, `PORT=0` and the server's behaviour
- [x] PR opened: [#1](https://github.com/ktocdev/collage-maker/pull/1)
- [x] Merged into `main` on 2026-11-10 (merge commit `04196ba`)

**Run:** `npm test`

### CM-2: Playwright harness and project Save/Open

- [x] Branch created from `main` after CM-1 merged
- [x] Playwright 1.65.0 added as the only dev dependency (pinned exactly). `npm install` also downloads Chromium (`postinstall`). `npm test` runs the server tests, then the browser tests. `npm run test:server` and `npm run test:e2e` run each on its own
- [x] Fixture ([e2e/support/fixtures.js](e2e/support/fixtures.js)): a server per test worker on a free port, with a temp data folder seeded with three generated pictures ([e2e/support/png.js](e2e/support/png.js)). The real library is never used
- [x] Fixture fails a test on any uncaught page error or `console.error`. Chrome's `willReadFrequently` advice is ignored, per the handoff
- [x] Start-up signal: `CM.app.ready` (F5, resolved)
- [x] Smoke tests ([e2e/smoke.spec.js](e2e/smoke.spec.js)), 4 tests: default document, library order and thumbnails, no error message, seeded library only
- [x] Project tests ([e2e/project.spec.js](e2e/project.spec.js)), 8 tests (#1):
  - Save's file contents, including that a shared art state is stored once
  - Save → reload → Open: every layer field, keyframes, fills, motion and art sharing compared exactly; art `orig`/`mask`/`out` and 7 rendered frames compared pixel by pixel
  - Fresh ids and no selection after Open; Save → Open → Save → Open is stable; Ctrl+S; non-project and broken JSON; damaged projects (B4, B5); opening the same file twice
  - The scene covers: an edited cut-out (erased and half-transparent mask, 3 effects), flipped, scaled and rotated layers, a duplicate sharing art, a soft-alpha picture, a hidden layer, a star with radial gradient and outline, a pattern rect, a smooth textured path, an open line, a gradient fill with blend, and a textured background. Each uses its own ease and motion, and the doc has a non-default size, duration, fps and loop
- [x] **Sanity check that the tests can fail.** The app was broken on purpose 3 ways (Save drops effects, Open ignores `loop`, Open nudges a layer 1 px). The suite caught all three
- [x] Bugs found and fixed: B4, B5 (below)
- [x] Suite passes 3 runs in a row: 35 server + 12 browser tests, about 4 s for the browser part
- [x] ARCHITECTURE.md updated (test folders, `CM.app.ready`, Open validation)
- [ ] PR opened

## Bugs

| # | Found in | Severity | Description | Status | Fix |
| --- | --- | --- | --- | --- | --- |
| B1 | CM-1 | High | A POST carrying `Origin: null` (or any Origin that isn't a URL) **crashed the server process**. `new URL('null')` threw inside the request handler, and nothing caught it. Browsers send `Origin: null` from sandboxed iframes, `file://` pages and some redirects, so any such page could take the app down. Reproduced against the original server before fixing. | Fixed in CM-1 | A `sameOrigin(req)` helper wraps the parse in `try` and treats an unparseable Origin as foreign (403). Tests: `rejects an unparseable Origin…` for both endpoints |
| B2 | CM-1 | Medium | Malformed export payloads were mishandled. A file entry with no `text` or `base64` was written as the literal text `undefined` (returning 200). A JSON body of `null`, or one that wasn't JSON, returned 500 with an internal error message instead of 400. Reproduced against the original server. | Fixed in CM-1 | The export endpoint validates the payload before creating any folder: each entry needs an allowed `path` and string `text` or `base64`. Bad JSON gets 400. Test: `export rejects malformed payloads…` |
| B4 | CM-2 | Medium | **Opening a damaged project half-applied it.** `openProject` copied the file's size, duration, fps and loop onto the document *before* reading the layers. A file with no `layers` list changed the canvas to the file's settings, then failed, leaving the user's work on the wrong canvas size and with the controls out of sync. Reproduced by test before fixing. | Fixed in CM-2 | Open now checks the file's shape (`doc`, `layers`, `arts`, positive numeric settings) and builds every art state and layer first. It only assigns to `doc` once all of that succeeds. Only the five known settings are copied, not the whole `doc` object. Test: `Opening a damaged project…` |
| B5 | CM-2 | Medium | **A project whose art layer pointed at a missing picture broke the page.** The layer was added with `art: undefined`, so every redraw threw `Cannot read properties of undefined (reading 'bounds')`. No message was shown. Reproduced against the original code. Separately, a picture that failed to decode put its whole base64 data URL into the toast. | Fixed in CM-2 | Each art layer's index is checked while building the layers, giving "The project file is damaged." An unreadable picture gives "A picture in the project file could not be read." |
| B3 | CM-1 | Low | `PORT=0` was ignored (`Number('0') \|\| 5173` is 5173), so the server couldn't be asked for a free port. The start-up message also printed the configured port, not the real one. | Fixed in CM-1 | `PORT` is used whenever it's set. The message prints `server.address().port` |

## Findings

Things learned that aren't bugs, or that still need a decision.

- **F1 (CM-1):** The data root and the static root are tangled together. The app loads library pictures by URL (`library/…`, `exports/…`), and those URLs are served by the general static handler from the project folder. So `COLLAGE_DATA_DIR` has to cover the static routes for `/library/` and `/exports/` as well as the API, or images saved during a test won't load in the browser.
- **F2 (CM-1), resolved:** The static handler served *any* file under the project folder: `.git/`, `server.js`, the docs, the tests. **Decision (2026-11-10):** serve only files that are safe to make public, because a version of the app will be hosted on a portfolio site. The server now serves from an allowlist: `index.html`, `style.css`, `js/*.js` (one level, word characters only), images under `library/`, and `.html`/`.css`/`.png` under `exports/` (the only types `/api/export` writes). Everything else answers 404, so the server doesn't reveal that a file exists. Tests: `serves every file the page needs`, `never serves server code, docs, tests, config or git data`, `library/ serves images only…`.
  - Trade-off: someone who hand-edits an export and adds a separate `.js` or `.json` file won't have it served locally. The existing export keeps its animation code inline and loads GSAP from a CDN, so it's unaffected. Widen `EXPORT_FILE` in `server.js` if that's ever needed.
  - **When adding a new static asset** (a font, an icon, a new script folder), add it to `APP_FILES` / `APP_SCRIPT` in `server.js`, or it will 404.
- **F3 (CM-1):** Upload and export check whether a name already exists, then write it later. Two saves at the same moment could pick the same name. **Partly fixed:** uploads now write with the `wx` flag, so a collision returns 500 instead of overwriting. Exports can still race. That's unlikely for a single local user, so it's left as is.
- **F4 (CM-1):** When an upload goes over the size limit, the server answers 413 and then closes the connection. A client that is still sending (Node's `fetch`, possibly browsers) may see a connection reset instead of the 413. The tests accept either. The app's own uploads are cropped PNGs far below 40 MB, so this only matters for very large files dropped onto the library. Revisit in CM-5 (#9).
- **F6 (CM-1): portfolio hosting is a separate piece of work.** A portfolio host (GitHub Pages, Netlify and similar) serves static files only, so `server.js` won't run there. The hosted version has to:
  1. load its library from a static list of demo pictures instead of `GET /api/library`,
  2. drop or replace the three server-backed actions: Save piece to library, image upload into `library/`, and HTML export to `exports/` (a ZIP download could stand in for export),
  3. ship demo pictures you own or that are licensed for reuse. The personal pictures in `library/` and `exports/` stay out of the repo (`.gitignore`).
  Project Save/Open, PNG and video already work with no server. This is proposed as **CM-9** after the test suite exists, so the static build can run the same Playwright tests. Not started; scope to be agreed.
- **F5 (CM-1), resolved in CM-2:** Tests needed to know when start-up had finished. `app.js` now keeps the promise from `loadLibrary()` and exposes it as `CM.app.ready`. This is the only app change CM-2 needed besides the B4/B5 fix.
- **F7 (CM-2):** Open ignores the file's `version`. A file from a future version with a changed format would be opened as if it were version 1. Nothing writes anything but version 1 today, so this is logged only. Whoever bumps the version should add a check ("made with a newer version").
- **F8 (CM-2), for CM-3 (from reading the code, not yet tested):** Open doesn't clear undo history; it pushes a new snapshot. So **Undo right after Open goes back to the project that was open before.** That may be intended, but it's surprising. Also, undo snapshots don't store `doc.loop`, so undo never changes the Loop checkbox. Both are to be checked in CM-3 (undo/redo).
- **F9 (CM-2):** Rendered frames and art pixels match after a round trip within 2 levels per channel (the test's threshold), including the soft-alpha picture and the half-transparent mask. So the PNG data-URL encoding of `orig` and `mask` loses nothing that shows.
- **F10 (CM-2):** `npm install` downloads Chromium (about 120 MB) through `postinstall`, so a fresh clone needs only `npm install && npm test`. If that's unwanted for people who only run the app, the app itself needs no install at all: `node server.js` still works with nothing installed.
