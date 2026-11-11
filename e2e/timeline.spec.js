// Handoff #7: timeline interaction. Scrubbing, retiming a keyframe by dragging it,
// dropping one keyframe on another, double-click to delete, and changing duration and fps.
const { test, expect } = require('./support/fixtures.js');
const { key } = require('./support/board.js');

// Adds a rectangle with keyframes { t, x } and selects it.
function animated(page, keys, props = {}) {
  return page.evaluate(({ keys, props }) => {
    const A = CM.app, l = A.newShape('rect');
    Object.assign(l, { x: 640, y: 360, ease: 'linear' }, props);
    for (const k of keys) Object.assign(A.addKey(l, k.t), k);
    A.addLayer(l);
    return l.id;
  }, { keys, props });
}
const keysOf = (page, id) => page.evaluate(id => CM.app.doc.layers.find(l => l.id === id).keys.map(k => ({ t: k.t, x: k.x })), id);
const timeShown = async page => parseFloat(await page.locator('#timeOut').textContent());

// Screen x of time t on the timeline tracks (all tracks share the ruler's geometry).
async function track(page) {
  const r = await page.locator('.tl-ruler .tl-track').boundingBox();
  const duration = await page.evaluate(() => CM.app.doc.duration);
  return { x: t => r.x + r.width * t / duration, y: r.y + r.height / 2 };
}
const keyEl = (page, id, i) => page.locator(`.tl-key[data-layer="${id}"][data-i="${i}"]`);
async function dragKey(page, id, i, toT) {
  const box = await keyEl(page, id, i).boundingBox(), tr = await track(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const from = box.x + box.width / 2, to = tr.x(toT);
  for (let s = 1; s <= 10; s++) await page.mouse.move(from + (to - from) * s / 10, box.y + box.height / 2);
  await page.mouse.up();
}

test('clicking and dragging on the ruler scrubs, snapped to frames', async ({ app }) => {
  const tr = await track(app);
  await app.mouse.click(tr.x(2.5), tr.y);
  await expect.poll(() => timeShown(app)).toBe(2.5);
  // 1.04 s is not on the 12 fps grid; it snaps to the nearest frame (1.0).
  await app.mouse.click(tr.x(1.04), tr.y);
  await expect.poll(() => timeShown(app)).toBe(1);
  await app.mouse.move(tr.x(1), tr.y);
  await app.mouse.down();
  for (let s = 1; s <= 10; s++) await app.mouse.move(tr.x(1 + 3 * s / 10), tr.y);
  await app.mouse.up();
  await expect.poll(() => timeShown(app)).toBe(4);
  // dragging past either end clamps
  for (const [beyond, expected] of [[-1, 0], [9, 6]]) {
    await app.mouse.move(tr.x(3), tr.y);
    await app.mouse.down();
    for (let s = 1; s <= 10; s++) await app.mouse.move(tr.x(3 + (beyond - 3) * s / 10), tr.y);
    await app.mouse.up();
    await expect.poll(() => timeShown(app)).toBe(expected);
  }
});

test('dragging a keyframe retimes it and keeps its values', async ({ app }) => {
  const id = await animated(app, [{ t: 0, x: 100 }, { t: 2, x: 900 }]);
  await dragKey(app, id, 1, 4);
  expect(await keysOf(app, id)).toEqual([{ t: 0, x: 100 }, { t: 4, x: 900 }]);
  await expect.poll(() => timeShown(app)).toBe(4);
  await app.click('#undoBtn');
  expect(await keysOf(app, id)).toEqual([{ t: 0, x: 100 }, { t: 2, x: 900 }]);
});

test('dragging a keyframe past another re-sorts them', async ({ app }) => {
  const id = await animated(app, [{ t: 1, x: 100 }, { t: 2, x: 500 }, { t: 3, x: 900 }]);
  await dragKey(app, id, 0, 2.5);
  expect(await keysOf(app, id)).toEqual([{ t: 2, x: 500 }, { t: 2.5, x: 100 }, { t: 3, x: 900 }]);
});

test('while a keyframe is dragged past another, the preview follows it', async ({ app }) => {
  // During the drag the keyframes are briefly out of order. The piece shown at the
  // playhead (which follows the dragged keyframe) must be the dragged keyframe's pose.
  const id = await animated(app, [{ t: 1, x: 100 }, { t: 2, x: 500 }, { t: 3, x: 900 }]);
  const box = await keyEl(app, id, 0).boundingBox(), tr = await track(app);
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.mouse.down();
  for (let s = 1; s <= 10; s++) await app.mouse.move(box.x + box.width / 2 + (tr.x(2.5) - box.x - box.width / 2) * s / 10, box.y + box.height / 2);
  const shownX = await app.evaluate(id => { const l = CM.app.doc.layers.find(l => l.id === id); return CM.app.evalBase(l, 2.5).x; }, id);
  await app.mouse.up();
  expect(shownX).toBe(100);
});

test('dropping a keyframe onto another replaces it', async ({ app }) => {
  const id = await animated(app, [{ t: 0, x: 100 }, { t: 2, x: 500 }, { t: 4, x: 900 }]);
  await dragKey(app, id, 2, 2);
  expect(await keysOf(app, id)).toEqual([{ t: 0, x: 100 }, { t: 2, x: 900 }]);
});

test('double-clicking a keyframe deletes it', async ({ app }) => {
  const id = await animated(app, [{ t: 0, x: 100 }, { t: 2, x: 500 }, { t: 4, x: 900 }]);
  await keyEl(app, id, 1).dblclick();
  expect(await keysOf(app, id)).toEqual([{ t: 0, x: 100 }, { t: 4, x: 900 }]);
  await expect(app.locator(`.tl-key[data-layer="${id}"]`)).toHaveCount(2);
});

test('deleting the last keyframe keeps the layer where that keyframe had it', async ({ app }) => {
  const id = await animated(app, [{ t: 2, x: 777 }], { x: 10 });
  await keyEl(app, id, 0).dblclick();
  const l = await app.evaluate(id => { const l = CM.app.doc.layers.find(l => l.id === id); return { keys: l.keys.length, x: l.x }; }, id);
  expect(l).toEqual({ keys: 0, x: 777 });
});

test('two slow clicks on a keyframe do not delete it', async ({ app }) => {
  const id = await animated(app, [{ t: 0, x: 100 }, { t: 2, x: 500 }]);
  await keyEl(app, id, 1).click();
  await app.waitForTimeout(600);
  await keyEl(app, id, 1).click();
  expect(await keysOf(app, id)).toHaveLength(2);
});

test('the ◇ Remove button deletes the keyframe at the playhead', async ({ app }) => {
  const id = await animated(app, [{ t: 0, x: 100 }, { t: 2, x: 500 }]);
  await app.evaluate(() => CM.app.setTime(2));
  await app.click('#delKeyBtn');
  expect(await keysOf(app, id)).toEqual([{ t: 0, x: 100 }]);
  await app.click('#delKeyBtn');                      // none at 2s any more
  await expect(app.locator('#toast')).toContainText('No keyframe');
});

test('shortening the duration drops keyframes past the new end', async ({ app }) => {
  const id = await animated(app, [{ t: 0, x: 100 }, { t: 2, x: 500 }, { t: 5, x: 900 }]);
  await app.evaluate(() => CM.app.setTime(5));
  await app.fill('#durInp', '3');
  await app.press('#durInp', 'Tab');
  expect(await keysOf(app, id)).toEqual([{ t: 0, x: 100 }, { t: 2, x: 500 }]);
  await expect.poll(() => timeShown(app)).toBe(3);                // the playhead is pulled back to the end
  await app.click('#undoBtn');
  expect(await keysOf(app, id)).toHaveLength(3);
});

// B9: when every keyframe of a layer was past the new end, the layer fell back to
// the stale values it had before it was animated, so it jumped.
test('a layer whose keyframes are all dropped stays where it was at the new end', async ({ app }) => {
  const id = await animated(app, [{ t: 4, x: 700 }, { t: 5, x: 900 }], { x: 10 });
  await app.fill('#durInp', '3');
  await app.press('#durInp', 'Tab');
  const l = await app.evaluate(id => { const l = CM.app.doc.layers.find(l => l.id === id); return { keys: l.keys.length, x: l.x }; }, id);
  expect(l).toEqual({ keys: 0, x: 700 });
});

// (A number field won't accept letters, so an empty field is the only "bad" input.)
test('the duration is clamped to 1-120 s and an empty field falls back to 6', async ({ app }) => {
  for (const [typed, expected] of [['0.2', 1], ['500', 120], ['', 6], ['12.5', 12.5]]) {
    await app.fill('#durInp', typed);
    await app.press('#durInp', 'Tab');
    expect(await app.evaluate(() => CM.app.doc.duration), `typed ${JSON.stringify(typed)}`).toBe(expected);
    await expect(app.locator('#durInp')).toHaveValue(String(expected));
  }
});

test('changing the frame rate re-snaps the playhead', async ({ app }) => {
  await app.evaluate(() => CM.app.setTime(1 + 1 / 12));   // 1.083 s, a 12 fps frame
  await app.selectOption('#fpsSel', '8');                  // nearest 8 fps frame is 1.125 s
  expect(await app.evaluate(() => CM.app.doc.fps)).toBe(8);
  await expect.poll(() => timeShown(app)).toBe(1.13);                 // shown to 2 decimals
});

test('K adds a keyframe at the playhead, once per frame', async ({ app }) => {
  const id = await animated(app, []);
  await app.evaluate(() => CM.app.setTime(1.5));
  await key(app, 'k');
  await key(app, 'k');
  expect((await keysOf(app, id)).map(k => k.t)).toEqual([1.5]);
});
