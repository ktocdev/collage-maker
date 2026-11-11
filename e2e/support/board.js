// Helpers for the main board, the keyboard and the layer list.
const { expect } = require('@playwright/test');

// Doc coordinates -> screen, for the main board.
async function board(page) {
  const r = await page.locator('#board').boundingBox();
  const { w, h } = await page.evaluate(() => ({ w: CM.app.doc.w, h: CM.app.doc.h }));
  return Object.assign((x, y) => [r.x + x * r.width / w, r.y + y * r.height / h], { viewScale: r.width / w });
}

// Drags in doc coordinates, in small steps. `shift` holds Shift during the move.
async function dragOnBoard(page, from, to, { shift = false, steps = 8, via = [] } = {}) {
  const at = await board(page);
  const pts = [from, ...via, to];
  await page.mouse.move(...at(...from));
  await page.mouse.down();
  if (shift) await page.keyboard.down('Shift');
  for (let j = 1; j < pts.length; j++) {
    const a = pts[j - 1], b = pts[j];
    for (let i = 1; i <= steps; i++) await page.mouse.move(...at(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps));
  }
  if (shift) await page.keyboard.up('Shift');
  await page.mouse.up();
}

// Keyboard shortcuts are ignored while a text field or select has focus.
async function key(page, combo) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(combo);
}

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

module.exports = { board, dragOnBoard, key, row, addFromLibrary, selectedLayer };
