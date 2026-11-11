// Handoff #8 (part 2): looping motion presets and keyframe easings, checked against the
// values they are meant to produce. Uses CM.app.evalBase / evalLayer, the functions the
// renderer draws with.
const { test, expect } = require('./support/fixtures.js');

const BASE = { x: 500, y: 300, sx: 1, sy: 1, rot: 0, opacity: 1 };

// Samples evalLayer for a layer with one motion preset over `seconds`.
function sample(page, motion, { seconds = 2, step = 1 / 240, keys = [] } = {}) {
  return page.evaluate(({ BASE, motion, seconds, step, keys }) => {
    const A = CM.app, l = A.newShape('rect');
    Object.assign(l, BASE, { motion });
    for (const k of keys) Object.assign(A.addKey(l, k.t), k);
    const out = [];
    for (let t = 0; t <= seconds + 1e-9; t += step) out.push({ t, ...A.evalLayer(l, t), base: A.evalBase(l, t) });
    return out;
  }, { BASE, motion, seconds, step, keys });
}
const range = (s, f) => { const v = s.map(f); return [Math.min(...v), Math.max(...v)]; };
const unchanged = (s, props) => { for (const p of s) for (const k of props) expect(p[k], `${k} at ${p.t}`).toBeCloseTo(BASE[k], 9); };

test('no motion: drawn pose equals the stored pose', async ({ page, app }) => {
  for (const p of await sample(app, { type: 'none', amt: 3, speed: 2 })) expect({ ...p, t: 0, base: 0 }).toEqual({ ...BASE, t: 0, base: 0 });
});

// [type, property, expected range of offsets for amt = 1, period for speed = 1]
const SWINGS = [
  ['wobble', 'rot', [-8, 8], 1],
  ['bob', 'y', [-18, 18], 1],
  ['sway', 'x', [-30, 30], 1],
  ['hop', 'y', [-50, 0], 1],          // jumps up only (smaller y), lands on the base
  ['chomp', 'y', [0, 26], 0.5],       // drops down only
  ['pulse', 'sx', [-0.08, 0.08], 1],
];
for (const [type, prop, [lo, hi], period] of SWINGS) {
  test(`${type}: moves only ${prop}, within ${lo}..${hi} × amount, period ${period} s ÷ speed`, async ({ app }) => {
    for (const { amt, speed } of [{ amt: 1, speed: 1 }, { amt: 2.5, speed: 1.5 }]) {
      const s = await sample(app, { type, amt, speed }, { seconds: 2 / speed });
      const [mn, mx] = range(s, p => p[prop] - BASE[prop]);
      expect(mn, `${type} min, amt ${amt}`).toBeCloseTo(lo * amt, 1);
      expect(mx, `${type} max, amt ${amt}`).toBeCloseTo(hi * amt, 1);
      // Repeats every period/speed seconds.
      const p = period / speed, at = t => s.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a);
      for (const t of [0.1, 0.37, 0.61].map(f => f * p)) expect(at(t + p)[prop]).toBeCloseTo(at(t)[prop], 1);
      // Starts at rest and leaves the other properties alone.
      expect(s[0][prop]).toBeCloseTo(BASE[prop], 9);
      const others = ['x', 'y', 'rot', 'opacity'].filter(k => k !== prop && !(type === 'pulse' && k === 'sy'));
      unchanged(s, others);
      if (type === 'pulse') for (const q of s) expect(q.sy).toBeCloseTo(q.sx, 9);   // uniform
      // The stored pose is never changed by the motion.
      for (const q of s) expect(q.base).toEqual(BASE);
    }
  });
}

test('spin: turns 360° × amount × speed per second, and nothing else', async ({ app }) => {
  const s = await sample(app, { type: 'spin', amt: 0.5, speed: 2 }, { seconds: 1.5, step: 0.25 });
  for (const p of s) expect(p.rot).toBeCloseTo(360 * 2 * 0.5 * p.t, 6);
  unchanged(s, ['x', 'y', 'sx', 'opacity']);
});

test('shake: jitters x, y and rotation within bounds, 12 × speed times a second, repeatably', async ({ app }) => {
  const speed = 1.5, amt = 2;
  const s = await sample(app, { type: 'shake', amt, speed }, { seconds: 2, step: 1 / 600 });
  const [x0, x1] = range(s, p => p.x - BASE.x), [y0, y1] = range(s, p => p.y - BASE.y), [r0, r1] = range(s, p => p.rot);
  expect(Math.max(-x0, x1)).toBeLessThanOrEqual(7 * amt);
  expect(Math.max(-y0, y1)).toBeLessThanOrEqual(7 * amt);
  expect(Math.max(-r0, r1)).toBeLessThanOrEqual(2.5 * amt);
  expect(x1 - x0).toBeGreaterThan(7 * amt);            // it really moves
  // The pose changes in steps, 12 × speed times per second.
  let changes = 0;
  for (let i = 1; i < s.length; i++) if (s[i].x !== s[i - 1].x) changes++;
  expect(changes).toBe(2 * 12 * speed);
  // Same time, same jitter (so playback and export agree).
  const again = await sample(app, { type: 'shake', amt, speed }, { seconds: 2, step: 1 / 600 });
  expect(again.map(p => p.x)).toEqual(s.map(p => p.x));
});

// Easings between two keyframes x: 0 -> 100 over 0..2 s.
const KEYS = [{ t: 0, x: 0 }, { t: 2, x: 100 }];
const xAt = (page, ease, ts, keys = KEYS) => page.evaluate(({ ease, ts, keys }) => {
  const A = CM.app, l = A.newShape('rect');
  l.ease = ease;
  for (const k of keys) Object.assign(A.addKey(l, k.t), k);
  return ts.map(t => A.evalBase(l, t).x);
}, { ease, ts, keys });

test('easing "Steady" (linear) moves at a constant rate', async ({ app }) => {
  expect(await xAt(app, 'linear', [0, 0.5, 1, 1.5, 2])).toEqual([0, 25, 50, 75, 100]);
});

test('easing "Smooth" starts and ends slowly, symmetric about the middle', async ({ app }) => {
  const [a, b, c, d, e] = await xAt(app, 'ease', [0, 0.5, 1, 1.5, 2]);
  expect([a, c, e]).toEqual([0, 50, 100]);
  expect(b).toBeCloseTo(15.625, 9);                    // smoothstep(0.25)
  expect(b + d).toBeCloseTo(100, 9);
  const fine = await xAt(app, 'ease', [0, 0.02, 1, 1.02]);
  expect(fine[1] - fine[0]).toBeLessThan(fine[3] - fine[2]);   // slower at the start than in the middle
});

test('easing "Jump" holds each pose until the next keyframe', async ({ app }) => {
  expect(await xAt(app, 'hold', [0, 0.5, 1.9, 2, 3])).toEqual([0, 0, 0, 100, 100]);
});

test('easing "Overshoot" goes past the target and settles on it', async ({ app }) => {
  const ts = Array.from({ length: 201 }, (_, i) => i / 100);
  const xs = await xAt(app, 'overshoot', ts);
  expect(xs[0]).toBe(0);
  expect(xs.at(-1)).toBeCloseTo(100, 9);
  expect(Math.max(...xs)).toBeGreaterThan(105);
  expect(Math.max(...xs)).toBeLessThan(115);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);    // overshoots at the end only
});

// B10: at exactly a middle keyframe's time, "Jump" showed the previous keyframe's pose,
// so moving the piece while parked on that keyframe looked like it did nothing.
test('every easing shows each keyframe\'s own pose at that keyframe\'s time', async ({ app }) => {
  const keys = [{ t: 0, x: 0 }, { t: 1, x: 40 }, { t: 2, x: 100 }, { t: 3, x: 10 }];
  for (const ease of ['linear', 'ease', 'hold', 'overshoot']) {
    expect(await xAt(app, ease, keys.map(k => k.t), keys), ease).toEqual(keys.map(k => k.x));
  }
});

test('before the first and after the last keyframe, the pose holds', async ({ app }) => {
  const keys = [{ t: 1, x: 40 }, { t: 2, x: 100 }];
  expect(await xAt(app, 'linear', [0, 0.5, 2.5, 6], keys)).toEqual([40, 40, 100, 100]);
});
