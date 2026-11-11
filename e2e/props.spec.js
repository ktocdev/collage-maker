// Handoff #11: the properties panel. Every control changes what it says, as one undo step.
const { test, expect } = require('./support/fixtures.js');
const { key, addFromLibrary } = require('./support/board.js');

const P = page => page.locator('#props');
// A control row by the label it starts with (a row's text also includes its option names).
// (None of the labels used here contain regex special characters.)
const field = (page, label) => P(page).locator('label, .row').filter({ hasText: new RegExp('^' + label) });

async function shape(page, props = {}) {
  return page.evaluate(props => {
    const A = CM.app, l = A.newShape(props.shape || 'rect');
    Object.assign(l, { x: 640, y: 360, w: 200, h: 120 }, props);
    A.addLayer(l);
    return l.id;
  }, props);
}
const read = (page, id, fn) => page.evaluate(([id, src]) => (0, eval)(src)(CM.app.doc.layers.find(l => l.id === id)), [id, fn.toString()]);

// Runs `act`, checks `get` changed to `expected`, then that one undo brings it back and
// one redo re-applies it.
async function oneStep(page, id, get, act, expected) {
  const before = await read(page, id, get);
  await act();
  const after = await read(page, id, get);
  if (expected !== undefined) expect(after).toEqual(expected);
  expect(after).not.toEqual(before);
  await page.click('#undoBtn');
  expect(await read(page, id, get), 'one undo restores it').toEqual(before);
  await page.click('#redoBtn');
  expect(await read(page, id, get), 'redo re-applies it').toEqual(after);
}

test('Opacity slider', async ({ app }) => {
  const id = await shape(app);
  await oneStep(app, id, l => l.opacity, () => field(app, 'Opacity').locator('input').fill('35'), 0.35);
  await expect(field(app, 'Opacity').locator('output')).toHaveText('35%');
});

test('Blend select', async ({ app }) => {
  const id = await shape(app);
  await oneStep(app, id, l => l.blend, () => field(app, 'Blend').locator('select').selectOption('multiply'), 'multiply');
});

test('Fill: solid colour picker', async ({ app }) => {
  const id = await shape(app);
  await oneStep(app, id, l => l.fill.color, () => P(app).locator('.row', { hasText: 'Color' }).locator('input[type=color]').first().fill('#12ab34'), '#12ab34');
});

test('Fill: gradient with style, both colours and angle', async ({ app }) => {
  const id = await shape(app);
  await oneStep(app, id, l => l.fill.type, () => field(app, 'Fill').locator('select').first().selectOption('gradient'), 'gradient');
  const colours = P(app).locator('.row', { hasText: 'Colors' }).locator('input[type=color]');
  await expect(colours).toHaveCount(2);
  await oneStep(app, id, l => l.fill.color2, () => colours.nth(1).fill('#0000ff'), '#0000ff');
  await oneStep(app, id, l => l.fill.angle, () => field(app, 'Angle').locator('input').fill('45'), 45);
  await oneStep(app, id, l => l.fill.gradType, () => field(app, 'Style').locator('select').selectOption('radial'), 'radial');
  await expect(field(app, 'Angle')).toHaveCount(0);          // a round gradient has no angle
});

test('Fill: pattern and texture with size', async ({ app }) => {
  const id = await shape(app);
  await field(app, 'Fill').locator('select').first().selectOption('pattern');
  await oneStep(app, id, l => l.fill.pattern, () => field(app, 'Pattern').locator('select').selectOption('dots'), 'dots');
  await oneStep(app, id, l => l.fill.scale, () => field(app, 'Size').locator('input[type=range]').fill('2.5'), 2.5);
  await field(app, 'Fill').locator('select').first().selectOption('texture');
  await oneStep(app, id, l => l.fill.texture, () => field(app, 'Texture').locator('select').selectOption('wood'), 'wood');
});

test('Fill: "No fill" is offered for shapes but not for fill layers', async ({ app }) => {
  const id = await shape(app);
  await oneStep(app, id, l => l.fill.type, () => field(app, 'Fill').locator('select').first().selectOption('none'), 'none');
  await app.locator('#layerList .layer-row', { hasText: 'Background' }).click();
  await expect(field(app, 'Fill').locator('select').first().locator('option[value="none"]')).toHaveCount(0);
});

test('Outline colour and thickness', async ({ app }) => {
  const id = await shape(app);
  await oneStep(app, id, l => l.stroke.width, () => field(app, 'Thickness').locator('input').fill('12'), 12);
  const outline = P(app).locator('.sect', { hasText: 'Outline' }).locator('xpath=following-sibling::div[1]').locator('input[type=color]');
  await oneStep(app, id, l => l.stroke.color, () => outline.fill('#ff00ff'), '#ff00ff');
});

test('Position, size and rotation fields', async ({ app }) => {
  const id = await shape(app);
  const pair = label => field(app, label).locator('input[type=number]');
  const type = async (input, v) => { await input.fill(String(v)); await input.press('Tab'); };
  await oneStep(app, id, l => [l.x, l.y], async () => { await type(pair('X / Y').nth(0), 100); }, [100, 360]);
  await oneStep(app, id, l => l.y, () => type(pair('X / Y').nth(1), 50), 50);
  await oneStep(app, id, l => [l.sx, l.sy], () => type(pair('Size %').nth(0), 250), [2.5, 1]);
  await oneStep(app, id, l => l.sy, () => type(pair('Size %').nth(1), 40), 0.4);
  await oneStep(app, id, l => l.rot, () => type(pair('Rotate').nth(0), -30), -30);
});

test('Size % keeps a flip, and never goes below 1%', async ({ app }) => {
  await addFromLibrary(app, 'quadrants');
  const id = await app.evaluate(() => CM.app.doc.layers.at(-1).id);
  await P(app).getByRole('button', { name: 'Flip' }).click();
  const w = field(app, 'Size %').locator('input').nth(0);
  await expect(w).toHaveValue('100');                          // shown without the sign
  await w.fill('50'); await w.press('Tab');
  expect(await read(app, id, l => l.sx)).toBe(-0.5);
  await w.fill('0'); await w.press('Tab');
  expect(await read(app, id, l => l.sx)).toBe(-0.01);
});

test('clearing a number field mid-typing does not move the piece', async ({ app }) => {
  const id = await shape(app);
  const x = field(app, 'X / Y').locator('input').nth(0);
  await x.fill('');
  expect(await read(app, id, l => l.x)).toBe(640);
  await x.press('Tab');
  await expect(x).toHaveValue('640');                          // the field shows the real value again
  await app.click('#undoBtn');                                 // and no empty undo step was added:
  expect(await app.evaluate(() => CM.app.doc.layers.length)).toBe(1);   // one undo removes the shape
});

test('the fields follow the playhead on an animated layer, and edits go to its keyframe', async ({ app }) => {
  const id = await shape(app);
  await app.evaluate(id => { const A = CM.app, l = A.doc.layers.find(l => l.id === id); Object.assign(A.addKey(l, 0), { x: 100 }); Object.assign(A.addKey(l, 2), { x: 300 }); A.setTime(1); A.refresh(); }, id);
  const x = field(app, 'X / Y').locator('input').nth(0);
  await expect(x).toHaveValue('200');                          // ease: smooth, midpoint
  await x.fill('250'); await x.press('Tab');
  const keys = await read(app, id, l => l.keys.map(k => [k.t, k.x]));
  expect(keys).toEqual([[0, 100], [1, 250], [2, 300]]);
});

test('path shapes: "Closed shape" and "Smooth curves"', async ({ app }) => {
  const id = await shape(app, { shape: 'path', pts: [[-80, -40], [60, -60], [90, 50], [-40, 70]], closed: true, smooth: false });
  await oneStep(app, id, l => l.smooth, () => P(app).getByLabel('Smooth curves').check(), true);
  await oneStep(app, id, l => l.closed, () => P(app).getByLabel('Closed shape').uncheck(), false);
  await expect(P(app).locator('.sect', { hasText: 'Fill' })).toHaveCount(0);   // an open line has no fill
});

test('a two-point line offers "Smooth curves" but not "Closed shape"', async ({ app }) => {
  await shape(app, { shape: 'path', pts: [[-80, 0], [80, 0]], closed: false });
  await expect(P(app).getByLabel('Smooth curves')).toHaveCount(1);
  await expect(P(app).getByLabel('Closed shape')).toHaveCount(0);
});

test('art layers: Flip mirrors the layer and its keyframes; Edit opens the editor', async ({ app }) => {
  await addFromLibrary(app, 'quadrants');
  const id = await app.evaluate(() => CM.app.doc.layers.at(-1).id);
  await key(app, 'k');
  await oneStep(app, id, l => [l.sx, l.keys[0].sx], () => P(app).getByRole('button', { name: 'Flip' }).click(), [-1, -1]);
  await P(app).getByRole('button', { name: '✂ Edit / cut out' }).click();
  await expect(app.locator('#edTitle')).toHaveText('Edit: quadrants');
  await expect(app.locator('#edApply')).toHaveText('Apply to layer');
  await app.click('#edCancel');
});

test('animation: Add keyframe, Movement (with 2+ keyframes) and Clear all', async ({ app }) => {
  const id = await shape(app);
  await expect(field(app, 'Movement')).toHaveCount(0);
  await P(app).getByRole('button', { name: '◆ Add keyframe' }).click();
  await expect(P(app)).toContainText('1 keyframe.');
  await expect(field(app, 'Movement')).toHaveCount(0);
  await app.evaluate(() => CM.app.setTime(2));
  await key(app, 'Shift+ArrowRight');                          // second keyframe, x + 10
  await app.evaluate(() => CM.app.refresh());
  await expect(P(app)).toContainText('2 keyframes.');
  await oneStep(app, id, l => l.ease, () => field(app, 'Movement').locator('select').selectOption('overshoot'), 'overshoot');
  // Clear all keeps the pose at the playhead (2 s: x = 650).
  await oneStep(app, id, l => [l.keys.length, l.x], () => P(app).getByRole('button', { name: 'Clear all' }).click(), [0, 650]);
});

test('looping motion: preset, Amount and Speed', async ({ app }) => {
  const id = await shape(app);
  await oneStep(app, id, l => l.motion.type, () => field(app, 'Looping motion').locator('select').selectOption('wobble'), 'wobble');
  await oneStep(app, id, l => l.motion.amt, () => field(app, 'Amount').locator('input').fill('2.5'), 2.5);
  await oneStep(app, id, l => l.motion.speed, () => field(app, 'Speed').locator('input').fill('3'), 3);
  await expect(field(app, 'Speed').locator('output')).toHaveText('3.0');
});

test('fill layers have no Position section and no looping motions', async ({ app }) => {
  await app.locator('#layerList .layer-row', { hasText: 'Background' }).click();
  await expect(P(app).locator('.sect', { hasText: 'Position' })).toHaveCount(0);
  const options = await field(app, 'Looping motion').locator('option').allTextContents();
  expect(options).toEqual(['None']);
});

test('with nothing selected, the panel says so', async ({ app }) => {
  await key(app, 'Escape');
  await expect(P(app)).toContainText('Nothing selected');
});
