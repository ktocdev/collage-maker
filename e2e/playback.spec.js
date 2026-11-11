// Handoff #8 (part 1): playback. Play, Pause, Rewind, Space, looping on and off, and the
// frame-snapped drawing that gives the choppy cut-out look. Time is driven by Playwright's
// fake clock, so these tests do not depend on real timing.
const { test, expect } = require('./support/fixtures.js');
const { key, board } = require('./support/board.js');

// Like the `app` fixture, but with the clock installed before the page loads.
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: 0 });
  await page.goto('/');
  await page.evaluate(() => CM.app.ready);
  // Freeze time from here on: it only moves when a test calls runFor.
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 50);
});
const shown = page => page.locator('#timeOut').textContent().then(parseFloat);
const playing = page => page.locator('#playBtn').textContent().then(t => t.includes('⏸'));

test('Play advances in real time; Pause stops and snaps to a frame', async ({ page }) => {
  await page.click('#playBtn');
  expect(await playing(page)).toBe(true);
  await page.clock.runFor(1000);
  expect(await shown(page)).toBeCloseTo(1, 1);
  await page.click('#playBtn');
  expect(await playing(page)).toBe(false);
  await page.clock.runFor(50);                             // let the readout redraw after the snap
  const t = await shown(page);
  await page.clock.runFor(1000);
  expect(await shown(page)).toBe(t);                       // stays paused
  expect(Math.abs(t * 12 - Math.round(t * 12))).toBeLessThan(0.07);   // on the 12 fps grid (2-decimal readout)
});

test('with Loop on, playback wraps around and keeps going', async ({ page }) => {
  await page.fill('#durInp', '2');
  await page.press('#durInp', 'Tab');
  await page.click('#playBtn');
  await page.clock.runFor(2500);
  expect(await playing(page)).toBe(true);
  expect(await shown(page)).toBeCloseTo(0.5, 1);
});

test('with Loop off, playback stops at the end; Play again restarts from 0', async ({ page }) => {
  await page.fill('#durInp', '2');
  await page.press('#durInp', 'Tab');
  await page.uncheck('#loopChk');
  await page.click('#playBtn');
  await page.clock.runFor(3000);
  expect(await playing(page)).toBe(false);
  expect(await shown(page)).toBe(2);
  await page.click('#playBtn');
  await page.clock.runFor(300);
  expect(await shown(page)).toBeCloseTo(0.3, 1);
});

test('Space toggles playback, but not while typing in a field', async ({ page }) => {
  await key(page, ' ');
  expect(await playing(page)).toBe(true);
  await key(page, ' ');
  expect(await playing(page)).toBe(false);
  await page.click('#durInp');
  await page.keyboard.press(' ');
  expect(await playing(page)).toBe(false);
});

test('Space on a focused button toggles playback once, not twice', async ({ page }) => {
  // A focused button would also "click" on Space; the app blurs it to avoid a double toggle.
  await page.focus('#addFillBtn');
  const layers = await page.evaluate(() => CM.app.doc.layers.length);
  await page.keyboard.press(' ');
  expect(await playing(page)).toBe(true);
  expect(await page.evaluate(() => CM.app.doc.layers.length)).toBe(layers);
});

test('Rewind pauses and goes back to 0', async ({ page }) => {
  await page.click('#playBtn');
  await page.clock.runFor(1500);
  await page.click('#rewindBtn');
  expect(await playing(page)).toBe(false);
  await page.clock.runFor(100);
  expect(await shown(page)).toBe(0);
});

test('pressing on the board pauses playback', async ({ page }) => {
  await page.click('#playBtn');
  await page.clock.runFor(500);
  const at = await board(page);
  await page.mouse.click(...at(20, 20));
  expect(await playing(page)).toBe(false);
});

test('while playing, the board shows whole frames only', async ({ page }) => {
  // A piece sliding linearly. At 12 fps the board must show the pose of the last whole
  // frame, not the in-between time.
  await page.evaluate(() => {
    const A = CM.app, l = A.newShape('rect');
    Object.assign(l, { y: 360, w: 80, h: 80, ease: 'linear' });
    Object.assign(A.addKey(l, 0), { x: 100 });
    Object.assign(A.addKey(l, 2), { x: 1100 });
    A.addLayer(l); A.select(null);
  });
  await page.click('#playBtn');
  await page.clock.runFor(1040);
  // Freeze the clock and compare the board with the frame before and the exact time.
  const r = await page.evaluate(() => {
    const { doc, paint } = CM.app, t = parseFloat(document.getElementById('timeOut').textContent);
    const boardPx = document.getElementById('board').getContext('2d').getImageData(0, 0, doc.w, doc.h).data;
    const render = tt => { const c = CM.canvas(doc.w, doc.h), x = c.getContext('2d'); paint(x, tt); return x.getImageData(0, 0, doc.w, doc.h).data; };
    const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    const frame = Math.floor(t * doc.fps + 1e-6) / doc.fps;
    return { t, frame, matchesFrame: same(boardPx, render(frame)), matchesExact: same(boardPx, render(t)) };
  });
  expect(r.frame).not.toBe(r.t);
  expect(r.matchesFrame).toBe(true);
  expect(r.matchesExact).toBe(false);
});
