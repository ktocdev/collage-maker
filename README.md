# Collage Maker

A browser app for building animated cut-out collages, in the spirit of the Monty Python animated vignettes. Cut pieces out of pictures, stack them in layers with shapes and patterned backgrounds, make them move, and export the result as a video, an image, or an HTML page you can animate further by hand.

It runs locally: a small Node server plus plain HTML, CSS and JavaScript. There is nothing to install or build.

## Running it

You need [Node.js](https://nodejs.org) (any recent version).

- **Windows:** double-click `start.bat`. It starts the server and opens the app in your browser.
- **Anywhere:** run `node server.js` in this folder, then open <http://localhost:5173>.

To use a different port, set the `PORT` environment variable before starting.

Opening `index.html` directly from disk will not work. The app needs the server to read the library folder and to save cut-outs and exports.

## How it works

### Layers

Everything on the canvas is a layer. The Layers panel on the right lists them, top layer first. Drag rows to reorder, or use the ▲ ▼ buttons.

| Layer type | How to make one | What it is |
| --- | --- | --- |
| Full-canvas | **+ Layer** | Covers the whole canvas with a solid color, gradient, pattern or texture. |
| Shape | **Shape** tool | Rectangle, ellipse, triangle, star, burst or heart. Drag on the canvas to draw. |
| Line / cut shape | **Line** tool | Click to place corners, or drag to draw freehand. End where you started to close it into a fillable shape. |
| Art | Art Library | A picture or cut-out from the library. |

Every layer has opacity and a blend mode. Shapes can be filled with a color, gradient, pattern or texture, and can have an outline.

With the **Select** tool, click a piece to select it, drag to move it, drag a corner to resize (hold Shift to stretch), and drag the yellow knob to rotate (hold Shift to snap to 15°).

### Art library

The left panel shows every image in the `library/` folder. To add your own pictures, drop files into that folder, drag them onto the panel, or use **+ Add**.

- Double-click a picture, or drag it onto the canvas, to add it as a new layer.
- Select a picture and choose **Edit / cut out** to work on it first.

### Cutting out and editing art

The editor opens from the library, or by double-clicking an art layer on the canvas.

**Cut-out tools**

- **Eraser** rubs parts of the picture away. **Restore** paints them back.
- **Magic wand** removes a flat color with one click, such as a white background. Raise the tolerance to take more.
- **Scissors** lets you draw a loop around a piece to keep it, or to remove it.
- **Invert**, **Restore all** and **Trim** work on the whole cut-out.

**Color and effects**

Hue, saturation, brightness, contrast, black & white, sepia, negative, blur, pixelate, and a color overlay with several blending styles. The preset buttons (Photocopy, Old print, Technicolor, Negative) are quick starting points.

**Saving pieces**

**Save piece to library** stores the current cut-out as a new library piece and leaves the editor open, so you can cut several pieces from one picture (a sticker sheet, for example). Saved pieces are written to `library/cutouts/` as transparent PNGs.

Scroll to zoom, hold Space and drag to pan, and use `[` and `]` to change the brush size.

### Animation

The timeline sits under the canvas, with one row per layer.

**Keyframes** move a piece from one place to another:

1. Select a layer and click **Add keyframe**.
2. Move the playhead to another time.
3. Move, resize, rotate or fade the piece. A second keyframe is created for you.

Drag a keyframe diamond to change its timing; double-click it to delete it. The **Movement** setting controls how a layer travels between keyframes: smooth, steady, jump (no in-between) or overshoot.

**Looping motions** run on their own for the whole animation: wobble, bob, sway, hop, chomp (jaw flap), pulse, shake and spin. Each has an amount and a speed. They can be combined with keyframes.

Playback defaults to 12 frames per second for a choppy cut-out look. Change this, the length, and looping in the timeline bar.

Position, size, rotation and opacity can be animated. Colors and effects cannot.

## Saving and exporting

| Button | Result |
| --- | --- |
| **Save** / **Open** | A `collage.json` project file containing all layers, cut-outs and animation. This is the only way to reopen a collage for further editing. |
| **PNG** | The current frame as an image. |
| **Video** | The animation recorded as a WebM file. Recording happens in real time. |
| **HTML** | A web page version of the collage (see below). |

### HTML export

**HTML** writes the collage to `exports/<name>/` as a plain web page with one element per layer, so you can animate it with CSS or a library such as [GSAP](https://gsap.com).

```
exports/my-collage/
  index.html    one element per layer, bottom layer first
  style.css     one commented rule per layer
  images/       cut-out PNGs and pattern/texture tiles
```

- Art layers become `<img>` elements, shapes and lines become inline `<svg>` with a `<path>`, and full-canvas layers become `<div>`s with a CSS background.
- Each element's id comes from its layer name, for example `#god-in-clouds` or `#burst-1`. Naming your layers before exporting gives you readable selectors.
- `index.html` ends with a commented-out GSAP example. Uncomment it to get started.

Things to know:

- The export is the layout at the start of the timeline. Keyframes and looping motions are not included.
- Hidden layers are left out.
- Exporting again with the same name creates `my-collage-2`, `my-collage-3` and so on. An existing export is never overwritten, so animation code you have added is safe.
- The page has a fixed pixel size matching the canvas. It does not scale to the window.

## Keyboard shortcuts

**Canvas**

| Key | Action |
| --- | --- |
| `V` / `S` / `L` | Select / Shape / Line tool |
| `Space` | Play or pause |
| `K` | Add a keyframe for the selected layer |
| Arrow keys | Nudge the selected piece (Shift for bigger steps) |
| `Delete` | Delete the selected layer |
| `Ctrl+D` | Duplicate the selected layer |
| `Ctrl+]` / `Ctrl+[` | Bring forward / send backward |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` | Save the project |
| `Enter` / `Esc` | Finish / cancel the line being drawn |

**Art editor**

| Key | Action |
| --- | --- |
| `E` / `R` / `W` / `L` | Eraser / Restore / Magic wand / Scissors |
| `[` / `]` | Smaller / larger brush |
| `Space` + drag | Pan |
| Mouse wheel | Zoom |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |

## Project layout

```
index.html        page structure
style.css         app styling
server.js         local server: serves the app, lists the library, saves cut-outs and exports
start.bat         Windows launcher
js/core.js        patterns, textures, fills, and art (picture + cut-out mask + effects)
js/editor.js      the cut-out and effects editor
js/app.js         canvas, layers, tools, timeline, library panel, save and export
library/          source pictures
library/cutouts/  pieces saved from the editor
exports/          HTML exports
```

## Limitations

- Built and tested in Chrome on Windows. Other modern browsers should work, but the effects rely on canvas filters and video recording relies on `MediaRecorder`, which vary between browsers.
- The server listens on `127.0.0.1` only. It is meant for one person on their own machine, not for hosting.
- Pictures larger than 1600 pixels on their longest side are scaled down when loaded.
- A cut-out reloaded from `library/cutouts/` is a flat PNG. The Restore brush cannot bring back what was erased before it was saved; go back to the original picture for that.
- Undo history is lost when the page is reloaded. Save the project to keep your work.
