# Collage Maker: technical overview

How the app is built, for developers and coding agents who need to change or extend it. For how to *use* the app, see [README.md](README.md).

## At a glance

| | |
| --- | --- |
| What it is | A single-page browser app for building animated cut-out collages, with a small local server for file access |
| Front end | Plain HTML, CSS and JavaScript. No framework, no bundler, no npm dependencies |
| Rendering | Canvas 2D |
| Server | Node.js, built-in modules only (`http`, `fs`, `path`) |
| Run | `node server.js`, then open `http://localhost:5173` (or `start.bat` on Windows) |
| Port | 5173, override with the `PORT` environment variable (`PORT=0` picks a free port) |
| Data folder | `library/` and `exports/` live in the project folder, override with `COLLAGE_DATA_DIR` |
| State | All in memory in the browser. Persistence is by explicit Save (JSON download) or by files the server writes |
| Tested in | Chrome on Windows only |

There is no build step and the app has no npm dependencies. `package.json` exists only for `npm test`. Editing a file and reloading the page is the whole development loop. The server sends `Cache-Control: no-store`, so a plain reload always picks up changes. Changes to `server.js` need a server restart.

## Files

```
index.html        Static page structure: top bar, library panel, canvas, timeline, layers/properties panel, editor modal
style.css         All styling
server.js         Static file server + three JSON/binary endpoints
start.bat         Opens the browser and runs the server
js/core.js        Helpers with no UI: canvases, pattern/texture tiles, fill styles, the art model
js/editor.js      Small DOM helpers + the cut-out / effects editor modal
js/app.js         Everything else: document model, rendering, tools, panels, timeline, library, save/export
library/          Source pictures (any jpg, png, gif, webp, avif placed here is listed)
library/cutouts/  PNG pieces saved from the editor
exports/          HTML exports, one folder each
test/             Server tests (node:test)
e2e/              Browser tests (Playwright); e2e/support/ holds the fixtures and a PNG generator
playwright.config.js
```

### Script loading and the `CM` namespace

The three scripts are classic (non-module) scripts loaded in order: `core.js`, `editor.js`, `app.js`. Each is wrapped in an IIFE. They share one global object, `window.CM`:

- `core.js` creates `CM` and adds: `canvas`, `copyCanvas`, `loadImage`, `clamp`, `PATTERNS`, `TEXTURES`, `tile`, `defaultFill`, `fillStyle`, `defaultFx`, `artFromImage`, `renderFx`, `alphaBounds`, `buildArt`, `cloneArt`, `artCrop`.
- `editor.js` adds DOM helpers `CM.h`, `CM.slider`, `CM.select`, `CM.toast`, plus `CM.openEditor` and the flag `CM.editorOpen`.
- `app.js` exposes `CM.app` (the document, the library list and a few functions). This exists for the browser tests and for the console; nothing in the app depends on it. `CM.app.ready` is a promise that resolves once the library list has loaded (or failed), so tests wait on it rather than racing start-up.

Load order matters: `app.js` uses `CM.h` from `editor.js`, and both use `core.js`.

### UI construction

Static layout lives in `index.html`. Dynamic panels (layer list, properties, tool options bar, timeline rows, library grid, editor option panels) are rebuilt from scratch with `CM.h(tag, props, ...children)` and `replaceChildren`. There is no virtual DOM or diffing; a panel is simply re-rendered when its data changes.

`CM.h` sets a prop as a DOM property when `key in element`, treats `on*` keys as event listeners, and otherwise calls `setAttribute` (this is how `data-*` attributes are set). Props are applied in object order, so for range inputs `min`/`max` must come before `value`.

## Document model (`app.js`)

```js
doc = { w, h, duration, fps, loop, layers: [] }   // layers[0] is the bottom layer
```

Module-level state alongside it: `sel` (selected layer id), `tool` (`select` | `shape` | `line`), `time` (playhead, seconds), `playing`, `recording`, `drag`, `draft` (line being drawn), `viewScale` (screen pixels per canvas pixel).

### Layers

All layers share a base:

```js
{ id, type, name, visible, blend,          // blend is a canvas globalCompositeOperation value
  x, y, sx, sy, rot, opacity,              // x,y = centre in canvas px; rot in degrees
  keys: [],                                // keyframes, sorted by t
  ease,                                    // 'ease' | 'linear' | 'hold' | 'overshoot'
  motion: { type, amt, speed } }           // looping motion preset, type 'none' when off
```

| `type` | Extra fields | Notes |
| --- | --- | --- |
| `fill` | `fill` | Covers the whole canvas. Ignores `x, y, sx, sy, rot`; only opacity is meaningful |
| `shape` | `shape`, `w`, `h`, `pts`, `closed`, `smooth`, `fill`, `stroke: {color, width}` | `shape` is `rect`, `ellipse`, `triangle`, `star`, `burst`, `heart` or `path`. For `path`, `pts` is `[[x, y], …]` relative to the layer centre |
| `art` | `art` | An art state object (see below) |

A fill object:

```js
{ type,            // 'color' | 'gradient' | 'pattern' | 'texture' | 'none' (shapes only)
  color, color2,   // gradient: from/to. pattern & texture: background/foreground
  gradType,        // 'linear' | 'radial'
  angle,           // degrees; 0 = left to right, 90 = top to bottom
  pattern, texture,// names from CM.PATTERNS / CM.TEXTURES
  scale }          // tile scale for patterns and textures
```

### Coordinate conventions

A layer's local coordinate system is centred on its position. `localBox(layer)` returns the layer's box in local coordinates and is always centred on the origin. The canvas transform for a layer is `translate(x, y)`, then `rotate(rot)`, then `scale(sx, sy)`. A horizontal flip is a negative `sx`.

`toDoc` converts a local point to canvas coordinates; `unrot` converts a canvas point to un-rotated (still scaled) offsets from the layer centre. Both take an evaluated transform.

### Shape geometry

`shapeD(layer)` returns SVG path data for a shape in local coordinates. It is the single source of geometry: canvas drawing and hit-testing use `new Path2D(shapeD(layer))`, and the HTML export writes the same string into an SVG `<path>`. A new shape type needs a case in `shapeD` and an entry in the `SHAPES` table, nothing else.

## Rendering

`paint(ctx, t)` clears the canvas and calls `drawLayer` for each layer in order. `draw()` calls `paint` on the visible canvas, then `drawOverlay()` for selection handles and the in-progress line (skipped while playing or recording), then updates the playhead and time read-out.

- `requestRender()` coalesces redraws into one `requestAnimationFrame` and does nothing while playing (the playback loop draws every frame itself).
- `refresh()` re-renders every panel and requests a redraw. Use it after structural changes (layers added, removed, reordered, selection changed). For live changes while dragging a slider, call `requestRender()` only.
- The canvas backing size is always `doc.w × doc.h`. `fitBoard()` scales it to the available space with CSS and records `viewScale`, which overlay drawing and hit distances use to stay a constant size on screen.

Hit-testing (`hitLayer`) walks layers top-down. Art layers test the alpha of the pixel under the pointer, so transparent parts of a cut-out do not catch clicks. Shapes use `isPointInPath` / `isPointInStroke`. Fill layers are never hit on the canvas; they are selected from the layer list.

### Fills, patterns and textures (`core.js`)

`CM.fillStyle(ctx, fill, box)` returns a canvas fill style for a box: a color string, a `CanvasGradient`, or a `CanvasPattern`.

Patterns and textures are generated procedurally by `makeTile(name, bg, fg)` and are designed to tile seamlessly. Simple patterns are 64 px tiles drawn with canvas calls; `grain`, `clouds` and `wood` are per-pixel and use periodic value noise; `paper` and `newsprint` are 256 px. A seeded random generator makes every tile deterministic. `CM.tile` caches tiles by name and colors (the cache is cleared when it passes 80 entries, since dragging a color picker creates many).

## Animation

Animatable properties are `x, y, sx, sy, rot, opacity`. A keyframe is `{ t, x, y, sx, sy, rot, opacity }`; every keyframe stores all six.

Two evaluation functions matter:

- `evalBase(layer, t)`: the transform from keyframes only. With no keyframes it returns the layer's own values. Otherwise it interpolates between the surrounding keyframes using the layer's `ease`, and holds the first/last value outside the keyframed range.
- `evalLayer(layer, t)`: `evalBase` plus the looping motion preset (`wobble`, `bob`, `sway`, `hop`, `chomp`, `pulse`, `shake`, `spin`) applied as an offset. This is what gets drawn.

Rules that follow from this:

- **Editing writes to keyframes automatically.** All transform and opacity edits go through `write(layer, values)`. If the layer has no keyframes, the values go on the layer. If it has any, they go on the keyframe at the playhead, creating one if needed.
- **Edit from `evalBase`, draw with `evalLayer`.** Drags start from `evalBase` so the motion offset is never baked into stored values.
- When the last keyframe is removed, its values are copied back onto the layer.

Time is snapped to the frame grid (`snapT`) whenever the user sets it. During playback, `time` advances in real time and the drawn time is floored to the frame, which is what produces the choppy look at low frame rates.

## Art model (`core.js`)

An art state:

```js
{ orig,     // canvas: source pixels, scaled so the longest side is at most 1600 px
  mask,     // canvas: its alpha channel says what is kept (opaque = visible)
  fx,       // effect settings, see CM.defaultFx()
  out,      // canvas: effects applied, then masked. This is what gets drawn
  bounds }  // { x, y, w, h }: bounding box of visible pixels in `out`
```

`CM.buildArt(state)` computes `out` and `bounds` from the other three. `CM.renderFx(orig, fx)` applies the effects in this order: CSS-style canvas filters (hue, saturation, brightness, contrast, grayscale, sepia, invert, blur), then pixelation (downscale, then upscale without smoothing), then the color overlay.

**Art states are immutable once built.** The editor never mutates the state it was given; it produces a new one. This matters because undo snapshots and duplicated layers share art states by reference. Never modify an art state's canvases in place; build a new state.

Drawing an art layer draws only the `bounds` region of `out`, centred on the layer position. So a layer's `x, y` is the centre of the *visible cut-out*, not of the source picture.

## Cut-out editor (`editor.js`)

`CM.openEditor({ art, title, applyLabel, onApply(state, delta), onSave(state) })` opens the modal on a working copy (`orig` shared, `mask` copied, `fx` copied).

- **Eraser / Restore** stamp circles into the mask along the pointer path, using `destination-out` or `source-over`. Soft edges come from a radial gradient.
- **Magic wand** flood-fills from the clicked pixel, comparing colors in `orig` by maximum channel difference. Pixels within tolerance get mask alpha 0; pixels between 1× and 2× tolerance get partial alpha, which softens the fringe. With "only the connected area" off it scans the whole picture.
- **Scissors** fills the drawn loop into the mask with `destination-in` (keep) or `destination-out` (remove).
- **Trim** crops `orig` and `mask` to the visible bounds and records the crop offset.
- Editor undo keeps up to 15 snapshots of `{ orig, mask, trim offset }`.

`onApply` receives `delta`: how far the cut-out's centre moved in picture pixels, accounting for trims. When re-editing a layer already on the canvas, `app.js` uses it to shift the layer (and each of its keyframes, rotated and scaled) so the remaining pixels stay exactly where they were. Any change to how `bounds` or trimming works must keep this compensation correct; `e2e/re-edit.spec.js` checks it.

**Known limitation (B6 in the build log):** this is exact at rest and at each keyframe, but not in between keyframes that differ in rotation or scale, nor during wobble, pulse or spin. Shifting the layer moves the point it rotates and scales around, so its arc changes. The proper fix is a pivot offset on art layers.

While the editor is open, `CM.editorOpen` is true and the main canvas keyboard shortcuts are disabled.

## Library

`lib` is an array of `{ id, name, kind, url, thumb?, art? }` where `kind` is `source` or `cutout`. It is filled from `GET /api/library` at startup. An item's art state is created lazily by `itemArt(item)` the first time it is used.

Adding to the canvas always clones the art (`CM.cloneArt`), so library items are never altered by edits to layers. Saving a piece from the editor adds an in-memory `cutout` item immediately and posts a cropped PNG to the server in the background. After a restart, that piece comes back as an ordinary transparent PNG; its original mask and unerased pixels are not stored.

## Undo history (`app.js`)

`commit()` pushes a snapshot of the document (size, duration, fps, loop, selection, and a deep copy of every layer made by `cloneLayer`) and truncates any redo tail. Up to 80 snapshots are kept. Art states are copied by reference, which is safe only because they are immutable.

Call `commit()` once after each completed user action: on pointer-up, or on an input's `change` event, not on every `input` event. Code that adds a layer field holding an object or array must also copy it in `cloneLayer`, or undo will share it between snapshots.

## Server (`server.js`)

Listens on `127.0.0.1` only. Static files come from an allowlist: `index.html`, `style.css` and `js/*.js` from the project folder, images under `/library/…` and `.html`/`.css`/`.png` under `/exports/…` from the data folder (`COLLAGE_DATA_DIR`, default the project folder). Everything else, including `server.js`, docs, tests and `.git/`, answers 404. **A new static asset must be added to `APP_FILES` or `APP_SCRIPT`.** Paths that resolve outside their folder are refused. POST requests are rejected if they carry an `Origin` header that does not match the `Host` or cannot be parsed (such as `null`).

`server.js` exports `createServer({ dataDir })` for tests, and only listens when run directly. Malformed export payloads get `400`. Uploads are written with the `wx` flag, so a name collision fails rather than overwriting.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/library` | Returns `[{ name, url, kind }]` for images in `library/cutouts/` (`kind: "cutout"`) and `library/` (`kind: "source"`) |
| `POST /api/library?name=<file>&kind=cutout?` | Raw image bytes in the body. Saves to `library/` or `library/cutouts/`. The name is sanitised, must have an image extension, and gets a numeric suffix rather than overwriting. 40 MB limit. Returns `{ name, url }` |
| `POST /api/export` | JSON body `{ name, files: [{ path, text } \| { path, base64 }] }`. Paths must be `index.html`, `style.css` or `images/<name>.png`. Writes to `exports/<slug>/`, adding a numeric suffix rather than overwriting. 300 MB limit. Returns `{ dir, url }` |

## Output formats

### Project file (`collage.json`)

```js
{ app: 'collage-maker', version: 1,
  doc: { w, h, duration, fps, loop },
  layers: [ … ],                          // layer objects; an art layer's `art` is an index into `arts`
  arts: [ { orig, mask, fx } ] }          // orig and mask are PNG data URLs
```

Art states shared by several layers are stored once. On open, layer ids are reassigned and each art state is rebuilt with `CM.buildArt`. Open checks the whole file and builds every layer before it touches the document, so a damaged file shows a message and changes nothing. Library cut-outs are not part of the project file.

### HTML export (`exportHTML` in `app.js`)

Produces `index.html`, `style.css` and `images/` for the layout at `t = 0`, using `evalBase` (keyframes at the start, no looping motion). Hidden layers are skipped.

| Layer | Element | Positioning |
| --- | --- | --- |
| `fill` | `<div class="layer">` | Full size; CSS `background` (color, gradient, or a tile image with `background-size`) |
| `art` | `<img class="layer">` | Cropped PNG of the cut-out; `left/top/width/height` plus `transform: rotate() scale()` |
| `shape` | `<svg class="layer">` with one `<path>` | `viewBox` equals the local box; fills use `<linearGradient>`, `<radialGradient>` or `<pattern>` in `<defs>` |

Element ids are slugs of layer names, made unique. Gradient geometry is computed to match `CM.fillStyle`; note that a canvas angle `a` corresponds to CSS `linear-gradient(a + 90deg, …)`.

### Other

- **PNG:** `paint` to an off-screen canvas at the current time, without the selection overlay.
- **Video:** `MediaRecorder` on `canvas.captureStream(30)`, playing the timeline once from 0 in real time, saved as WebM.

## Extending it

| To add | Change |
| --- | --- |
| A shape | A case in `shapeD` and an entry in `SHAPES` (`app.js`) |
| A pattern or texture | A case in `makeTile` and an entry in `CM.PATTERNS` or `CM.TEXTURES` (`core.js`). It must tile seamlessly |
| A looping motion | A case in `evalLayer` and an entry in `MOTIONS` (`app.js`) |
| An easing | An entry in both `EASE` and `EASES` (`app.js`) |
| An image effect | A field in `CM.defaultFx`, handling in `CM.renderFx` (`core.js`), and a row in the `FX` table (`editor.js`) |
| A layer property | The layer factory, `cloneLayer`, `drawLayer`, `renderProps`, and `exportHTML` if it affects appearance |
| An animatable property | Also add it to `PROPS` and `pick`; existing keyframes in saved projects will lack it |

## Known gaps

- Test coverage is being built up; see [Testing-Build-Log.md](Testing-Build-Log.md). `npm test` runs the server tests and the browser tests. Browser coverage so far: start-up, project Save/Open, re-editing art on the canvas, and undo/redo.
- Not yet exercised end to end: PNG and video export, image upload, and drag-and-drop from the library.
- Colors, fills and effects cannot be animated.
- The HTML export does not carry over any animation, and its stage is a fixed pixel size.
- Performance has only been tried with a handful of layers and pictures up to 1600 px. Each art layer holds its own full-size mask and output canvases, plus a source canvas shared with other copies of the same picture.
- The server has no authentication and is intended for local, single-user use only.
