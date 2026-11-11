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
| 2026-11-10 | `server.js` exports `createServer({ dataDir })` and only listens when run directly. `PORT=0` now means "pick a free port". | Tests start a server in-process on a temp folder and a free port, with no child process to manage. Before this, `PORT=0` silently fell back to 5173. |

## PR plan

Ordered so the riskiest gaps (losing a user's work) get covered first, and so the refactor in CM-7 lands only after browser tests can catch regressions.

| PR | Branch | Scope | Handoff items | Status |
| --- | --- | --- | --- | --- |
| 1 | `CM-1` | This log. Add a `COLLAGE_DATA_DIR` env var so the server can use a temp folder. Server tests on `node:test`. Fix any server bugs found. | Step 1, #13 | In review |
| 2 | `CM-2` | `package.json`, Playwright config, a fixture that starts the server on a temp data dir and a free port, and a smoke test (page loads, no console errors). Then the Save → reload → Open round trip. | Step 2, #1 | Not started |
| 3 | `CM-3` | Re-editing an art layer already on the canvas (`delta` compensation for rotated, scaled, flipped and trimmed layers, with and without keyframes). Canvas undo and redo. | #2, #3 | Not started |
| 4 | `CM-4` | Selection handles (resize, Shift-stretch, rotate, Shift-snap, on flipped and rotated layers). Timeline: scrub, retime, drop-on-key, double-click delete, duration and fps changes. Playback, motion presets and easing values. | #6, #7, #8 | Not started |
| 5 | `CM-5` | Library input paths (upload, drop files, drag to canvas, double-click). Layer panel. Properties panel. The rest of the editor. | #9, #10, #11, #12 | Not started |
| 6 | `CM-6` | PNG export, HTML export (screenshot compared with a tolerance), video export (non-empty WebM at most). Reference images for every pattern, texture and effect. | #4, #5, #14, Step 4 | Not started |
| 7 | `CM-7` | Move the pure maths out of the `app.js` IIFE (`evalBase`, `evalLayer`, easings, `shapeD`, `toDoc`/`unrot`, `snapT`, `cloneLayer`) and unit-test it in Node. | Step 3 | Not started |
| 8 | `CM-8` | Run the suite on Firefox and WebKit, and fix or document the differences. Optional GitHub Actions CI. Update README and ARCHITECTURE (both currently say there are no tests). Final check against the definition of done. | #15, DoD | Not started |

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
- [x] Suite passes 3 runs in a row (about 1.7 s). The real `library/` and `exports/` are untouched
- [x] ARCHITECTURE.md updated for the new env var, `PORT=0` and the server's behaviour
- [ ] PR opened

**Run:** `npm test`

## Bugs

| # | Found in | Severity | Description | Status | Fix |
| --- | --- | --- | --- | --- | --- |
| B1 | CM-1 | High | A POST carrying `Origin: null` (or any Origin that isn't a URL) **crashed the server process**. `new URL('null')` threw inside the request handler, and nothing caught it. Browsers send `Origin: null` from sandboxed iframes, `file://` pages and some redirects, so any such page could take the app down. Reproduced against the original server before fixing. | Fixed in CM-1 | A `sameOrigin(req)` helper wraps the parse in `try` and treats an unparseable Origin as foreign (403). Tests: `rejects an unparseable Origin…` for both endpoints |
| B2 | CM-1 | Medium | Malformed export payloads were mishandled. A file entry with no `text` or `base64` was written as the literal text `undefined` (returning 200). A JSON body of `null`, or one that wasn't JSON, returned 500 with an internal error message instead of 400. Reproduced against the original server. | Fixed in CM-1 | The export endpoint validates the payload before creating any folder: each entry needs an allowed `path` and string `text` or `base64`. Bad JSON gets 400. Test: `export rejects malformed payloads…` |
| B3 | CM-1 | Low | `PORT=0` was ignored (`Number('0') \|\| 5173` is 5173), so the server couldn't be asked for a free port. The start-up message also printed the configured port, not the real one. | Fixed in CM-1 | `PORT` is used whenever it's set. The message prints `server.address().port` |

## Findings

Things learned that aren't bugs, or that still need a decision.

- **F1 (CM-1):** The data root and the static root are tangled together. The app loads library pictures by URL (`library/…`, `exports/…`), and those URLs are served by the general static handler from the project folder. So `COLLAGE_DATA_DIR` has to cover the static routes for `/library/` and `/exports/` as well as the API, or images saved during a test won't load in the browser.
- **F2 (CM-1):** The static handler serves *any* file under the project folder. Now that the project is a git repo, that includes `.git/`, `server.js` and the docs. The server listens on `127.0.0.1` only, so this is low risk. Worth deciding whether to limit it to the app's own files plus `library/` and `exports/`.
  The tests confirm it: `/%2e%2e/%2e%2e/server.js` is served, because URL parsing resolves it to `/server.js`. That isn't a traversal. Real escapes out of the app or data folders are refused. **Still open: needs your decision.**
- **F3 (CM-1):** Upload and export check whether a name already exists, then write it later. Two saves at the same moment could pick the same name. **Partly fixed:** uploads now write with the `wx` flag, so a collision returns 500 instead of overwriting. Exports can still race. That's unlikely for a single local user, so it's left as is.
- **F4 (CM-1):** When an upload goes over the size limit, the server answers 413 and then closes the connection. A client that is still sending (Node's `fetch`, possibly browsers) may see a connection reset instead of the 413. The tests accept either. The app's own uploads are cropped PNGs far below 40 MB, so this only matters for very large files dropped onto the library. Revisit in CM-5 (#9).
- **F5 (CM-1):** `CM.app` (the test hook) and the server's `createServer` are the only test seams so far. CM-2 will need the page to report when start-up has finished, for example by waiting for the `/api/library` response, so tests don't race the initial library load.
