# Handoff: Collage Maker has no test suite

**Status as of 2026-11-10:** open, nothing started.
**For:** whoever picks up testing for this project.
**Read first:** [ARCHITECTURE.md](ARCHITECTURE.md) for how the code is organised. This note assumes it.

## The gap in one paragraph

The app was built in one session and has never had an automated test. There is no `package.json`, no test runner, no CI, and no test files in the repository. Everything known to work is known from a handful of one-off scripted browser runs whose only checks were "no JavaScript errors" and a person looking at screenshots. Several whole features have never been run at all. Any change to the code today can only be verified by hand.

## What has actually been verified

Three throwaway scripts drove the page in headless Chrome over the DevTools protocol (real mouse and key events where noted). Those scripts lived in a temporary folder and are **not in the repository**.

| Area | What was done | How it was checked |
| --- | --- | --- |
| Shape tool | Drew a burst by dragging | Layer list logged; screenshot |
| Line tool | Clicked a 3-corner outline closed; dragged a freehand line | Layer fields logged (`closed`, `smooth`, size); screenshot |
| Adding art | Added pictures via `CM.app.addArtToBoard` | Screenshot |
| Keyframes | `K` at 0s, set time to 3s, dragged the piece | Logged two keyframes with expected positions |
| Cut-out editor | Magic wand, eraser, scissors (keep), Trim, a preset, pixelate and overlay sliders | Screenshots |
| Save piece to library | Clicked the button | Confirmed the PNG appeared in `library/cutouts/` and in the library list |
| Fills | All 6 textures, 6 of the 9 patterns, both gradient types | Screenshot |
| HTML export | Exported a scene with rotation, flip, pattern, gradients, opacity and a blend mode | Screenshot of the exported page compared by eye to the canvas |
| Page errors | All of the above | No uncaught exceptions or `console.error` output |

Caveats on that table:

- "Screenshot" means a person judged it looked right. Nothing was compared numerically.
- Several steps called app functions directly instead of going through the UI (adding art, setting the time, setting a looping motion, opening the editor), so the buttons and panels for those were not exercised.
- Each thing was done once, on one machine, in Chrome on Windows.

## What has never been run

Ordered by how much damage a bug would do, in my judgement.

1. **Project Save and Open.** This is the only way to keep work between sessions. The round trip (serialise art to data URLs, rebuild art states, reassign layer ids) has never executed. A bug here loses a user's collage.
2. **Re-editing an art layer that is already on the canvas.** When the cut-out changes, the layer and each of its keyframes are shifted so the remaining pixels do not move (the `delta` passed to `onApply`, see "Cut-out editor" in the architecture doc). Only the library path was tested, where `delta` is ignored. The compensation maths for rotated, scaled, flipped and trimmed layers is unverified.
3. **Canvas undo and redo.** Snapshots share art states by reference and rely on `cloneLayer` copying everything else. Never triggered in a test.
4. **Video export.** `MediaRecorder` plus a timed stop. Never run, and may not work in headless Chrome at all.
5. **PNG export.** Never run.
6. **Selection handles.** Resize (uniform and Shift-stretch) and rotate (free and Shift-snap) by dragging handles; behaviour with flipped or rotated layers.
7. **Timeline interaction.** Scrubbing, dragging a keyframe to retime it, dropping one keyframe on another, double-click to delete, changing duration (which discards keyframes past the end) and frame rate.
8. **Playback and looping motions.** Play was toggled once for under a second. No motion preset output and no easing curve has been checked against expected values.
9. **Library input paths.** File upload, dropping files on the panel, dragging a library item onto the canvas, double-click to add.
10. **Layer panel.** Drag-to-reorder, ▲ ▼, duplicate, delete, show/hide, rename.
11. **Properties panel.** Every control: opacity, blend, fill type switching, outline, numeric position/size/rotation fields, "closed shape" and "smooth curves" toggles, Flip.
12. **Editor remainder.** Restore brush, Invert, Restore all, editor undo/redo, scissors in "remove" mode, non-contiguous magic wand, zoom and pan, backdrop switch.
13. **Server edge cases.** Path traversal rejection, the cross-origin POST check, size limits, name collisions, bad export payloads.
14. **Remaining fills.** Three patterns (checker, grid, diagonal stripes) were never rendered in a test.
15. **Other browsers.** Firefox, Safari and Edge are untested. Effects depend on `ctx.filter`, which has had uneven support.

## What makes this code awkward to test

- **No modules.** The three scripts are IIFEs sharing a global `CM`. Functions inside `app.js` (`evalBase`, `evalLayer`, `shapeD`, `hitLayer`, `write`, `cloneLayer`, the export builder) are private and cannot be imported into a Node test.
- **Logic and DOM are interleaved.** `app.js` reads `document` at load time and runs its startup code immediately, so it cannot be loaded without a real page.
- **Most output is pixels.** Correctness for rendering, fills, effects and cut-outs is visual.
- **Some paths use browser dialogs.** HTML export calls `prompt` and `window.open`; Save, PNG and Video trigger downloads; Open and upload use file inputs.
- **The server writes into the real project.** `library/` and `exports/` are fixed relative to `server.js`. There is no way to point it at a temporary folder, so a test that saves a piece or exports will leave files behind.
- **A test hook already exists.** `CM.app` exposes `doc`, `lib`, `addArtToBoard`, `itemArt`, `addLayer`, `newShape`, `newFill`, `select`, `setTime`, `addKey`, `commit`, `refresh`, `paint`, `editLibraryItem` and `exportHTML`. It was added for scripted runs and is the easiest way in.

## Suggested approach

These are recommendations, not decisions anyone has made. The main open choice is whether to keep the project dependency-free.

### Step 1: make the server testable (small)

Let `server.js` take its data root from an environment variable (for example `COLLAGE_DATA_DIR`, defaulting to the project folder) so tests can run against a temporary copy. Then server tests can be plain `node:test` with `fetch`, no browser needed. This also covers item 13 above cheaply.

### Step 2: browser tests for the features that have never run

Use a real browser, because that is where the bugs will be. Two options:

| Option | For | Against |
| --- | --- | --- |
| **Playwright** (my recommendation) | Handles downloads, file inputs, dialogs and drag-and-drop out of the box; built-in screenshot comparison; runs Chromium, Firefox and WebKit | Adds a `package.json` and a dependency to a project that currently has none |
| **Hand-rolled DevTools driver** on `node:test` | Keeps zero dependencies. The earlier scripted runs worked this way using Node's built-in `WebSocket` (about 60 lines) | Downloads, file choosers and cross-browser runs all have to be built by hand |

Prefer assertions on state over screenshots wherever possible. Most behaviour can be checked by acting through the UI and then reading `CM.app.doc`: layer count and order, a layer's `x, y, sx, sy, rot`, keyframe times, fill settings. That keeps tests stable and fast.

First tests to write, in order:

1. Save a project with art, shapes and keyframes; reload the page; Open it; compare `doc` before and after, and compare `paint` output.
2. Place an art layer rotated and scaled, open the editor on it, erase one side and Trim, apply. Assert that a known pixel of the remaining art is at the same canvas position as before. Repeat with a flipped layer and with keyframes.
3. Perform a sequence of edits, undo each, and assert the document equals each earlier state. Redo and assert again.
4. Drag each selection handle and assert the resulting transform.
5. Timeline: retime a keyframe, delete one, shorten the duration.

### Step 3: unit tests for the pure maths (needs a small refactor)

`evalBase`, `evalLayer`, the easing functions, `shapeD`, `toDoc`/`unrot`, `snapT` and `cloneLayer` are pure and would be cheap to test exhaustively, but they are trapped inside the `app.js` IIFE. Moving them into `core.js` (or a new file) and exposing them on `CM` would let a Node test load that one file with a stubbed `document`. This is a refactor of working code, so do it after step 2 gives some safety net.

### Step 4: a few visual checks

Keep these to a minimum, since they are the most brittle:

- One reference image per pattern and texture (they are deterministic by design, seeded).
- One reference image per image effect on a small fixed picture.
- The HTML export: render a fixed scene with `paint`, screenshot the exported page, and compare with a tolerance. Text-free scenes avoid font differences.

### Video

Treat video export as a manual check unless it proves easy to automate. At most, assert that a non-empty WebM blob is produced.

## Definition of done (proposed)

- One command runs the whole suite from a clean checkout.
- Tests never write into the real `library/` or `exports/` folders.
- Items 1 to 3 in "never been run" have automated coverage.
- Every item in that list is either covered or written down as a deliberate manual check.
- Any bugs found along the way are fixed or listed.
- README and ARCHITECTURE are updated: both currently say there are no tests, and the README describes untested features as working.

## Things to watch for

- **Expect to find real bugs.** Roughly half the feature surface has never executed. Budget time for fixes, not only for writing tests.
- The art-state immutability rule (architecture doc, "Art model") is what makes undo safe. A test that mutates an art canvas in place will produce confusing failures elsewhere.
- Double-click behaviour was fixed once already: Chrome sends `click` to the element holding pointer capture, and re-rendering a list between two clicks swallows the `dblclick`. Timeline keyframes and library tiles both have workarounds. Interaction tests around these are worth having.
- Hit-testing reads single pixels with `getImageData` from canvases not created with `willReadFrequently`. It works, but Chrome may log a performance warning; do not treat that as a test failure.
- Pressing Space in the app toggles playback unless focus is in a text field. Tests that type into inputs should be aware of focus.
