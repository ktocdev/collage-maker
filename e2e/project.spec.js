// Handoff #1: project Save and Open, the only way to keep work between sessions.
const fs = require('node:fs');
const { test, expect } = require('./support/fixtures.js');

const TIMES = [0, 0.5, 1, 1.75, 2.5, 3.25, 4];

// Builds a scene that touches every field a project file has to carry. Setup goes
// through CM.app (it is not what is under test); Save and Open go through the UI.
async function buildScene(page) {
  // Document settings through the real controls. Done first, because changing the
  // duration discards keyframes past the end.
  await page.selectOption('#sizeSel', '960x720');
  await page.fill('#durInp', '4');
  await page.locator('#durInp').dispatchEvent('change');
  await page.selectOption('#fpsSel', '24');
  await page.uncheck('#loopChk');

  await page.evaluate(async () => {
    const A = CM.app, item = n => A.lib.find(i => i.name === n), last = () => A.doc.layers.at(-1);

    // An edited cut-out: erased corner, half-transparent patch, several effects.
    await A.addArtToBoard(item('quadrants'));
    const quad = last();
    const m = CM.copyCanvas(quad.art.mask), g = m.getContext('2d');
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(0, 0, 30, 20);
    g.globalAlpha = 0.5; g.fillRect(70, 40, 30, 30);
    quad.art = CM.buildArt({ orig: quad.art.orig, mask: m,
      fx: { ...CM.defaultFx(), hue: 40, sat: 140, ovAmt: 30, ovColor: '#00ffaa', ovMode: 'multiply' } });
    Object.assign(quad, { name: 'Quad', x: 300, y: 250, sx: -2, sy: 1.5, rot: 30, opacity: 0.9,
      blend: 'multiply', ease: 'overshoot', motion: { type: 'wobble', amt: 1.5, speed: 0.5 } });
    A.addKey(quad, 0);
    Object.assign(A.addKey(quad, 2), { x: 700, rot: -20, sx: -1 });
    A.select(quad.id);
  });

  // Duplicate through the UI: the copy shares the art state by reference.
  await page.click('#dupBtn');

  await page.evaluate(async () => {
    const A = CM.app, item = n => A.lib.find(i => i.name === n), last = () => A.doc.layers.at(-1);

    // A picture with soft transparency, animated with a hold ease and a spin.
    await A.addArtToBoard(item('soft-dot'));
    Object.assign(last(), { x: 800, y: 200, sx: 3, sy: 3, ease: 'hold', motion: { type: 'spin', amt: 1, speed: 0.25 } });
    A.addKey(last(), 0);
    Object.assign(A.addKey(last(), 3), { opacity: 0.2, y: 400 });

    // A library cut-out, hidden.
    await A.addArtToBoard(item('ell-cut'));
    Object.assign(last(), { visible: false, name: 'Hidden ell' });

    // Shapes: radial gradient star with an outline, pattern rectangle, smooth closed path, open line.
    const star = A.newShape('star');
    Object.assign(star, { x: 200, y: 550, w: 180, h: 160, rot: 15,
      fill: { ...CM.defaultFill('#ff8800'), type: 'gradient', gradType: 'radial', color2: '#220044' },
      stroke: { color: '#ffffff', width: 6 } });
    A.addLayer(star);

    const rect = A.newShape('rect');
    Object.assign(rect, { x: 650, y: 560, w: 260, h: 120, opacity: 0.8, blend: 'screen',
      fill: { ...CM.defaultFill('#113355'), type: 'pattern', pattern: 'zigzag', color2: '#ffee88', scale: 2 },
      motion: { type: 'bob', amt: 2, speed: 1 } });
    A.addLayer(rect);

    const blob = A.newShape('path');
    Object.assign(blob, { x: 480, y: 360, w: 180, h: 140, pts: [[-80, -40], [60, -70], [90, 50], [-40, 70]],
      closed: true, smooth: true, fill: { ...CM.defaultFill('#cc2255'), type: 'texture', texture: 'wood', color2: '#ffddaa' } });
    A.addLayer(blob);

    const line = A.newShape('path');
    Object.assign(line, { x: 480, y: 120, w: 300, h: 40, pts: [[-150, 0], [-50, -20], [50, 20], [150, 0]],
      closed: false, smooth: false, stroke: { color: '#000000', width: 9 } });
    A.addKey(line, 1);
    Object.assign(A.addKey(line, 4), { rot: 90 });
    A.addLayer(line);

    // A second fill layer: linear gradient, half opacity, blended.
    const wash = A.newFill('#ff0000');
    Object.assign(wash, { opacity: 0.5, blend: 'overlay',
      fill: { ...wash.fill, type: 'gradient', gradType: 'linear', angle: 30, color2: '#0000ff' } });
    A.addLayer(wash);
    A.doc.layers[0].fill = { ...A.doc.layers[0].fill, type: 'texture', texture: 'paper', scale: 0.5 };
    A.commit(); A.refresh();
  });
}

// Everything that should survive a round trip, in a form that can be compared:
// layer fields minus ids, art states as pixels, and rendered frames.
function snapshot(page) {
  return page.evaluate(times => {
    const { doc, paint } = CM.app, arts = [];
    const png = c => c.toDataURL('image/png');
    const layers = doc.layers.map(l => {
      const { id, art, ...rest } = l;
      const o = JSON.parse(JSON.stringify(rest));
      if (art) o.art = arts.includes(art) ? arts.indexOf(art) : arts.push(art) - 1;
      return o;
    });
    const frames = times.map(t => { const c = CM.canvas(doc.w, doc.h); paint(c.getContext('2d'), t); return png(c); });
    return {
      doc: { w: doc.w, h: doc.h, duration: doc.duration, fps: doc.fps, loop: doc.loop },
      layers,
      arts: arts.map(a => ({ fx: a.fx, bounds: a.bounds, orig: png(a.orig), mask: png(a.mask), out: png(a.out) })),
      frames,
    };
  }, TIMES);
}

// Pixel comparison of two PNG data URLs, done in the page.
function diff(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = async url => { const c = CM.copyCanvas(await CM.loadImage(url)); return c.getContext('2d').getImageData(0, 0, c.width, c.height); };
    const [x, y] = await Promise.all([load(a), load(b)]);
    if (x.width !== y.width || x.height !== y.height) return { sizeMismatch: [x.width, x.height, y.width, y.height] };
    let max = 0, over = 0;
    for (let i = 0; i < x.data.length; i++) {
      const d = Math.abs(x.data[i] - y.data[i]);
      if (d > max) max = d;
      if (d > 2) over++;
    }
    return { max, over };
  }, [a, b]);
}

async function save(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#saveBtn')]);
  return { name: download.suggestedFilename(), path: await download.path() };
}

async function open(page, file) {
  await page.setInputFiles('#openFile', file);
}

test('Save writes a collage.json that describes the scene', async ({ app }) => {
  await buildScene(app);
  const file = await save(app);
  expect(file.name).toBe('collage.json');
  const data = JSON.parse(fs.readFileSync(file.path, 'utf8'));
  expect(data.app).toBe('collage-maker');
  expect(data.version).toBe(1);
  expect(data.doc).toEqual({ w: 960, h: 720, duration: 4, fps: 24, loop: false });
  expect(data.layers.map(l => l.type)).toEqual(['fill', 'art', 'art', 'art', 'art', 'shape', 'shape', 'shape', 'shape', 'fill']);
  // The duplicated layer shares its art with the original, so it is stored once: 3 arts, not 4.
  expect(data.arts).toHaveLength(3);
  expect(data.layers[1].art).toBe(data.layers[2].art);
  for (const a of data.arts) {
    expect(a.orig).toMatch(/^data:image\/png;base64,/);
    expect(a.mask).toMatch(/^data:image\/png;base64,/);
  }
});

test('Save, reload, Open restores the same document and the same pixels', async ({ app }) => {
  await buildScene(app);
  const before = await snapshot(app);
  const file = await save(app);

  await app.reload();
  await app.evaluate(() => CM.app.ready);
  expect(await app.evaluate(() => CM.app.doc.layers.length)).toBe(1);

  await open(app, file.path);
  await expect.poll(() => app.evaluate(() => CM.app.doc.layers.length)).toBe(before.layers.length);
  const after = await snapshot(app);

  // The page controls reflect the opened document.
  await expect(app.locator('#sizeSel')).toHaveValue('960x720');
  await expect(app.locator('#durInp')).toHaveValue('4');
  await expect(app.locator('#fpsSel')).toHaveValue('24');
  await expect(app.locator('#loopChk')).not.toBeChecked();

  expect(after.doc).toEqual(before.doc);
  expect(after.layers).toEqual(before.layers);        // includes keyframes, fills, motion, art sharing
  expect(after.arts.map(a => [a.fx, a.bounds])).toEqual(before.arts.map(a => [a.fx, a.bounds]));

  for (const [i, a] of before.arts.entries()) {
    for (const k of ['orig', 'mask', 'out']) {
      expect(await diff(app, a[k], after.arts[i][k]), `art ${i} ${k}`).toEqual({ max: expect.any(Number), over: 0 });
    }
  }
  for (const [i, t] of TIMES.entries()) {
    expect(await diff(app, before.frames[i], after.frames[i]), `frame at ${t}s`).toEqual({ max: expect.any(Number), over: 0 });
  }
});

test('Opened layers get fresh ids and nothing is selected', async ({ app }) => {
  await buildScene(app);
  const file = await save(app);
  await open(app, file.path);   // open on top of the same session, without a reload
  await expect.poll(() => app.evaluate(() => CM.app.doc.layers.length)).toBe(10);
  const ids = await app.evaluate(() => CM.app.doc.layers.map(l => l.id));
  expect(new Set(ids).size).toBe(ids.length);
  await expect(app.locator('#layerList .sel, #layerList [aria-selected="true"]')).toHaveCount(0);
});

test('Opening a project keeps working after a second save and open', async ({ app }) => {
  await buildScene(app);
  const first = await snapshot(app);
  const f1 = await save(app);
  await open(app, f1.path);
  await expect.poll(() => app.evaluate(() => CM.app.doc.layers.length)).toBe(10);
  const f2 = await save(app);
  await app.reload();
  await app.evaluate(() => CM.app.ready);
  await open(app, f2.path);
  await expect.poll(() => app.evaluate(() => CM.app.doc.layers.length)).toBe(10);
  const second = await snapshot(app);
  expect(second.layers).toEqual(first.layers);
  for (const [i] of TIMES.entries()) {
    expect((await diff(app, first.frames[i], second.frames[i])).over).toBe(0);
  }
});

test('Ctrl+S saves the project', async ({ app }) => {
  await app.locator('#board').click({ position: { x: 5, y: 5 } });
  const [download] = await Promise.all([app.waitForEvent('download'), app.keyboard.press('Control+s')]);
  expect(download.suggestedFilename()).toBe('collage.json');
});

test('Opening a file that is not a project shows a message and changes nothing', async ({ app }, testInfo) => {
  const cases = {
    'other.json': JSON.stringify({ hello: 'world' }),
    'broken.json': '{ not json',
  };
  for (const [name, text] of Object.entries(cases)) {
    const p = testInfo.outputPath(name);
    fs.writeFileSync(p, text);
    await open(app, p);
    await expect(app.locator('#toast')).toContainText('Could not open');
    expect(await app.evaluate(() => CM.app.doc.layers.map(l => l.name))).toEqual(['Background']);
  }
  await expect(app.locator('#toast')).toContainText('Could not open');
});

// A damaged project file must be rejected as a whole: no half-applied document.
test('Opening a damaged project shows a message and changes nothing', async ({ app }, testInfo) => {
  const good = { app: 'collage-maker', version: 1, doc: { w: 300, h: 200, duration: 2, fps: 8, loop: false } };
  const cases = {
    'no-layers': { ...good, arts: [] },
    'no-arts': { ...good, layers: [] },
    'art-out-of-range': { ...good, arts: [], layers: [{ type: 'art', art: 0, name: 'x', visible: true, blend: 'source-over',
      x: 0, y: 0, sx: 1, sy: 1, rot: 0, opacity: 1, keys: [], ease: 'ease', motion: { type: 'none', amt: 1, speed: 1 } }] },
    'bad-art-image': { ...good, layers: [], arts: [{ orig: 'data:image/png;base64,AAAA', mask: 'data:image/png;base64,AAAA', fx: {} }] },
  };
  for (const [name, data] of Object.entries(cases)) {
    const p = testInfo.outputPath(name + '.json');
    fs.writeFileSync(p, JSON.stringify(data));
    await app.evaluate(() => { document.getElementById('toast').textContent = ''; });
    await open(app, p);
    await expect(app.locator('#toast'), name).toContainText('Could not open');
    const state = await app.evaluate(() => ({ w: CM.app.doc.w, h: CM.app.doc.h, duration: CM.app.doc.duration,
      fps: CM.app.doc.fps, loop: CM.app.doc.loop, layers: CM.app.doc.layers.map(l => l.name) }));
    expect(state, name).toEqual({ w: 1280, h: 720, duration: 6, fps: 12, loop: true, layers: ['Background'] });
    // and the page can still draw
    await app.evaluate(() => CM.app.paint(CM.canvas(10, 10).getContext('2d'), 0));
  }
});

test('Opening the same file twice in a row works (the file input is reset)', async ({ app }) => {
  await buildScene(app);
  const file = await save(app);
  await app.reload();
  await app.evaluate(() => CM.app.ready);
  await open(app, file.path);
  await expect.poll(() => app.evaluate(() => CM.app.doc.layers.length)).toBe(10);
  await app.evaluate(() => { CM.app.doc.layers.length = 1; CM.app.refresh(); });
  await open(app, file.path);
  await expect.poll(() => app.evaluate(() => CM.app.doc.layers.length)).toBe(10);
});
