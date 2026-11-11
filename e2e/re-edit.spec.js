// Handoff #2: re-editing an art layer that is already on the canvas. When the cut-out
// shrinks or is trimmed, the layer (and each keyframe) is shifted so the pixels that
// remain stay exactly where they were on the board.
const { test, expect } = require('./support/fixtures.js');
const ed = require('./support/editor.js');

// quadrants.png is 120 x 80. These loops are in its pixel coordinates.
const CUTS = {
  'right half': { loop: [[62, -10], [130, -10], [130, 90], [62, 90]], trim: false },
  'right half, trimmed': { loop: [[62, -10], [130, -10], [130, 90], [62, 90]], trim: true },
  'bottom-right corner, trimmed': { loop: [[75, 45], [130, 45], [130, 90], [75, 90]], trim: true },
  'off-centre island, trimmed': { loop: [[20, 50], [45, 50], [45, 72], [20, 72]], trim: true },
};
const TRANSFORMS = {
  plain: { sx: 3, sy: 3, rot: 0 },
  rotated: { sx: 3, sy: 3, rot: 30 },
  stretched: { sx: 4, sy: 1.5, rot: 0 },
  flipped: { sx: -3, sy: 3, rot: 0 },
  'flipped, stretched and rotated': { sx: -4, sy: 2, rot: -50 },
  'upside down': { sx: 3, sy: -2.5, rot: 200 },
};

// Adds quadrants.png as a layer on an otherwise empty (transparent) board.
function place(page, props, keys = []) {
  return page.evaluate(async ({ props, keys }) => {
    const A = CM.app;
    A.doc.layers[0].visible = false;
    await A.addArtToBoard(A.lib.find(i => i.name === 'quadrants'));
    const l = A.doc.layers.at(-1);
    Object.assign(l, { x: 640, y: 360 }, props);
    for (const k of keys) Object.assign(A.addKey(l, k.t), k);
    A.commit(); A.refresh();
    return l.id;
  }, { props, keys });
}

// Renders the board at time t into window.__shots[name].
function shoot(page, name, t = 0) {
  return page.evaluate(({ name, t }) => {
    const { doc, paint } = CM.app, c = CM.canvas(doc.w, doc.h), x = c.getContext('2d');
    paint(x, t);
    (window.__shots ||= {})[name] = x.getImageData(0, 0, doc.w, doc.h);
  }, { name, t });
}

// Compares two renders. Only pixels fully opaque in both are compared (the cut edge
// is antialiased and expected to differ). `appeared` counts pixels that are clearly
// visible after the edit but were empty before: there must be none.
function compare(page, a, b) {
  return page.evaluate(([a, b]) => {
    const A = window.__shots[a].data, B = window.__shots[b].data;
    let compared = 0, bOpaque = 0, appeared = 0, bad = 0, max = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (B[i + 3] === 255) bOpaque++;
      if (B[i + 3] > 200 && A[i + 3] < 50) appeared++;
      if (A[i + 3] !== 255 || B[i + 3] !== 255) continue;
      compared++;
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      if (d > max) max = d;
      if (d > 16) bad++;
    }
    return { compared, bOpaque, appeared, bad, max };
  }, [a, b]);
}

function expectStill(stats, label) {
  expect(stats.bOpaque, `${label}: something is left after the cut`).toBeGreaterThan(500);
  expect(stats.compared / stats.bOpaque, `${label}: remaining pixels overlap where they were`).toBeGreaterThan(0.97);
  expect(stats.appeared, `${label}: nothing appears where the board was empty`).toBe(0);
  expect(stats.bad, `${label}: remaining pixels keep their colour`).toBe(0);
}

async function cut(page, id, { loop, trim }) {
  const e = await ed.openEditor(page, id);
  await ed.scissors(e, loop, 'keep');
  if (trim) await ed.trim(e);
  await ed.apply(e);
}

for (const [tName, props] of Object.entries(TRANSFORMS)) {
  for (const [cName, c] of Object.entries(CUTS)) {
    test(`${tName} layer, ${cName}: remaining pixels stay put`, async ({ app }) => {
      const id = await place(app, props);
      await shoot(app, 'before');
      await cut(app, id, c);
      await shoot(app, 'after');
      const stats = await compare(app, 'before', 'after');
      expectStill(stats, `${tName} / ${cName}`);
      // The cut really changed something.
      const after = await app.evaluate(id => CM.app.doc.layers.find(l => l.id === id).art.bounds, id);
      expect(after.w).toBeLessThan(120);
    });
  }
}

const KEYS = [
  { t: 0, x: 400, y: 300, sx: 3, sy: 3, rot: 0 },
  { t: 2, x: 900, y: 420, sx: -2, sy: 3.5, rot: 120 },
  { t: 4, x: 600, y: 500, sx: 2, sy: 2, rot: -40 },
];

test('with keyframes: remaining pixels stay put at every keyframe', async ({ app }) => {
  const id = await place(app, { ease: 'linear' }, KEYS);
  for (const k of KEYS) await shoot(app, 'before@' + k.t, k.t);
  await cut(app, id, CUTS['bottom-right corner, trimmed']);
  for (const k of KEYS) {
    await shoot(app, 'after@' + k.t, k.t);
    expectStill(await compare(app, 'before@' + k.t, 'after@' + k.t), `keyframe at ${k.t}s`);
  }
});

test('with keyframes: remaining pixels stay put between keyframes', async ({ app }) => {
  // Known bug B6 (Testing-Build-Log.md): keyframes are shifted, not the pivot, so the piece
  // drifts between keyframes and during looping motions. Remove this line when B6 is fixed.
  test.fail(true, 'B6: re-edit drift');
  const id = await place(app, { ease: 'linear' }, KEYS);
  const times = [0.5, 1, 1.5, 2.5];
  for (const t of times) await shoot(app, 'before@' + t, t);
  await cut(app, id, CUTS['bottom-right corner, trimmed']);
  const results = {};
  for (const t of times) {
    await shoot(app, 'after@' + t, t);
    results[t] = await compare(app, 'before@' + t, 'after@' + t);
  }
  for (const t of times) expectStill(results[t], `between keyframes at ${t}s`);
});

for (const motion of ['wobble', 'pulse', 'spin']) {
  test(`with a ${motion} motion: remaining pixels stay put while it moves`, async ({ app }) => {
    // Known bug B6 (Testing-Build-Log.md): keyframes are shifted, not the pivot, so the piece
    // drifts between keyframes and during looping motions. Remove this line when B6 is fixed.
    test.fail(true, 'B6: re-edit drift');
    const id = await place(app, { ...TRANSFORMS.plain, motion: { type: motion, amt: 2, speed: 1 } });
    const times = [0.15, 0.4, 0.7];
    for (const t of times) await shoot(app, 'before@' + t, t);
    await cut(app, id, CUTS['bottom-right corner, trimmed']);
    const results = {};
    for (const t of times) { await shoot(app, 'after@' + t, t); results[t] = await compare(app, 'before@' + t, 'after@' + t); }
    for (const t of times) expectStill(results[t], `${motion} at ${t}s`);
  });
}

test('re-editing the same layer twice keeps the pixels put both times', async ({ app }) => {
  const id = await place(app, TRANSFORMS['flipped, stretched and rotated']);
  await shoot(app, 'start');
  await cut(app, id, CUTS['right half, trimmed']);
  await shoot(app, 'once');
  // Second edit: the picture is now the trimmed one, so cut in its coordinates.
  const size = await app.evaluate(id => { const a = CM.app.doc.layers.find(l => l.id === id).art.orig; return [a.width, a.height]; }, id);
  await cut(app, id, { loop: [[-10, size[1] / 2], [size[0] + 10, size[1] / 2], [size[0] + 10, size[1] + 10], [-10, size[1] + 10]], trim: true });
  await shoot(app, 'twice');
  expectStill(await compare(app, 'start', 'once'), 'first edit');
  expectStill(await compare(app, 'once', 'twice'), 'second edit');
  expectStill(await compare(app, 'start', 'twice'), 'both edits');
});

test('Cancel leaves the layer exactly as it was', async ({ app }) => {
  const id = await place(app, TRANSFORMS.rotated);
  const before = await app.evaluate(id => { const l = CM.app.doc.layers.find(l => l.id === id); return { art: (window.__art = l.art) && true, x: l.x, y: l.y }; }, id);
  const e = await ed.openEditor(app, id);
  await ed.scissors(e, CUTS['right half'].loop);
  await ed.trim(e);
  await ed.cancel(e);
  const after = await app.evaluate(id => { const l = CM.app.doc.layers.find(l => l.id === id); return { same: l.art === window.__art, x: l.x, y: l.y }; }, id);
  expect(after).toEqual({ same: true, x: before.x, y: before.y });
});

test('Apply does not change the art state it was given (art is immutable)', async ({ app }) => {
  const id = await place(app, TRANSFORMS.plain);
  const before = await app.evaluate(id => {
    const a = CM.app.doc.layers.find(l => l.id === id).art;
    window.__old = a;
    return [a.mask.toDataURL(), a.out.toDataURL(), a.orig.width, JSON.stringify(a.bounds)];
  }, id);
  await cut(app, id, CUTS['right half, trimmed']);
  const after = await app.evaluate(() => {
    const a = window.__old;
    return [a.mask.toDataURL(), a.out.toDataURL(), a.orig.width, JSON.stringify(a.bounds)];
  });
  expect(after).toEqual(before);
});

test('Undo after Apply restores the old cut-out and position; Redo re-applies', async ({ app }) => {
  const id = await place(app, TRANSFORMS['flipped, stretched and rotated']);
  await shoot(app, 'before');
  const state = () => app.evaluate(id => { const l = CM.app.doc.layers.find(l => l.id === id); return { x: l.x, y: l.y, w: l.art.bounds.w, h: l.art.bounds.h }; }, id);
  const s0 = await state();
  await cut(app, id, CUTS['bottom-right corner, trimmed']);
  const s1 = await state();
  expect(s1).not.toEqual(s0);
  await app.click('#undoBtn');
  expect(await state()).toEqual(s0);
  await shoot(app, 'undone');
  const back = await compare(app, 'before', 'undone');
  expect(back.max).toBe(0);
  expect(back.compared).toBe(back.bOpaque);
  await app.click('#redoBtn');
  expect(await state()).toEqual(s1);
});
