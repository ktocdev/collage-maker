// Handoff #3: canvas undo and redo. Every completed action is one undo step, and
// undoing must give back exactly the earlier document.
const fs = require('node:fs');
const { test, expect } = require('./support/fixtures.js');
const ed = require('./support/editor.js');

// The undoable state: document settings, the selected row, and every layer field.
// Art states are compared by identity (they are immutable and shared by reference).
function state(page) {
  return page.evaluate(() => {
    const A = CM.app;
    window.__artIds ||= new WeakMap(); window.__nArt ||= 0;
    const id = a => { if (!window.__artIds.has(a)) window.__artIds.set(a, ++window.__nArt); return window.__artIds.get(a); };
    const { w, h, duration, fps, loop } = A.doc;
    return JSON.parse(JSON.stringify({
      w, h, duration, fps, loop,
      selected: document.querySelector('#layerList .layer-row.sel .name')?.textContent ?? null,
      layers: A.doc.layers.map(l => ({ ...l, art: l.art ? 'art#' + id(l.art) : undefined })),
    }));
  });
}

// Doc coordinates -> screen, for the main board.
async function board(page) {
  const r = await page.locator('#board').boundingBox();
  const { w, h } = await page.evaluate(() => ({ w: CM.app.doc.w, h: CM.app.doc.h }));
  return (x, y) => [r.x + x * r.width / w, r.y + y * r.height / h];
}
async function dragOnBoard(page, from, to) {
  const at = await board(page);
  await page.mouse.move(...at(...from));
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(...at(from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8));
  await page.mouse.up();
}
// Keyboard shortcuts are ignored while a text field or select has focus.
async function key(page, combo) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(combo);
}
const prop = page => page.locator('#props');
// A layer row by its exact name (rows also contain icon characters).
const row = (page, name) => page.locator('#layerList .layer-row')
  .filter({ has: page.locator('.name').getByText(name, { exact: true }) });
// Double-click a library tile; adding loads the picture, so wait for the new layer.
async function addFromLibrary(page, name) {
  const n = await page.evaluate(() => CM.app.doc.layers.length);
  await page.locator('#libGrid .lib-item', { hasText: name }).dblclick();
  await expect.poll(() => page.evaluate(() => CM.app.doc.layers.length), `double-click adds ${name}`).toBe(n + 1);
}
const selectedLayer = page => page.evaluate(() => {
  const name = document.querySelector('#layerList .layer-row.sel .name')?.textContent;
  return CM.app.doc.layers.find(l => l.name === name)?.id;
});

// A sequence of different user actions, each done through the UI. Each is one undo step.
const STEPS = [
  ['draw a rectangle', async p => { await p.click('[data-tool="shape"]'); await dragOnBoard(p, [200, 200], [420, 330]); }],
  ['nudge with Shift+Arrow', p => key(p, 'Shift+ArrowRight')],
  ['drag to move', p => dragOnBoard(p, [320, 270], [380, 300])],
  ['change opacity', p => prop(p).locator('label:has-text("Opacity") input[type=range]').fill('40')],
  ['change fill to gradient', p => prop(p).locator('label:has-text("Fill") select').first().selectOption('gradient')],
  ['rename', async p => { const n = prop(p).locator('label:has-text("Name") input'); await n.fill('Box'); await n.press('Tab'); }],
  ['set a looping motion', p => prop(p).locator('label:has-text("Looping motion") select').selectOption('bob')],
  ['add art by double-click', p => addFromLibrary(p, 'quadrants')],
  ['add a keyframe with K', p => key(p, 'k')],
  ['move at 2s (makes a keyframe)', async p => { await p.evaluate(() => CM.app.setTime(2)); await key(p, 'Shift+ArrowDown'); }],
  ['duplicate with Ctrl+D', p => key(p, 'Control+d')],
  ['send backward', p => p.getByTitle('Send backward (Ctrl+[)').click()],
  ['hide a layer', p => row(p, 'Box').locator('.eye').click()],
  ['flip the art', async p => { await row(p, 'quadrants').click(); await prop(p).getByRole('button', { name: 'Flip' }).click(); }],
  ['cut the art in the editor', async p => {
    const e = await ed.openEditor(p, await selectedLayer(p));
    await ed.scissors(e, [[62, -10], [130, -10], [130, 90], [62, 90]]);
    await ed.trim(e); await ed.apply(e);
  }],
  ['delete with the Delete key', async p => { await row(p, 'quadrants copy').click(); await key(p, 'Delete'); }],
  ['change canvas size', p => p.selectOption('#sizeSel', '1080x1080')],
  ['shorten the duration (drops a keyframe)', async p => { await p.fill('#durInp', '1.5'); await p.press('#durInp', 'Tab'); }],
  ['change frame rate', p => p.selectOption('#fpsSel', '8')],
  ['turn looping off', p => p.uncheck('#loopChk')],
];

test('each undo returns exactly the previous state, and redo replays them', async ({ app }) => {
  await expect(app.locator('#undoBtn')).toBeDisabled();
  const states = [await state(app)];
  for (const [name, act] of STEPS) {
    await act(app);
    const s = await state(app);
    expect(s, `"${name}" changed something`).not.toEqual(states.at(-1));
    states.push(s);
  }
  await expect(app.locator('#redoBtn')).toBeDisabled();

  // Undo back to the start, alternating the button and Ctrl+Z.
  for (let i = STEPS.length; i > 0; i--) {
    if (i % 2) await app.click('#undoBtn'); else await key(app, 'Control+z');
    expect(await state(app), `undo "${STEPS[i - 1][0]}"`).toEqual(states[i - 1]);
  }
  await expect(app.locator('#undoBtn')).toBeDisabled();

  // Redo to the end, alternating the button, Ctrl+Y and Ctrl+Shift+Z.
  for (let i = 1; i <= STEPS.length; i++) {
    if (i % 3 === 0) await app.click('#redoBtn'); else await key(app, i % 3 === 1 ? 'Control+y' : 'Control+Shift+z');
    expect(await state(app), `redo "${STEPS[i - 1][0]}"`).toEqual(states[i]);
  }
  await expect(app.locator('#redoBtn')).toBeDisabled();
});

test('a new action after undo discards the redo steps', async ({ app }) => {
  await app.click('[data-tool="shape"]');
  await dragOnBoard(app, [200, 200], [400, 300]);
  await key(app, 'ArrowRight');
  await key(app, 'ArrowRight');
  await app.click('#undoBtn');
  await expect(app.locator('#redoBtn')).toBeEnabled();
  await key(app, 'ArrowDown');
  const s = await state(app);
  await expect(app.locator('#redoBtn')).toBeDisabled();
  await key(app, 'Control+y');
  expect(await state(app)).toEqual(s);
});

test('history keeps the last 80 states', async ({ app }) => {
  await app.click('[data-tool="shape"]');
  await dragOnBoard(app, [200, 200], [400, 300]);
  const x0 = await app.evaluate(() => CM.app.doc.layers.at(-1).x);
  for (let i = 0; i < 90; i++) await key(app, 'ArrowRight');
  let undos = 0;
  while (await app.locator('#undoBtn').isEnabled()) { await app.click('#undoBtn'); undos++; }
  expect(undos).toBe(79);
  expect(await app.evaluate(() => CM.app.doc.layers.at(-1).x)).toBe(x0 + 11);
});

test('editing after an undo does not change the states that can be redone', async ({ app }) => {
  // Panels edit layers in place (keyframes, motion); this checks snapshots are copies.
  await addFromLibrary(app, 'soft-dot');
  await key(app, 'k');
  await app.evaluate(() => CM.app.setTime(1));
  await key(app, 'ArrowRight');              // second keyframe at 1s
  const withTwoKeys = await state(app);
  await app.click('#undoBtn');
  await app.evaluate(() => { const l = CM.app.doc.layers.at(-1); l.keys[0].x += 50; l.motion.type = 'spin'; });
  await app.click('#redoBtn');
  expect(await state(app)).toEqual(withTwoKeys);
});

test('keyboard undo while the cut-out editor is open does not touch the canvas', async ({ app }) => {
  await addFromLibrary(app, 'quadrants');
  const before = await state(app);
  const e = await ed.openEditor(app, await selectedLayer(app));
  await ed.scissors(e, [[62, -10], [130, -10], [130, 90], [62, 90]]);
  await app.keyboard.press('Control+z');     // undoes the scissors, inside the editor
  await ed.cancel(e);
  expect(await state(app)).toEqual(before);
  await expect(app.locator('#undoBtn')).toBeEnabled();   // the canvas history is still there
});

// F8: Open adds to history instead of clearing it, so Undo can rescue work replaced by
// an accidental Open. Undo must then bring back the whole earlier document.
test('Undo after Open brings back the previous document, including Loop', async ({ app }, testInfo) => {
  await app.click('[data-tool="shape"]');
  await dragOnBoard(app, [200, 200], [400, 300]);
  const before = await state(app);
  const p = testInfo.outputPath('other.json');
  fs.writeFileSync(p, JSON.stringify({ app: 'collage-maker', version: 1,
    doc: { w: 960, h: 720, duration: 3, fps: 24, loop: false }, arts: [], layers: [] }));
  await app.setInputFiles('#openFile', p);
  await expect.poll(() => app.evaluate(() => CM.app.doc.layers.length)).toBe(0);
  await app.click('#undoBtn');
  expect(await state(app)).toEqual(before);
  await expect(app.locator('#loopChk')).toBeChecked();
});
