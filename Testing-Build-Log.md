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
| 2 | `CM-2` | Playwright added to `package.json`, Playwright config, a fixture that starts the server on a temp data dir and a free port, and a smoke test (page loads, no console errors). Then the Save → reload → Open round trip. | Step 2, #1 | Merged ([#2](https://github.com/ktocdev/collage-maker/pull/2)) |
| 3 | `CM-3` | Re-editing an art layer already on the canvas (`delta` compensation for rotated, scaled, flipped and trimmed layers, with and without keyframes). Canvas undo and redo. | #2, #3 | Merged ([#3](https://github.com/ktocdev/collage-maker/pull/3)) |
| 4 | `CM-4` | Selection handles (resize, Shift-stretch, rotate, Shift-snap, on flipped and rotated layers). Timeline: scrub, retime, drop-on-key, double-click delete, duration and fps changes. Playback, motion presets and easing values. | #6, #7, #8 | Merged ([#4](https://github.com/ktocdev/collage-maker/pull/4)) |
| 5 | `CM-5` | Library input paths (upload, drop files, drag to canvas, double-click). Layer panel. Properties panel. The rest of the editor. | #9, #10, #11, #12 | In progress |
| 6 | `CM-6` | PNG export, HTML export (screenshot compared with a tolerance), video export (non-empty WebM at most). Reference images for every pattern, texture and effect. | #4, #5, #14, Step 4 | Not started |
| 7 | `CM-7` | Move the pure maths out of the `app.js` IIFE (`evalBase`, `evalLayer`, easings, `shapeD`, `toDoc`/`unrot`, `snapT`, `cloneLayer`) and unit-test it in Node. | Step 3 | Not started |
| 8 | `CM-8` | Run the suite on Firefox and WebKit, and fix or document the differences. Optional GitHub Actions CI. Update README and ARCHITECTURE (both currently say there are no tests). Final check against the definition of done. | #15, DoD | Not started |
| 9 | `CM-9` | *Proposed, scope not agreed.* A static build for hosting on a portfolio, with no `server.js`. See F6. | — | Proposed |
| 10 | `CM-10` | *Proposed.* Fix B6 with a pivot offset on art layers. Done when the 4 `test.fail` tests in `re-edit.spec.js` pass and their `test.fail` lines are removed. Can go any time after CM-3; doing it before CM-6 means the HTML export test covers the new offset. | B6 | Proposed |

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
- [x] A fresh clone passes with `npm ci && npm test`
- [x] PR opened: [#2](https://github.com/ktocdev/collage-maker/pull/2)
- [x] Merged into `main` on 2026-11-10 (merge commit `3313b65`)

### CM-3: re-editing art on the canvas, and undo/redo

- [x] Branch created from `main` after CM-2 merged
- [x] Editor driver ([e2e/support/editor.js](e2e/support/editor.js)): opens the editor with the properties-panel button, draws scissors loops with real mouse events in picture coordinates, and clicks Trim, Apply and Cancel
- [x] Re-edit tests ([e2e/re-edit.spec.js](e2e/re-edit.spec.js)), 33 tests (#2). Method: render the board before and after the edit; every pixel that is fully opaque in both renders must keep its colour (within 16 levels); nothing may appear where the board was empty; and at least 97% of what remains must overlap where it was
  - 6 transforms (plain, rotated, stretched, flipped, flipped + stretched + rotated, upside down) × 4 cuts (half, half + Trim, corner + Trim, off-centre island + Trim): **all 24 pass**. The `delta` compensation is correct at rest
  - With 3 keyframes that change position, rotation, scale and flip: **passes at every keyframe**
  - **Fails between keyframes, and during wobble, pulse and spin motions (B6).** These 4 tests are marked `test.fail`, so they run and are expected to fail. When B6 is fixed, Playwright will report them as unexpectedly passing, and the `test.fail` lines must then be removed
  - Re-editing the same layer twice, Cancel, art immutability after Apply, and Undo/Redo after Apply: all pass
- [x] Undo tests ([e2e/undo.spec.js](e2e/undo.spec.js)), 6 tests (#3):
  - A 20-step sequence through the UI: draw, nudge, drag, opacity, fill type, rename, motion, add art by double-click, keyframe with K, keyframe by moving, Ctrl+D, send backward, hide, Flip, cut in the editor, Delete key, canvas size, duration (which drops a keyframe), fps, Loop. Each undo must equal the earlier state exactly (every layer field, art identity, selection). Then redo to the end. Uses the buttons, Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z
  - A new action after undo clears redo; history holds 80 states (79 undos); changing the live document after an undo doesn't alter what redo brings back; Ctrl+Z inside the editor doesn't touch the canvas; Undo after Open (F8)
- [x] Sanity check: with the B7 fix taken out again, 3 undo tests fail
- [x] Bugs: B7 fixed; B6 logged, not fixed (your decision, 2026-11-10)
- [x] Suite passes 3 runs in a row: 35 server + 51 browser tests (4 of them expected failures), about 17 s for the browser part
- [x] PR opened: [#3](https://github.com/ktocdev/collage-maker/pull/3)
- [x] Manual check by you in the real app: rotate a picture, cut part away in the editor, Apply, Undo. **Worked as expected** (no jump, undo restored it)
- [x] Merged into `main` on 2026-11-10 (merge commit `aca7f83`)

### CM-4: selection handles, timeline, playback

- [x] Branch created from `main` after CM-3 merged
- [x] Shared helpers moved to [e2e/support/board.js](e2e/support/board.js): board coordinates, drags (with Shift and waypoints), shortcut keys, layer rows, adding from the library. `CM.app` also exposes `evalBase` and `evalLayer`
- [x] Selection handles ([e2e/handles.spec.js](e2e/handles.spec.js)), 24 tests (#6). On 5 layer kinds (plain, rotated, flipped, flipped + stretched + rotated, upside down):
  - a corner drag resizes uniformly and keeps the flip
  - Shift + corner stretches one axis at a time, along the layer's own axes
  - the knob rotates by the angle moved; Shift snaps to 15°
  - also: most of a turn in one drag (B8); each drag is one undo step; a drag on a keyframed layer writes to the keyframe at the playhead; handles hide while playing
- [x] Timeline ([e2e/timeline.spec.js](e2e/timeline.spec.js)), 14 tests (#7): scrubbing with frame snapping and clamping; retiming by drag (with undo); dragging past another keyframe; the preview during that drag; dropping onto another; double-click to delete; two slow clicks don't delete; deleting the last keyframe; the ◇ Remove button; shortening the duration (B9); duration clamping; an fps change re-snapping the playhead; K once per frame
- [x] Playback ([e2e/playback.spec.js](e2e/playback.spec.js)), 8 tests (#8), on Playwright's fake clock, paused, so time only moves when a test says: Play/Pause with frame snap; Loop on wraps; Loop off stops at the end and Play restarts from 0; Space (and not while typing; and once only on a focused button); Rewind; pressing the board pauses; **the board shows whole frames only while playing** (pixel-compared with the frame before and the exact time)
- [x] Motion and easing ([e2e/motion.spec.js](e2e/motion.spec.js)), 15 tests (#8): each preset's range, period, starting at rest, and untouched properties at two amount/speed settings; spin's rate; shake's bounds, its 12 × speed steps per second, and that it repeats exactly; each easing's values (Steady, Smooth = smoothstep, Jump, Overshoot peaking 105–115%); every easing showing each keyframe's own pose at its time (B10); holding before the first and after the last keyframe
- [x] Sanity check: with each fix taken out again, its test fails (B8, B9, B10)
- [x] Flakiness: two timing races in the *tests* were found and fixed (F14). The timeline and playback specs then passed 10 repeats each (140/140 and 80/80)
- [x] Bugs found and fixed: B8, B9, B10
- [x] Suite passes 3 runs in a row: 35 server + 112 browser tests (4 expected failures for B6), about 25 s for the browser part
- [x] PR opened: [#4](https://github.com/ktocdev/collage-maker/pull/4)
- [x] Manual checks by you in the real app: (1) a long knob rotation with keyframes at 0 s and 2 s plays in the direction dragged; (2) with "Jump", the piece follows the mouse while the playhead is on a middle keyframe. **Both worked as expected.** This also confirms the B10 side effect noted from code reading
- [x] Merged into `main` on 2026-11-10 (merge commit `32ee14b`)

### CM-5: library inputs, layer and properties panels, the rest of the editor

- [x] Branch created from `main` after CM-4 merged
- [x] Library ([e2e/library.spec.js](e2e/library.spec.js)), 10 tests (#9): Upload via the real file chooser (multiple files, bytes saved, back after a reload, usable on the board); non-image files ignored; a format the folder can't keep (B11); a taken name (B12); dropping files on the panel; dragging a tile onto the board (placed at the drop point); double-click (centred, small pictures not enlarged); Add/Edit enabled only with a selection; two adds give independent layers sharing only the source pixels; distinct button names (F13)
- [x] Layer panel ([e2e/layers.spec.js](e2e/layers.spec.js)), 13 tests (#10): list order and selection; ▲ ▼ and Ctrl+] / Ctrl+[ including the ends; drag to reorder in both directions with undo; an abandoned drag (B13); Duplicate (offset, keyframes offset too, fill layers not offset); Delete and Backspace; the eye (selection unchanged, hidden layers can't be clicked); rename (list and timeline, one undo step); shortcuts ignored while typing a name; the fill button; the ◆ marker
- [x] Properties panel ([e2e/props.spec.js](e2e/props.spec.js)), 18 tests (#11): every control (opacity, blend, each fill type and its options, "No fill", outline, X/Y, Size %, Rotate, Closed shape, Smooth curves, Flip, Edit, Add keyframe, Movement, Clear all, looping motion with Amount and Speed). Each is checked as exactly **one undo step** that redo re-applies. Also: Size % keeps a flip and stops at 1%; an emptied field (B14); fields follow the playhead and write to its keyframe; what fill layers and two-point lines don't offer; the empty-selection message
- [x] Editor ([e2e/editor.spec.js](e2e/editor.spec.js)), 21 tests (#12), read back from the layer's mask after Apply: eraser; soft edge; restore brush; [ and ]; magic wand connected, everywhere, and its tolerance (blue fades to the predicted alpha 198 ± 2); scissors "remove"; Invert; Restore all; undo/redo with buttons and keys; undoing a Trim; E/R/W/L; wheel zoom keeping the point under the cursor; panning with the Pan tool, Space + drag and right-drag; backdrop colours; effect presets, sliders and Reset; Save piece to library; editing a library picture
- [x] **Sanity check:** 3 editor tests could pass with the feature broken in my first draft (tolerance, zoom, pan). Rewritten so the expected result differs from "nothing happened", then confirmed by breaking wheel zoom, panning and the non-connected wand: their tests fail. Each bug fix below was also taken out again to confirm its test fails
- [x] Fixture change: `test.use({ isolate: true })` gives a spec a fresh server per test. Used by the library and editor specs, which write to the library folder (F18)
- [x] F4 revisited: covered by B11's fix. A failed copy (413, a reset connection, no server) now shows the "this session only" message instead of failing silently. Not tested with a real 40 MB file, to keep the suite fast
- [x] F13 resolved: the library's button now has the accessible name "✂ Edit / cut out the selected library picture"; its visible text is unchanged
- [x] Bugs found and fixed: B11, B12, B13, B14. No editor bugs found
- [x] Suite passes 3 runs in a row: 35 server + 174 browser tests (4 expected failures for B6), about 33 s for the browser part
- [ ] PR opened

## Bugs

| # | Found in | Severity | Description | Status | Fix |
| --- | --- | --- | --- | --- | --- |
| B1 | CM-1 | High | A POST carrying `Origin: null` (or any Origin that isn't a URL) **crashed the server process**. `new URL('null')` threw inside the request handler, and nothing caught it. Browsers send `Origin: null` from sandboxed iframes, `file://` pages and some redirects, so any such page could take the app down. Reproduced against the original server before fixing. | Fixed in CM-1 | A `sameOrigin(req)` helper wraps the parse in `try` and treats an unparseable Origin as foreign (403). Tests: `rejects an unparseable Origin…` for both endpoints |
| B2 | CM-1 | Medium | Malformed export payloads were mishandled. A file entry with no `text` or `base64` was written as the literal text `undefined` (returning 200). A JSON body of `null`, or one that wasn't JSON, returned 500 with an internal error message instead of 400. Reproduced against the original server. | Fixed in CM-1 | The export endpoint validates the payload before creating any folder: each entry needs an allowed `path` and string `text` or `base64`. Bad JSON gets 400. Test: `export rejects malformed payloads…` |
| B4 | CM-2 | Medium | **Opening a damaged project half-applied it.** `openProject` copied the file's size, duration, fps and loop onto the document *before* reading the layers. A file with no `layers` list changed the canvas to the file's settings, then failed, leaving the user's work on the wrong canvas size and with the controls out of sync. Reproduced by test before fixing. | Fixed in CM-2 | Open now checks the file's shape (`doc`, `layers`, `arts`, positive numeric settings) and builds every art state and layer first. It only assigns to `doc` once all of that succeeds. Only the five known settings are copied, not the whole `doc` object. Test: `Opening a damaged project…` |
| B5 | CM-2 | Medium | **A project whose art layer pointed at a missing picture broke the page.** The layer was added with `art: undefined`, so every redraw threw `Cannot read properties of undefined (reading 'bounds')`. No message was shown. Reproduced against the original code. Separately, a picture that failed to decode put its whole base64 data URL into the toast. | Fixed in CM-2 | Each art layer's index is checked while building the layers, giving "The project file is damaged." An unreadable picture gives "A picture in the project file could not be read." |
| B6 | CM-3 | Medium | **After re-editing art on the canvas, the remaining pixels drift whenever the layer is animated.** The editor's `delta` compensation shifts the layer's position (and each keyframe's) so the pixels stay put. But the layer rotates and scales around that position, so moving it changes the arc the piece swings through. Result: exact at rest and exactly at keyframes; wrong between keyframes that differ in rotation or scale, and throughout a wobble, pulse or spin motion. In the tests, at 1.5 s between keyframes, every visible pixel was somewhere the piece hadn't been. Shifting keyframes can't fix this, because blending shifted positions in a straight line isn't the same as rotating by the blended angle. | **Open.** Logged by your decision (2026-11-10); to be fixed in its own PR | Proposed fix: give art layers a pivot offset, so a re-edit changes where the picture is drawn relative to the pivot instead of moving the layer. It touches `drawLayer`, `localBox`/`handles`/`hitLayer`, `exportHTML` (`transform-origin`) and Save/Open (old files default to 0). Tests: 4 `test.fail` tests in `re-edit.spec.js` |
| B7 | CM-3 | Low | **Loop wasn't part of undo.** Undo snapshots didn't store `doc.loop`, and toggling Loop didn't create an undo step. So Undo after Open (F8) brought back the earlier document but kept the opened file's Loop setting, and Undo could never change Loop. Reproduced by test before fixing. | Fixed in CM-3 | `commit()` and `restore()` include `loop`, and the Loop checkbox commits. Tests: `Undo after Open…`, and the Loop step in the 20-step sequence |
| B8 | CM-4 | Medium | **Rotating past 9 o'clock in one drag stored the wrong angle.** The rotate handle measured the angle from the start of the drag with `atan2`, which jumps by a full turn at 180°. A 400° drag was stored as about 30°, and a 270° turn as −90°. The board looks the same, but keyframes interpolate the stored number, so the animation turned the wrong way or skipped turns. Reproduced by test before fixing. | Fixed in CM-4 | The drag adds up the angle change between pointer events, each step normalised to ±180°. Test: `rotating most of a turn in one drag stores the full angle` |
| B9 | CM-4 | Low | **Shortening the duration could make a layer jump.** Keyframes past the new end are dropped. If that dropped *all* of a layer's keyframes, the layer fell back to the values it had before it was first animated (x = 10 instead of 700 in the test). Deleting the last keyframe by hand already copied its pose back; this path didn't. Reproduced by test before fixing. | Fixed in CM-4 | Before dropping, the layer's pose at the new end is computed; if no keyframes are left, that pose is copied onto the layer. Test: `a layer whose keyframes are all dropped…` |
| B10 | CM-4 | Medium | **With the "Jump (no in-between)" easing, a middle keyframe showed the previous keyframe's pose at its own time.** `evalBase` picked the pair of keyframes *ending* at the playhead, and Jump always shows the first of a pair. With the playhead parked on that keyframe, the board shows the wrong pose. From reading the code (not tested separately): dragging the piece there writes to that keyframe while the board keeps showing the old pose, so the piece looks stuck. Reproduced by test before fixing. | Fixed in CM-4 | `evalBase` now picks the pair *starting* at a keyframe exactly at the playhead, and returns that keyframe's values exactly. That also removes a floating-point error (about 1e-14) that Overshoot would otherwise have had at keyframe times. Test: `every easing shows each keyframe's own pose…` |
| B11 | CM-5 | Medium | **A picture the library folder couldn't keep vanished silently on the next reload.** Uploads are shown at once, then copied to the server in the background, and any failure was swallowed. Formats the server doesn't keep (BMP, SVG, HEIC…), files over 40 MB, and running without the server all ended the same way: the picture worked for the session, then was gone, with no warning. Reproduced with a BMP. | Fixed in CM-5 | Formats the folder can't keep aren't sent at all, so no doomed request. A toast says the picture is "in the library for this session only" and which formats are kept. Any other failed copy shows the same kind of message. Test: `a picture the library folder cannot keep…` |
| B12 | CM-5 | Low | **Uploading a name that was already taken showed two tiles with the same name.** The server saved the new file as `quadrants-2`, but the tile kept the name "quadrants" until the next reload. Reproduced by test. | Fixed in CM-5 | The tile takes the name the server reports. Test: `uploading a name that is already taken…` |
| B13 | CM-5 | Low | **An abandoned layer drag could reorder layers later.** The layer list remembered the dragged row and only forgot it on a drop *onto a row*. After a drag that ended anywhere else, a later drop on the list (in the test, a library tile dropped on a row) moved that old layer. Reproduced by test. | Fixed in CM-5 | Rows forget the drag on `dragend`, however it ended. Test: `an abandoned row drag…` |
| B14 | CM-5 | Low | **An emptied number field stayed blank.** Clearing X, Y, Size or Rotate and clicking away left the field empty, though the layer hadn't changed, and added an undo step that did nothing (F11). Reproduced by test. | Fixed in CM-5 | On leaving an empty or invalid field, it shows the real value again and records no undo step. Test: `clearing a number field mid-typing…` |
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
- **F8 (CM-2), resolved in CM-3:** Open doesn't clear undo history; it pushes a new snapshot, so Undo right after Open goes back to the project that was open before. **Kept on purpose:** it rescues work replaced by an accidental Open, since the app has no "unsaved changes" warning. Now pinned by a test. The Loop half of this finding was a real bug (B7, fixed).
- **F11 (CM-3):** `commit()` doesn't skip a snapshot identical to the last one. If a control fires `change` twice (the tests did this by firing `change` by hand, after which the browser fired its own on blur), the user gets an undo step that does nothing. Real typing fires `change` once, so this is logged only. A cheap fix if it ever shows up: compare with the top snapshot before pushing.
- **F12 (CM-3):** Adding art (double-click, Add, drop) is asynchronous, because the picture is loaded on first use. Tests must wait for the new layer, not just the click. `addFromLibrary` in `undo.spec.js` does this.
- **F14 (CM-4), lessons for writing tests here:** (1) The time readout (`#timeOut`) and the board only update on the next animation frame, so read them with `expect.poll`, not once. Reading once failed 2 times in 10. (2) Playwright's `clock.install()` still lets time run in real time; call `clock.pauseAt(...)` after start-up so only `runFor` moves it. (3) While the clock is paused, a redraw requested by a click only happens on the next `runFor`.
- **F15 (CM-4):** Suspected but **not** a bug: while a keyframe is being dragged past another, the keyframes are briefly out of order. The preview at the playhead still shows the dragged keyframe's pose, and they're sorted on drop. Pinned by a test.
- **F16 (CM-4):** Shift-stretch clamps a near-zero scale to +0.02 (`Math.abs(f) < min ? min : f`), which can drop a flip's minus sign if a corner is dragged right onto the centre line. That's an edge case, so it's logged only.
- **F17 (CM-4):** Clicking just *outside* the timeline track (left of 0 s) does nothing, because the click isn't on the track. Dragging past either end clamps as expected. Logged only.
- **F13 (CM-3), resolved in CM-5:** Two buttons were labelled "✂ Edit / cut out" (library panel and properties panel), so screen-reader users heard two identical buttons. The library one now has a distinct `aria-label`. Pinned by a test.
- **F18 (CM-5):** Tests that write to the library folder must not share a server with other tests. One intermittent failure (1–2 in 174, in the *smoke* test) came from pictures uploaded by an earlier library test in the same worker. Fixed with the `isolate` fixture option. **Any new spec that uploads, saves a piece or exports should set `test.use({ isolate: true })`.** This will matter for CM-6 (HTML export).
- **F19 (CM-5):** `KEEPABLE` in `app.js` and `IMG` in `server.js` are two copies of the same format list. If one changes, the other must too. Logged only; one fix would be for the server to report its list at `/api/library`.
- **F20 (CM-5):** Dragging a layer row onto another always lands it *above* that row, so a layer can't be dragged below the bottom row (the Background); ▼ does that. That's a design choice, logged only.
- **F9 (CM-2):** Rendered frames and art pixels match after a round trip within 2 levels per channel (the test's threshold), including the soft-alpha picture and the half-transparent mask. So the PNG data-URL encoding of `orig` and `mask` loses nothing that shows.
- **F10 (CM-2):** `npm install` downloads Chromium (about 120 MB) through `postinstall`, so a fresh clone needs only `npm install && npm test`. If that's unwanted for people who only run the app, the app itself needs no install at all: `node server.js` still works with nothing installed.
