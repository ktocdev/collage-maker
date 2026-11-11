// Handoff #10: the layer panel. Drag to reorder, ▲ ▼ and their shortcuts, duplicate,
// delete, show/hide, rename, and the fill-layer button.
const { test, expect } = require('./support/fixtures.js');
const { key, row, board, addFromLibrary } = require('./support/board.js');

// Background plus three named rectangles, bottom to top: A, B, C.
async function threeLayers(page) {
  await page.evaluate(() => {
    const A = CM.app;
    for (const [n, x] of [['A', 300], ['B', 640], ['C', 980]]) {
      const l = A.newShape('rect');
      Object.assign(l, { name: n, x, y: 360, w: 200, h: 200 });
      A.addLayer(l);
    }
  });
}
const order = page => page.evaluate(() => CM.app.doc.layers.map(l => l.name));        // bottom to top
const rows = page => page.locator('#layerList .layer-row .name').allTextContents();    // top to bottom

test('the list shows the top layer first, and clicking a row selects it', async ({ app }) => {
  await threeLayers(app);
  expect(await rows(app)).toEqual(['C', 'B', 'A', 'Background']);
  await row(app, 'A').click();
  await expect(row(app, 'A')).toHaveClass(/\bsel\b/);
  await expect(app.locator('#props label', { hasText: 'Name' }).locator('input')).toHaveValue('A');
});

test('▲ and ▼ move the selected layer one step, and stop at the ends', async ({ app }) => {
  await threeLayers(app);
  await row(app, 'A').click();
  await app.getByTitle('Bring forward (Ctrl+])').click();
  expect(await order(app)).toEqual(['Background', 'B', 'A', 'C']);
  await app.getByTitle('Bring forward (Ctrl+])').click();
  await app.getByTitle('Bring forward (Ctrl+])').click();     // already on top: no change, no undo step
  expect(await order(app)).toEqual(['Background', 'B', 'C', 'A']);
  await app.getByTitle('Send backward (Ctrl+[)').click();
  expect(await order(app)).toEqual(['Background', 'B', 'A', 'C']);
  await app.click('#undoBtn');
  expect(await order(app)).toEqual(['Background', 'B', 'C', 'A']);
  await app.click('#undoBtn');
  expect(await order(app)).toEqual(['Background', 'B', 'A', 'C']);
});

test('Ctrl+] and Ctrl+[ do the same', async ({ app }) => {
  await threeLayers(app);
  await row(app, 'C').click();
  await key(app, 'Control+[');
  await key(app, 'Control+[');
  expect(await order(app)).toEqual(['Background', 'C', 'A', 'B']);
  await key(app, 'Control+]');
  expect(await order(app)).toEqual(['Background', 'A', 'C', 'B']);
});

test('dragging a row onto another puts it just above that row', async ({ app }) => {
  await threeLayers(app);
  await row(app, 'C').dragTo(row(app, 'A'));             // down the list
  expect(await rows(app)).toEqual(['B', 'C', 'A', 'Background']);
  await row(app, 'A').dragTo(row(app, 'B'));             // up the list
  expect(await rows(app)).toEqual(['A', 'B', 'C', 'Background']);
  await app.click('#undoBtn');
  expect(await rows(app)).toEqual(['B', 'C', 'A', 'Background']);
});

// B13: a row drag that ended anywhere but on a row left the panel remembering it, so a
// later drop on a row (for example a library tile) moved that old layer.
test('an abandoned row drag does not affect a later drop on the list', async ({ app }) => {
  await threeLayers(app);
  await row(app, 'A').dragTo(app.locator('#board'));      // dropped off the list: nothing happens
  expect(await order(app)).toEqual(['Background', 'A', 'B', 'C']);
  await app.locator('#libGrid .lib-item', { hasText: 'quadrants' }).dragTo(row(app, 'C'));
  expect(await order(app)).toEqual(['Background', 'A', 'B', 'C']);
});

test('Duplicate puts an offset copy above the original and selects it', async ({ app }) => {
  await threeLayers(app);
  await row(app, 'B').click();
  await app.evaluate(() => { const l = CM.app.doc.layers.find(l => l.name === 'B'); Object.assign(CM.app.addKey(l, 0), { x: 600 }); Object.assign(CM.app.addKey(l, 2), { x: 700 }); });
  await app.click('#dupBtn');
  expect(await order(app)).toEqual(['Background', 'A', 'B', 'B copy', 'C']);
  await expect(row(app, 'B copy')).toHaveClass(/\bsel\b/);
  const [b, c] = await app.evaluate(() => ['B', 'B copy'].map(n => { const l = CM.app.doc.layers.find(l => l.name === n); return { id: l.id, x: l.x, y: l.y, keys: l.keys.map(k => [k.t, k.x, k.y]) }; }));
  expect(c.id).not.toBe(b.id);
  expect([c.x, c.y]).toEqual([b.x + 24, b.y + 24]);
  expect(c.keys).toEqual(b.keys.map(([t, x, y]) => [t, x + 24, y + 24]));
});

test('duplicating a fill layer does not offset it', async ({ app }) => {
  await row(app, 'Background').click();
  await app.click('#dupBtn');
  const [a, b] = await app.evaluate(() => CM.app.doc.layers.map(l => [l.x, l.y, l.name]));
  expect(b).toEqual([a[0], a[1], 'Background copy']);
});

test('Delete removes the selected layer; with nothing selected it does nothing', async ({ app }) => {
  await threeLayers(app);
  await row(app, 'B').click();
  await app.click('#delBtn');
  expect(await order(app)).toEqual(['Background', 'A', 'C']);
  await expect(app.locator('#layerList .layer-row.sel')).toHaveCount(0);
  await app.click('#delBtn');
  expect(await order(app)).toEqual(['Background', 'A', 'C']);
  await row(app, 'A').click();
  await key(app, 'Backspace');
  expect(await order(app)).toEqual(['Background', 'C']);
  await app.click('#undoBtn');
  await app.click('#undoBtn');
  expect(await order(app)).toEqual(['Background', 'A', 'B', 'C']);
});

test('the eye hides and shows a layer without selecting it; hidden layers cannot be clicked', async ({ app }) => {
  await threeLayers(app);
  await row(app, 'A').click();
  await row(app, 'B').locator('.eye').click();
  await expect(row(app, 'A')).toHaveClass(/\bsel\b/);       // selection unchanged
  await expect(row(app, 'B').locator('.eye')).toHaveClass(/\boff\b/);
  expect(await app.evaluate(() => CM.app.doc.layers.find(l => l.name === 'B').visible)).toBe(false);
  // Clicking where B is selects nothing (only the background, which is never hit on the board).
  const at = await board(app);
  await app.mouse.click(...at(640, 360));
  await expect(app.locator('#layerList .layer-row.sel')).toHaveCount(0);
  await row(app, 'B').locator('.eye').click();
  await app.mouse.click(...at(640, 360));
  await expect(row(app, 'B')).toHaveClass(/\bsel\b/);
});

test('renaming updates the list and the timeline, as one undo step', async ({ app }) => {
  await threeLayers(app);
  await row(app, 'B').click();
  const name = app.locator('#props label', { hasText: 'Name' }).locator('input');
  await name.fill('Moon');
  await name.press('Tab');
  expect(await rows(app)).toEqual(['C', 'Moon', 'A', 'Background']);
  await expect(app.locator('.tl-label', { hasText: 'Moon' })).toHaveCount(1);
  await app.click('#undoBtn');
  expect(await rows(app)).toEqual(['C', 'B', 'A', 'Background']);
});

test('typing in the Name field does not trigger shortcuts', async ({ app }) => {
  await threeLayers(app);
  await row(app, 'B').click();
  const name = app.locator('#props label', { hasText: 'Name' }).locator('input');
  await name.fill('');
  await name.pressSequentially('kvs l');             // K, V, S, Space, L are all shortcuts elsewhere
  await name.press('Backspace');
  expect(await order(app)).toEqual(['Background', 'A', 'kvs ', 'C']);
  expect(await app.evaluate(() => CM.app.doc.layers.find(l => l.name === 'kvs ').keys.length)).toBe(0);
  await expect(app.locator('#playBtn')).toHaveText('▶');
});

test('the fill button adds a full-canvas colour layer on top', async ({ app }) => {
  await threeLayers(app);
  await app.click('#addFillBtn');
  const top = await app.evaluate(() => { const l = CM.app.doc.layers.at(-1); return { type: l.type, fill: l.fill.type }; });
  expect(top).toEqual({ type: 'fill', fill: 'color' });
  expect(await rows(app)).toHaveLength(5);
});

test('animated layers are marked ◆ in the list', async ({ app }) => {
  await threeLayers(app);
  await expect(row(app, 'B').locator('.keyed')).toHaveCount(0);
  await row(app, 'B').click();
  await key(app, 'k');
  await expect(row(app, 'B').locator('.keyed')).toHaveCount(1);
  await row(app, 'C').click();
  await app.locator('#props label', { hasText: 'Looping motion' }).locator('select').selectOption('sway');
  await expect(row(app, 'C').locator('.keyed')).toHaveCount(1);
});
