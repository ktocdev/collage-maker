// Handoff #9: library input paths. The Upload button, dropping files on the panel,
// dragging a tile onto the board, double-click, and the Add / Edit buttons.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./support/fixtures.js');
const { encodePNG, encodeBMP } = require('./support/png.js');
const { board } = require('./support/board.js');

// These tests write to the library folder, so each gets its own server.
test.use({ isolate: true });

const red = encodePNG(30, 20, () => [230, 30, 30, 255]);
const teal = encodePNG(25, 25, () => [20, 160, 150, 255]);
const tiles = page => page.locator('#libGrid .lib-item span').allTextContents();
const layerCount = page => page.evaluate(() => CM.app.doc.layers.length);

test('Upload adds the chosen pictures and copies them into the library folder', async ({ app, server }) => {
  const a = 'red', b = 'teal';
  const [chooser] = await Promise.all([app.waitForEvent('filechooser'), app.click('#uploadBtn')]);
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([
    { name: a + '.png', mimeType: 'image/png', buffer: red },
    { name: b + '.png', mimeType: 'image/png', buffer: teal },
  ]);
  await expect.poll(() => tiles(app)).toEqual(expect.arrayContaining([a, b]));
  await expect(app.locator('#libGrid .lib-item.sel span')).toHaveText(b);   // the last one is selected
  for (const [n, bytes] of [[a, red], [b, teal]]) {
    const file = path.join(server.dataDir, 'library', n + '.png');
    await expect.poll(() => fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
  }
  // After a reload they come back from the folder.
  await app.reload();
  await app.evaluate(() => CM.app.ready);
  expect(await tiles(app)).toEqual(expect.arrayContaining([a, b]));
  // An uploaded picture can be put on the board.
  await app.locator('#libGrid .lib-item', { hasText: a }).dblclick();
  await expect.poll(() => layerCount(app)).toBe(2);
  expect(await app.evaluate(() => CM.app.doc.layers.at(-1).art.bounds)).toEqual({ x: 0, y: 0, w: 30, h: 20 });
});

test('Upload ignores files that are not images', async ({ app }) => {
  const n = 'notes';
  await app.setInputFiles('#uploadFile', [{ name: n + '.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }]);
  await app.waitForTimeout(300);
  expect(await tiles(app)).not.toContain(n);
});

// B11: when the server could not keep a picture (an unsupported format, too large, or
// no server), the app said nothing, so it silently vanished on the next reload.
test('a picture the library folder cannot keep is used for this session, with a warning', async ({ app, server }) => {
  const n = 'bitmap';
  await app.setInputFiles('#uploadFile', [{ name: n + '.bmp', mimeType: 'image/bmp', buffer: encodeBMP(16, 12, () => [10, 200, 30]) }]);
  await expect.poll(() => tiles(app)).toContain(n);
  await expect(app.locator('#toast')).toContainText(n);
  await expect(app.locator('#toast')).toContainText('this session');
  expect(fs.existsSync(path.join(server.dataDir, 'library', n + '.bmp'))).toBe(false);
  // It still works on the board for now.
  await app.locator('#libGrid .lib-item', { hasText: n }).dblclick();
  await expect.poll(() => layerCount(app)).toBe(2);
});

// B16: pictures kept for this session only never reach the server, so nothing renamed
// a second one with the same name.
test('a second session-only picture with the same name gets -2 too', async ({ app }) => {
  const bmp = { name: 'bitmap.bmp', mimeType: 'image/bmp', buffer: encodeBMP(8, 8, () => [200, 20, 20]) };
  await app.setInputFiles('#uploadFile', [bmp]);
  await expect.poll(() => tiles(app)).toContain('bitmap');
  await app.setInputFiles('#uploadFile', [bmp]);
  await expect.poll(() => tiles(app)).toContain('bitmap-2');
  expect((await tiles(app)).filter(n => n === 'bitmap')).toHaveLength(1);
});

// The server never overwrites: an upload with a taken name is saved as name-2.
test('uploading a name that is already taken shows the name it was saved under', async ({ app, server }) => {
  await app.setInputFiles('#uploadFile', [{ name: 'quadrants.png', mimeType: 'image/png', buffer: red }]);
  await expect.poll(() => tiles(app)).toContain('quadrants-2');
  expect(fs.readFileSync(path.join(server.dataDir, 'library', 'quadrants-2.png')).equals(red)).toBe(true);
});

test('dropping files on the library panel adds them', async ({ app }) => {
  const n = 'dropped';
  const dt = await app.evaluateHandle(({ name, bytes }) => {
    const d = new DataTransfer();
    d.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
    d.items.add(new File(['not a picture'], 'readme.txt', { type: 'text/plain' }));
    return d;
  }, { name: n + '.png', bytes: [...teal] });
  await app.locator('#libraryPanel').dispatchEvent('dragover', { dataTransfer: dt });
  await app.locator('#libraryPanel').dispatchEvent('drop', { dataTransfer: dt });
  await expect.poll(() => tiles(app)).toContain(n);
  expect(await tiles(app)).not.toContain('readme');
});

test('dragging a tile onto the board places the picture where it is dropped', async ({ app }) => {
  const at = await board(app), [x, y] = at(300, 200), r = await app.locator('#board').boundingBox();
  await app.locator('#libGrid .lib-item', { hasText: 'soft-dot' }).dragTo(app.locator('#board'), {
    targetPosition: { x: x - r.x, y: y - r.y },
  });
  await expect.poll(() => layerCount(app)).toBe(2);
  const l = await app.evaluate(() => { const l = CM.app.doc.layers.at(-1); return { name: l.name, x: l.x, y: l.y }; });
  expect(l.name).toBe('soft-dot');
  expect(l.x).toBeCloseTo(300, -1);
  expect(l.y).toBeCloseTo(200, -1);
});

test('double-click adds a picture at the centre, scaled to fit', async ({ app }) => {
  await app.locator('#libGrid .lib-item', { hasText: 'quadrants' }).dblclick();
  await expect.poll(() => layerCount(app)).toBe(2);
  const l = await app.evaluate(() => { const l = CM.app.doc.layers.at(-1); return { x: l.x, y: l.y, sx: l.sx, sy: l.sy }; });
  expect(l).toEqual({ x: 640, y: 360, sx: 1, sy: 1 });           // small pictures are not enlarged
});

test('Add and Edit work on the selected tile and are disabled without one', async ({ app }) => {
  await expect(app.locator('#libAdd')).toBeDisabled();
  await expect(app.locator('#libEdit')).toBeDisabled();
  await app.locator('#libGrid .lib-item', { hasText: 'ell-cut' }).click();
  await expect(app.locator('#libGrid .lib-item.sel span')).toHaveText('ell-cut');
  await expect(app.locator('#libAdd')).toBeEnabled();
  await app.click('#libAdd');
  await expect.poll(() => app.evaluate(() => CM.app.doc.layers.at(-1).name)).toBe('ell-cut');
  await app.click('#libEdit');
  await expect(app.locator('#edTitle')).toHaveText('Edit: ell-cut');
  await app.click('#edCancel');
});

test('adding the same picture twice gives independent layers', async ({ app }) => {
  for (let i = 0; i < 2; i++) await app.locator('#libGrid .lib-item', { hasText: 'quadrants' }).dblclick();
  await expect.poll(() => layerCount(app)).toBe(3);
  const shared = await app.evaluate(() => {
    const [a, b] = CM.app.doc.layers.slice(1);
    return { art: a.art === b.art, orig: a.art.orig === b.art.orig, mask: a.art.mask === b.art.mask };
  });
  // Each layer gets its own art state and mask; the source pixels are shared to save memory.
  expect(shared).toEqual({ art: false, orig: true, mask: false });
});

// F13: two buttons were both labelled "✂ Edit / cut out", so a screen reader announced
// them identically.
test('the two "Edit / cut out" buttons have different accessible names', async ({ app }) => {
  await app.locator('#libGrid .lib-item', { hasText: 'quadrants' }).dblclick();
  await expect.poll(() => layerCount(app)).toBe(2);
  const names = await app.getByRole('button', { name: /Edit \/ cut out/ }).evaluateAll(bs => bs.map(b => b.getAttribute('aria-label') || b.textContent));
  expect(names).toHaveLength(2);
  expect(new Set(names).size).toBe(2);
});
