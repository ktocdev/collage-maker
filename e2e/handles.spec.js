// Handoff #6: selection handles. Corner squares resize (uniformly, or stretch with Shift),
// the yellow knob rotates (Shift snaps to 15°). Checked on plain, rotated and flipped layers.
const { test, expect } = require('./support/fixtures.js');
const { board, dragOnBoard, key } = require('./support/board.js');

const RAD = Math.PI / 180;
// Same maths as toDoc() in app.js: layer-local point -> doc coordinates.
const toDoc = (p, lx, ly) => {
  const c = Math.cos(p.rot * RAD), s = Math.sin(p.rot * RAD), ux = lx * p.sx, uy = ly * p.sy;
  return [p.x + ux * c - uy * s, p.y + ux * s + uy * c];
};
const rotateAround = (pt, c, deg) => {
  const a = deg * RAD, dx = pt[0] - c[0], dy = pt[1] - c[1];
  return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)];
};

// Adds a 200 x 100 rectangle with the given transform and selects it.
async function rect(page, props = {}) {
  const l = await page.evaluate(props => {
    const A = CM.app, l = A.newShape('rect');
    Object.assign(l, { x: 640, y: 360, w: 200, h: 100 }, props);
    A.addLayer(l);
    return { id: l.id, x: l.x, y: l.y, w: l.w, h: l.h, sx: l.sx, sy: l.sy, rot: l.rot };
  }, props);
  const at = await board(page);
  // Corner squares, clockwise from top-left, and the rotate knob (28 screen px above the top edge).
  const corners = [[-l.w / 2, -l.h / 2], [l.w / 2, -l.h / 2], [l.w / 2, l.h / 2], [-l.w / 2, l.h / 2]];
  const top = toDoc(l, 0, -l.h / 2), d = [top[0] - l.x, top[1] - l.y], len = Math.hypot(...d);
  const knob = [top[0] + d[0] / len * 28 / at.viewScale, top[1] + d[1] / len * 28 / at.viewScale];
  return { ...l, local: corners, corner: i => toDoc(l, ...corners[i]), knob, centre: [l.x, l.y] };
}
// The rotate knob of a layer as it is now.
async function knobOf(page, id) {
  const l = await layer(page, id), h = await page.evaluate(id => CM.app.doc.layers.find(l => l.id === id).h, id);
  const vs = (await board(page)).viewScale;
  const top = toDoc(l, 0, -h / 2), d = [top[0] - l.x, top[1] - l.y], len = Math.hypot(...d);
  return [top[0] + d[0] / len * 28 / vs, top[1] + d[1] / len * 28 / vs];
}
const layer = (page, id) => page.evaluate(id => {
  const l = CM.app.doc.layers.find(l => l.id === id);
  return { x: l.x, y: l.y, sx: l.sx, sy: l.sy, rot: l.rot };
}, id);

const CASES = {
  plain: {},
  rotated: { rot: 30 },
  flipped: { sx: -1 },
  'flipped and rotated': { sx: -1.2, sy: 0.8, rot: -65 },
  'upside down': { sy: -1, rot: 160 },
};

for (const [name, props] of Object.entries(CASES)) {
  test.describe(`${name} layer`, () => {
    test('dragging a corner resizes uniformly and keeps the flip', async ({ app }) => {
      const r = await rect(app, props);
      for (const [i, f] of [[2, 1.5], [0, 0.6]]) {
        const before = await layer(app, r.id);
        const now = { ...r, ...before };
        const from = toDoc(now, ...r.local[i]), to = [r.x + (from[0] - r.x) * f, r.y + (from[1] - r.y) * f];
        await dragOnBoard(app, from, to);
        const after = await layer(app, r.id);
        expect(after.sx).toBeCloseTo(before.sx * f, 1);
        expect(after.sy).toBeCloseTo(before.sy * f, 1);
        expect(Math.sign(after.sx)).toBe(Math.sign(before.sx));
        expect(Math.sign(after.sy)).toBe(Math.sign(before.sy));
        expect([after.x, after.y, after.rot]).toEqual([before.x, before.y, before.rot]);
      }
    });

    test('Shift + corner stretches one axis at a time', async ({ app }) => {
      const r = await rect(app, props);
      // Along the layer's own x axis: only sx changes.
      await dragOnBoard(app, r.corner(2), toDoc(r, r.local[2][0] * 1.8, r.local[2][1]), { shift: true });
      let after = await layer(app, r.id);
      expect(after.sx).toBeCloseTo(r.sx * 1.8, 1);
      expect(after.sy).toBeCloseTo(r.sy, 2);
      // Then along its y axis: only sy changes.
      const now = { ...r, ...after };
      await dragOnBoard(app, toDoc(now, ...r.local[3]), toDoc(now, r.local[3][0], r.local[3][1] * 0.5), { shift: true });
      const after2 = await layer(app, r.id);
      expect(after2.sx).toBeCloseTo(after.sx, 2);
      expect(after2.sy).toBeCloseTo(r.sy * 0.5, 1);
      expect([after2.x, after2.y, after2.rot]).toEqual([r.x, r.y, r.rot]);
    });

    test('dragging the knob rotates by the angle moved', async ({ app }) => {
      const r = await rect(app, props);
      const arc = deg => { const n = Math.ceil(Math.abs(deg) / 20); return Array.from({ length: n }, (_, i) => rotateAround(r.knob, r.centre, deg * (i + 1) / n)); };
      const path = arc(75);
      await dragOnBoard(app, r.knob, path.at(-1), { via: path.slice(0, -1), steps: 3 });
      const after = await layer(app, r.id);
      expect(after.rot).toBeCloseTo(r.rot + 75, 0);
      expect([after.x, after.y, after.sx, after.sy]).toEqual([r.x, r.y, r.sx, r.sy]);
    });

    test('Shift + knob snaps to 15°', async ({ app }) => {
      const r = await rect(app, props);
      await dragOnBoard(app, r.knob, rotateAround(r.knob, r.centre, 37), { shift: true });
      const after = await layer(app, r.id);
      expect(after.rot % 15).toBeCloseTo(0, 5);
      expect(after.rot).toBe(Math.round((r.rot + 37) / 15) * 15);
    });
  });
}

// B8: atan2 jumps by 360° at 9 o'clock, so a long drag used to store a rotation
// a whole turn off, and keyframes then turned the wrong way.
test('rotating most of a turn in one drag stores the full angle', async ({ app }) => {
  const r = await rect(app);
  for (const deg of [270, -270, 400]) {
    const before = (await layer(app, r.id)).rot;
    const knob = await knobOf(app, r.id);
    const n = Math.ceil(Math.abs(deg) / 15), path = Array.from({ length: n }, (_, i) => rotateAround(knob, r.centre, deg * (i + 1) / n));
    await dragOnBoard(app, knob, path.at(-1), { via: path.slice(0, -1), steps: 2 });
    expect((await layer(app, r.id)).rot, `rotate by ${deg}`).toBeCloseTo(before + deg, 0);
  }
});

test('each handle drag is one undo step', async ({ app }) => {
  const r = await rect(app, { rot: 20 });
  const start = await layer(app, r.id);
  await dragOnBoard(app, r.corner(2), [r.x + (r.corner(2)[0] - r.x) * 1.4, r.y + (r.corner(2)[1] - r.y) * 1.4]);
  const resized = await layer(app, r.id);
  const knob = await knobOf(app, r.id);
  await dragOnBoard(app, knob, rotateAround(knob, r.centre, 40));
  await app.click('#undoBtn');
  expect(await layer(app, r.id)).toEqual(resized);
  await app.click('#undoBtn');
  expect(await layer(app, r.id)).toEqual(start);
});

test('a handle drag on a keyframed layer writes to the keyframe at the playhead', async ({ app }) => {
  const r = await rect(app);
  await key(app, 'k');                                   // keyframe at 0s
  await app.evaluate(() => CM.app.setTime(2));
  await dragOnBoard(app, r.corner(2), [r.x + 150, r.y + 75]);   // corner was at +100,+50: x1.5
  const keys = await app.evaluate(id => CM.app.doc.layers.find(l => l.id === id).keys.map(k => ({ t: k.t, sx: k.sx })), r.id);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toEqual({ t: 0, sx: 1 });
  expect(keys[1].t).toBe(2);
  expect(keys[1].sx).toBeCloseTo(1.5, 1);
});

test('handles are hidden while playing and come back on pause', async ({ app }) => {
  const r = await rect(app);
  // The knob is outside the shape, so its pixel is only drawn by the overlay.
  const knobPixel = () => app.evaluate(([x, y]) => {
    const c = document.getElementById('board');
    const [r, g, b] = c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return r > 180 && g > 130 && b < 90;          // the knob is #d9a520 on a blue background
  }, r.knob);
  await expect.poll(knobPixel).toBe(true);
  await app.click('#playBtn');
  await expect.poll(knobPixel).toBe(false);
  await app.click('#playBtn');
  await expect.poll(knobPixel).toBe(true);
});
