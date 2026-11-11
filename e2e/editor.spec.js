// Handoff #12: the rest of the cut-out editor. Results are read from the layer's mask
// after Apply, because the editor's working state is private.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./support/fixtures.js');
const ed = require('./support/editor.js');
const { addFromLibrary, selectedLayer } = require('./support/board.js');

// "Save piece to library" writes to the library folder, so each test gets its own server.
test.use({ isolate: true });

// quadrants.png is 120 x 80: red top-left, green top-right, blue bottom-left, yellow
// bottom-right, with a white diagonal line from (0,0) to (120,80).
const RED_ABOVE = [50, 10], RED_BELOW = [5, 30], GREEN = [100, 15], BLUE = [20, 60], YELLOW = [100, 65];
const OPAQUE = 255;

async function editQuadrants(page) {
  await addFromLibrary(page, 'quadrants');
  const id = await selectedLayer(page);
  return { id, e: await ed.openEditor(page, id) };
}
const alphas = (page, id, pts) => ed.maskAlpha(page, id, pts);

test('eraser rubs out along the stroke and nowhere else', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await ed.tool(e, 'erase');
  await ed.slider(e, 'Brush size', 10);
  await ed.slider(e, 'Soft edge', 0);
  await ed.stroke(e, [[10, 40], [110, 40]]);
  await ed.apply(e);
  expect(await alphas(app, id, [[20, 40], [60, 40], [100, 40]])).toEqual([0, 0, 0]);
  expect(await alphas(app, id, [[20, 20], [60, 70], [100, 10]])).toEqual([OPAQUE, OPAQUE, OPAQUE]);
});

test('a soft brush leaves a partly transparent edge', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await ed.tool(e, 'erase');
  await ed.slider(e, 'Brush size', 30);
  await ed.slider(e, 'Soft edge', 100);
  await ed.clickAt(e, [60, 40]);
  await ed.apply(e);
  const [centre, edge, outside] = await alphas(app, id, [[60, 40], [60 + 11, 40], [60 + 20, 40]]);
  expect(centre).toBeLessThan(40);
  expect(edge).toBeGreaterThan(40);
  expect(edge).toBeLessThan(250);
  expect(outside).toBe(OPAQUE);
});

test('the restore brush paints erased parts back', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await ed.tool(e, 'erase');
  await ed.slider(e, 'Brush size', 12);
  await ed.slider(e, 'Soft edge', 0);
  await ed.stroke(e, [[10, 40], [110, 40]]);
  await ed.tool(e, 'restore');
  await ed.stroke(e, [[50, 40], [70, 40]]);
  await ed.apply(e);
  expect(await alphas(app, id, [[20, 40], [60, 40], [100, 40]])).toEqual([0, OPAQUE, 0]);
});

test('[ and ] change the brush size', async ({ app }) => {
  const { e } = await editQuadrants(app);
  await ed.tool(e, 'erase');
  const size = () => app.locator('#edToolOpts label', { hasText: 'Brush size' }).locator('input').inputValue().then(Number);
  await ed.slider(e, 'Brush size', 40);
  await app.keyboard.press(']');
  expect(await size()).toBe(50);
  await app.keyboard.press('[');
  await app.keyboard.press('[');
  expect(await size()).toBe(32);
  await ed.cancel(e);
});

test('magic wand removes the connected area of the clicked colour', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await ed.tool(e, 'wand');
  await ed.clickAt(e, BLUE);
  await ed.clickAt(e, RED_ABOVE);
  await ed.apply(e);
  // Blue is gone; the red part above the white line is gone, the part below it is not.
  expect(await alphas(app, id, [BLUE, RED_ABOVE, RED_BELOW, GREEN, YELLOW])).toEqual([0, 0, OPAQUE, OPAQUE, OPAQUE]);
});

test('magic wand with "only the connected area" off removes the colour everywhere', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await ed.tool(e, 'wand');
  await app.locator('#edToolOpts label', { hasText: 'Only the connected area' }).locator('input').uncheck();
  await ed.clickAt(e, RED_ABOVE);
  await ed.apply(e);
  expect(await alphas(app, id, [RED_ABOVE, RED_BELOW, GREEN, BLUE])).toEqual([0, 0, OPAQUE, OPAQUE]);
});

test('magic wand tolerance: colours within it go, up to twice it fade, beyond stay', async ({ app }) => {
  // From green (40,160,60), the largest channel difference is 160 to blue and 180 to red.
  // With tolerance 90, not connected only: blue is between 1x and 2x, so it is partly
  // removed (alpha 255 x (160 - 90) / 90 = 198); red is at 2x, so it stays.
  const { id, e } = await editQuadrants(app);
  await ed.tool(e, 'wand');
  await app.locator('#edToolOpts label', { hasText: 'Only the connected area' }).locator('input').uncheck();
  await ed.slider(e, 'Tolerance', 90);
  await ed.clickAt(e, GREEN);
  await ed.apply(e);
  const [g, b, r] = await alphas(app, id, [GREEN, BLUE, RED_ABOVE]);
  expect(g).toBe(0);
  expect(Math.abs(b - 198)).toBeLessThanOrEqual(2);
  expect(r).toBe(OPAQUE);
});

test('scissors in "remove" mode cut out what is circled', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await ed.scissors(e, [[40, 25], [80, 25], [80, 55], [40, 55]], 'remove');
  await ed.apply(e);
  expect(await alphas(app, id, [[60, 40], [45, 30], [75, 50]])).toEqual([0, 0, 0]);
  expect(await alphas(app, id, [[20, 10], [110, 70], [30, 70]])).toEqual([OPAQUE, OPAQUE, OPAQUE]);
});

test('Invert swaps what is kept and what is removed', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await ed.tool(e, 'wand');
  await ed.clickAt(e, BLUE);
  await app.click('#edInvert');
  await ed.apply(e);
  expect(await alphas(app, id, [BLUE, GREEN, YELLOW])).toEqual([OPAQUE, 0, 0]);
});

test('Restore all brings the whole picture back', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await ed.tool(e, 'wand');
  await ed.clickAt(e, BLUE);
  await ed.clickAt(e, GREEN);
  await app.click('#edReset');
  await ed.apply(e);
  expect(await alphas(app, id, [BLUE, GREEN, RED_ABOVE, YELLOW])).toEqual([OPAQUE, OPAQUE, OPAQUE, OPAQUE]);
});

test('editor undo and redo, with the buttons and the keyboard', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await ed.tool(e, 'wand');
  await ed.clickAt(e, BLUE);
  await ed.clickAt(e, GREEN);
  await ed.clickAt(e, YELLOW);
  await app.click('#edUndo');                  // yellow back
  await app.keyboard.press('Control+z');       // green back
  await app.click('#edRedo');                  // green gone again
  await app.keyboard.press('Control+z');       // green back
  await app.keyboard.press('Control+y');       // green gone
  await ed.apply(e);
  expect(await alphas(app, id, [BLUE, GREEN, YELLOW])).toEqual([0, 0, OPAQUE]);
});

test('undoing a Trim brings back the full picture', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await ed.scissors(e, [[62, -10], [130, -10], [130, 90], [62, 90]]);
  await ed.trim(e);
  await app.click('#edUndo');
  await ed.apply(e);
  const size = await app.evaluate(id => { const a = CM.app.doc.layers.find(l => l.id === id).art; return [a.orig.width, a.orig.height]; }, id);
  expect(size).toEqual([120, 80]);
  expect(await alphas(app, id, [BLUE, GREEN])).toEqual([0, OPAQUE]);   // the scissors cut is still there
});

test('E, R, W and L switch tools', async ({ app }) => {
  const { e } = await editQuadrants(app);
  for (const [k, t] of [['w', 'wand'], ['l', 'lasso'], ['r', 'restore'], ['e', 'erase']]) {
    await app.keyboard.press(k);
    await expect(app.locator(`#edTools [data-t="${t}"]`)).toHaveClass(/\bon\b/);
  }
  await ed.cancel(e);
});

test('zooming with the wheel keeps the picture point under the cursor', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  const at = await ed.mapper(e);
  await app.mouse.move(...at(...BLUE));
  for (let i = 0; i < 6; i++) await app.mouse.wheel(0, -100);   // zoom in 1.15^6 = 2.3x around blue
  await ed.tool(e, 'wand');
  // Before zooming, this screen point was over yellow (100, 65). Zoomed in around blue
  // (20, 60), it is now over picture point (55, 62): still blue.
  await app.mouse.click(...at(...YELLOW));
  await ed.apply(e);
  expect(await alphas(app, id, [BLUE, YELLOW])).toEqual([0, OPAQUE]);
});

for (const how of ['Pan tool', 'Space + drag', 'right-button drag']) {
  test(`panning with the ${how} moves the picture with the pointer`, async ({ app }) => {
    const { id, e } = await editQuadrants(app);
    const at = await ed.mapper(e);
    // Drag the view by exactly the distance from blue to green on screen, so blue ends
    // up where green was.
    const b = at(...BLUE), g = at(...GREEN), d = [g[0] - b[0], g[1] - b[1]];
    const button = how === 'right-button drag' ? 'right' : 'left';
    if (how === 'Pan tool') await ed.tool(e, 'pan');
    if (how === 'Space + drag') await app.keyboard.down(' ');
    await app.mouse.move(...b);
    await app.mouse.down({ button });
    for (let s = 1; s <= 8; s++) await app.mouse.move(b[0] + d[0] * s / 8, b[1] + d[1] * s / 8);
    await app.mouse.up({ button });
    if (how === 'Space + drag') await app.keyboard.up(' ');
    await ed.tool(e, 'wand');
    await app.mouse.click(...g);
    await ed.apply(e);
    expect(await alphas(app, id, [BLUE, GREEN])).toEqual([0, OPAQUE]);
  });
}

test('the backdrop shows through removed parts', async ({ app }) => {
  const { e } = await editQuadrants(app);
  await ed.tool(e, 'wand');
  await ed.clickAt(e, BLUE);
  const at = await ed.mapper(e);
  const pixel = () => app.evaluate(([x, y]) => {
    const c = document.getElementById('edCanvas'), r = c.getBoundingClientRect(), k = c.width / r.width;
    return [...c.getContext('2d').getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data.slice(0, 3)];
  }, at(...BLUE));
  await app.selectOption('#edBackdrop', '#ff00c8');
  await expect.poll(pixel).toEqual([255, 0, 200]);
  await app.selectOption('#edBackdrop', '#111111');
  await expect.poll(pixel).toEqual([17, 17, 17]);
  await ed.cancel(e);
});

test('effect presets, sliders and Reset set the effect values', async ({ app }) => {
  const { id, e } = await editQuadrants(app);
  await app.locator('#edFx').getByRole('button', { name: 'Photocopy' }).click();
  await ed.slider(e, 'Blur', 3);
  await ed.apply(e);
  const fx = await app.evaluate(id => CM.app.doc.layers.find(l => l.id === id).art.fx, id);
  expect(fx).toMatchObject({ gray: 100, con: 230, bri: 110, blur: 3, sat: 100 });
  const e2 = await ed.openEditor(app, id);
  await app.click('#edFxReset');
  await ed.apply(e2);
  const fx2 = await app.evaluate(id => CM.app.doc.layers.find(l => l.id === id).art.fx, id);
  expect(fx2).toEqual(await app.evaluate(() => CM.defaultFx()));
});

test('Save piece to library writes a PNG and lists it as a cut-out', async ({ app, server }) => {
  const { e } = await editQuadrants(app);
  await ed.scissors(e, [[62, -10], [130, -10], [130, 90], [62, 90]]);
  await app.click('#edSave');
  await expect(app.locator('#libGrid .lib-item span').first()).toHaveText(/^quadrants-cut/);
  const file = path.join(server.dataDir, 'library', 'cutouts', 'quadrants-cut.png');
  await expect.poll(() => fs.existsSync(file)).toBe(true);
  expect(fs.readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
  await ed.cancel(e);
});

test('editing a library picture adds a new layer and leaves the picture alone', async ({ app }) => {
  await app.locator('#libGrid .lib-item', { hasText: 'quadrants' }).click();
  await app.click('#libEdit');
  await app.locator('#editor:not(.hidden)').waitFor();
  await expect(app.locator('#edApply')).toHaveText('Add to board');
  const e = { page: app, size: { w: 120, h: 80 } };
  await ed.tool(e, 'wand');
  await ed.clickAt(e, BLUE);
  const n = await app.evaluate(() => CM.app.doc.layers.length);
  await ed.apply(e);
  await expect.poll(() => app.evaluate(() => CM.app.doc.layers.length)).toBe(n + 1);
  const id = await selectedLayer(app);
  expect(await alphas(app, id, [BLUE, GREEN])).toEqual([0, OPAQUE]);
  // The library's own copy is untouched.
  const libAlpha = await app.evaluate(([x, y]) => {
    const it = CM.app.lib.find(i => i.name === 'quadrants');
    return it.art.mask.getContext('2d').getImageData(x, y, 1, 1).data[3];
  }, BLUE);
  expect(libAlpha).toBe(OPAQUE);
});
