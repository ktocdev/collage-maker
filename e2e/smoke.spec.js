// The page starts cleanly against a seeded temp library.
const { test, expect } = require('./support/fixtures.js');

test('starts with one background layer and the default document', async ({ app }) => {
  const state = await app.evaluate(() => {
    const { doc } = CM.app;
    return { w: doc.w, h: doc.h, duration: doc.duration, fps: doc.fps, loop: doc.loop,
      layers: doc.layers.map(l => ({ type: l.type, name: l.name })) };
  });
  expect(state).toEqual({ w: 1280, h: 720, duration: 6, fps: 12, loop: true,
    layers: [{ type: 'fill', name: 'Background' }] });
  await expect(app.locator('#board')).toHaveJSProperty('width', 1280);
  await expect(app.locator('#board')).toHaveJSProperty('height', 720);
});

test('lists the seeded library: cut-outs first, then pictures', async ({ app }) => {
  const grid = app.locator('#libGrid');
  await expect(grid.locator('h3')).toHaveText(['Your cut-outs', 'Pictures']);
  await expect(grid.locator('.lib-item span')).toHaveText(['ell-cut', 'quadrants', 'soft-dot']);
  // every thumbnail actually loaded
  for (const img of await grid.locator('.lib-item img').all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  }
});

test('does not show the "could not read the library" message', async ({ app }) => {
  await expect(app.locator('#libGrid .lib-msg')).toHaveCount(0);
});

test('never uses the real library folder', async ({ app, server }) => {
  const names = await app.evaluate(() => CM.app.lib.map(i => i.name));
  expect(names.sort()).toEqual(['ell-cut', 'quadrants', 'soft-dot']);
  expect(server.dataDir).not.toContain('collage-maker');
});
