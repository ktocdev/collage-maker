// Drives the cut-out editor through the real UI, in picture coordinates.

// Selects the art layer, opens the editor with the properties panel button, and
// returns an editor handle. `size` is the picture size the editor starts with.
async function openEditor(page, layerId) {
  const size = await page.evaluate(id => {
    CM.app.select(id);
    const a = CM.app.doc.layers.find(l => l.id === id).art.orig;
    return { w: a.width, h: a.height };
  }, layerId);
  await page.locator('#props').getByRole('button', { name: '✂ Edit / cut out' }).click();
  await page.locator('#editor:not(.hidden)').waitFor();
  return { page, size };
}

// Where picture pixel (px, py) is on screen. Mirrors fit() in editor.js: the picture
// is centred in the editor canvas with a 20 px margin.
async function mapper({ page, size }) {
  await page.click('#edFit');
  const r = await page.locator('#edCanvas').boundingBox();
  const z = Math.min((r.width - 40) / size.w, (r.height - 40) / size.h);
  const vx = (r.width - size.w * z) / 2, vy = (r.height - size.h * z) / 2;
  return (px, py) => [r.x + vx + px * z, r.y + vy + py * z];
}

// Scissors: draws a closed loop through the given picture points.
async function scissors(ed, pts, mode = 'keep') {
  const { page } = ed;
  await page.click('#edTools [data-t="lasso"]');
  await page.locator('#edToolOpts select').selectOption(mode);
  const at = await mapper(ed);
  const path = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    for (let s = 0; s < 6; s++) path.push([a[0] + (b[0] - a[0]) * s / 6, a[1] + (b[1] - a[1]) * s / 6]);
  }
  await page.mouse.move(...at(...path[0]));
  await page.mouse.down();
  for (const p of path.slice(1)) await page.mouse.move(...at(...p));
  await page.mouse.up();
}

// Trim crops the picture, so later scissors calls must use the new size. Tests here
// only cut before trimming.
const trim = ({ page }) => page.click('#edTrim');
async function apply({ page }) {
  await page.click('#edApply');
  await page.locator('#editor').and(page.locator('.hidden')).waitFor({ state: 'attached' });
}
async function cancel({ page }) {
  await page.click('#edCancel');
  await page.locator('#editor').and(page.locator('.hidden')).waitFor({ state: 'attached' });
}

// Picks an editor tool by its button, e.g. 'erase', 'restore', 'wand', 'lasso', 'pan'.
const tool = ({ page }, t) => page.click(`#edTools [data-t="${t}"]`);
// Sets a slider in the tool options or effects panel by its label.
async function slider({ page }, label, value) {
  await page.locator('#editor label').filter({ hasText: label }).locator('input[type=range]').fill(String(value));
}
// A brush stroke through picture points, with the current tool.
async function stroke(ed, pts) {
  const { page } = ed, at = await mapper(ed);
  await page.mouse.move(...at(...pts[0]));
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    for (let s = 1; s <= 8; s++) await page.mouse.move(...at(a[0] + (b[0] - a[0]) * s / 8, a[1] + (b[1] - a[1]) * s / 8));
  }
  await page.mouse.up();
}
// A single click at a picture point, with the current tool.
async function clickAt(ed, pt) {
  const at = await mapper(ed);
  await ed.page.mouse.click(...at(...pt));
}
// Alpha of the layer's mask at picture points [[x, y], ...] (after Apply, untrimmed).
const maskAlpha = (page, id, pts) => page.evaluate(({ id, pts }) => {
  const m = CM.app.doc.layers.find(l => l.id === id).art.mask.getContext('2d');
  return pts.map(([x, y]) => m.getImageData(x, y, 1, 1).data[3]);
}, { id, pts });

module.exports = { openEditor, mapper, scissors, trim, apply, cancel, tool, slider, stroke, clickAt, maskAlpha };
