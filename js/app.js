// Collage board: layers, tools, properties, animation timeline, library panel, save/export.
(() => {
'use strict';
const CM = window.CM, h = CM.h, clamp = CM.clamp;
const $ = id => document.getElementById(id);
const RAD = Math.PI / 180;

const doc = { w: 1280, h: 720, duration: 6, fps: 12, loop: true, layers: [] };
let sel = null, tool = 'select', time = 0, playing = false, recording = null;
let viewScale = 1, drag = null, draft = null, nextId = 1;
const toolOpts = { shape: 'rect', fill: '#d8402f', stroke: '#1d1812', shapeStroke: 0, lineStroke: 5 };

const cv = $('board'), ctx = cv.getContext('2d');
const hitCtx = CM.canvas(1, 1).getContext('2d');

const SHAPES = { rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', star: 'Star', burst: 'Burst', heart: 'Heart' };
const BLENDS = { 'source-over': 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', difference: 'Difference' };
const EASES = { ease: 'Smooth', linear: 'Steady', hold: 'Jump (no in-between)', overshoot: 'Overshoot' };
const MOTIONS = { none: 'None', wobble: 'Wobble', bob: 'Bob up & down', sway: 'Slide side to side', hop: 'Hop', chomp: 'Chomp (jaw flap)', pulse: 'Pulse', shake: 'Shake', spin: 'Spin' };

// ---------- layers ----------
const byId = id => doc.layers.find(l => l.id === id);
const selLayer = () => byId(sel);
function baseLayer(type, name) {
  return {
    id: 'L' + nextId++, type, name, visible: true, blend: 'source-over',
    x: doc.w / 2, y: doc.h / 2, sx: 1, sy: 1, rot: 0, opacity: 1,
    keys: [], ease: 'ease', motion: { type: 'none', amt: 1, speed: 1 },
  };
}
const countOf = type => doc.layers.filter(l => l.type === type).length + 1;
function newFill(color) {
  return { ...baseLayer('fill', 'Color ' + countOf('fill')), fill: CM.defaultFill(color) };
}
function newShape(shape) {
  return {
    ...baseLayer('shape', (SHAPES[shape] || 'Line') + ' ' + countOf('shape')), shape, w: 100, h: 100, pts: null,
    closed: true, smooth: false, fill: CM.defaultFill(toolOpts.fill), stroke: { color: toolOpts.stroke, width: 0 },
  };
}
const cloneLayer = l => ({
  ...l, fill: l.fill && { ...l.fill }, stroke: l.stroke && { ...l.stroke },
  pts: l.pts && l.pts.map(p => [p[0], p[1]]), keys: l.keys.map(k => ({ ...k })), motion: { ...l.motion },
});
function addLayer(l) { doc.layers.push(l); sel = l.id; commit(); refresh(); }

// ---------- undo history (art bitmaps are immutable, so snapshots are cheap) ----------
let hist = [], hi = -1;
function commit() {
  hist.length = hi + 1;
  hist.push({ w: doc.w, h: doc.h, duration: doc.duration, fps: doc.fps, loop: doc.loop, sel, layers: doc.layers.map(cloneLayer) });
  if (hist.length > 80) hist.shift();
  hi = hist.length - 1;
  syncButtons();
}
function restore(s) {
  Object.assign(doc, { w: s.w, h: s.h, duration: s.duration, fps: s.fps, loop: s.loop });
  doc.layers = s.layers.map(cloneLayer);
  sel = byId(s.sel) ? s.sel : null;
  draft = drag = null;
  syncDocControls(); fitBoard(); refresh();
}
const undo = () => { if (hi > 0) restore(hist[--hi]); syncButtons(); };
const redo = () => { if (hi < hist.length - 1) restore(hist[++hi]); syncButtons(); };

// ---------- animation ----------
const PROPS = ['x', 'y', 'sx', 'sy', 'rot', 'opacity'];
const EASE = {
  linear: u => u, ease: u => u * u * (3 - 2 * u), hold: () => 0,
  overshoot: u => { const s = 1.70158; u -= 1; return u * u * ((s + 1) * u + s) + 1; },
};
const pick = o => ({ x: o.x, y: o.y, sx: o.sx, sy: o.sy, rot: o.rot, opacity: o.opacity });
const snapT = t => Math.round(t * doc.fps) / doc.fps;
const frac = n => n - Math.floor(n);
const rand = n => frac(Math.sin(n * 12.9898) * 43758.5453);

// Position of a layer from its keyframes only.
function evalBase(l, t) {
  const k = l.keys;
  if (!k.length) return pick(l);
  if (t <= k[0].t) return pick(k[0]);
  if (t >= k[k.length - 1].t) return pick(k[k.length - 1]);
  let i = 1;
  while (k[i].t < t) i++;
  const a = k[i - 1], b = k[i], e = EASE[l.ease]((t - a.t) / (b.t - a.t)), p = {};
  for (const n of PROPS) p[n] = a[n] + (b[n] - a[n]) * e;
  return p;
}
// Keyframes plus the looping motion preset.
function evalLayer(l, t) {
  const p = evalBase(l, t), m = l.motion;
  if (m.type === 'none') return p;
  const s = Math.sin(Math.PI * 2 * m.speed * t), a = m.amt;
  switch (m.type) {
    case 'wobble': p.rot += 8 * a * s; break;
    case 'bob': p.y += 18 * a * s; break;
    case 'sway': p.x += 30 * a * s; break;
    case 'hop': p.y -= 50 * a * Math.abs(Math.sin(Math.PI * m.speed * t)); break;
    case 'chomp': p.y += 26 * a * Math.abs(Math.sin(Math.PI * 2 * m.speed * t)); break;
    case 'pulse': p.sx *= 1 + 0.08 * a * s; p.sy *= 1 + 0.08 * a * s; break;
    case 'shake': { const f = Math.floor(t * 12 * m.speed); p.x += (rand(f) - 0.5) * 14 * a; p.y += (rand(f + 99) - 0.5) * 14 * a; p.rot += (rand(f + 7) - 0.5) * 5 * a; break; }
    case 'spin': p.rot += 360 * m.speed * t * a; break;
  }
  return p;
}
const keyAt = (l, t) => l.keys.find(k => Math.abs(k.t - t) < 0.5 / doc.fps);
function addKey(l, t) {
  let k = keyAt(l, t);
  if (!k) {
    k = { t, ...evalBase(l, t) };
    l.keys.push(k);
    l.keys.sort((a, b) => a.t - b.t);
  }
  return k;
}
// Edits go to the keyframe at the playhead once a layer is animated, otherwise to the layer itself.
function write(l, vals) {
  if (!l.keys.length) return Object.assign(l, vals);
  const had = keyAt(l, time);
  Object.assign(addKey(l, time), vals);
  if (!had) renderTimeline();
}
function removeKey(l, k) {
  l.keys.splice(l.keys.indexOf(k), 1);
  if (!l.keys.length) Object.assign(l, pick(k));
}

// ---------- geometry & drawing ----------
const r2 = v => Math.round(v * 100) / 100;
function polyD(n, inner, w, hh) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : 1, a = -Math.PI / 2 + i * Math.PI / n;
    d += `${i ? 'L' : 'M'}${r2(Math.cos(a) * r * w / 2)} ${r2(Math.sin(a) * r * hh / 2)}`;
  }
  return d + 'Z';
}
// SVG path data for a shape, in the layer's own coordinates. Used for drawing and for HTML export.
function shapeD(l) {
  const w = l.w, hh = l.h, x = -w / 2, y = -hh / 2;
  const P = pts => pts.map(r2).join(' ');
  switch (l.shape) {
    case 'rect': return `M${P([x, y])}H${r2(w / 2)}V${r2(hh / 2)}H${r2(x)}Z`;
    case 'ellipse': return `M${P([x, 0])}A${P([w / 2, hh / 2])} 0 1 0 ${P([w / 2, 0])}A${P([w / 2, hh / 2])} 0 1 0 ${P([x, 0])}Z`;
    case 'triangle': return `M${P([0, y])}L${P([w / 2, hh / 2])}L${P([x, hh / 2])}Z`;
    case 'star': return polyD(5, 0.42, w, hh);
    case 'burst': return polyD(14, 0.68, w, hh);
    case 'heart':
      return `M${P([0, hh / 2])}C${P([-w * 0.1, hh * 0.3, -w / 2, hh * 0.05, -w / 2, -hh * 0.2])}`
        + `C${P([-w / 2, -hh * 0.6, -w * 0.02, -hh * 0.6, 0, -hh * 0.22])}`
        + `C${P([w * 0.02, -hh * 0.6, w / 2, -hh * 0.6, w / 2, -hh * 0.2])}`
        + `C${P([w / 2, hh * 0.05, w * 0.1, hh * 0.3, 0, hh / 2])}Z`;
    default: {
      const q = l.pts, n = q.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let d;
      if (l.smooth && n > 2) {
        if (l.closed) {
          d = 'M' + P(mid(q[n - 1], q[0]));
          for (let i = 0; i < n; i++) d += 'Q' + P([...q[i], ...mid(q[i], q[(i + 1) % n])]);
        } else {
          d = 'M' + P(q[0]);
          for (let i = 1; i < n - 1; i++) d += 'Q' + P([...q[i], ...mid(q[i], q[i + 1])]);
          d += 'L' + P(q[n - 1]);
        }
      } else d = q.map((pt, i) => (i ? 'L' : 'M') + P(pt)).join('');
      return l.closed ? d + 'Z' : d;
    }
  }
}
const shapePath = l => new Path2D(shapeD(l));
// Layer's box in its own coordinates (always centred on the layer position).
function localBox(l) {
  const w = l.type === 'art' ? l.art.bounds.w : l.w, hh = l.type === 'art' ? l.art.bounds.h : l.h;
  return { x: -w / 2, y: -hh / 2, w, h: hh };
}
const toDoc = (p, lx, ly) => {
  const c = Math.cos(p.rot * RAD), s = Math.sin(p.rot * RAD), ux = lx * p.sx, uy = ly * p.sy;
  return [p.x + ux * c - uy * s, p.y + ux * s + uy * c];
};
// Offset from the layer centre in un-rotated (but still scaled) space.
const unrot = (p, pt) => {
  const c = Math.cos(p.rot * RAD), s = Math.sin(p.rot * RAD), dx = pt[0] - p.x, dy = pt[1] - p.y;
  return [dx * c + dy * s, -dx * s + dy * c];
};

function drawLayer(c, l, t) {
  if (!l.visible) return;
  const p = evalLayer(l, t);
  if (p.opacity <= 0) return;
  c.save();
  c.globalAlpha = clamp(p.opacity, 0, 1);
  c.globalCompositeOperation = l.blend;
  if (l.type === 'fill') {
    c.fillStyle = CM.fillStyle(c, l.fill, { x: 0, y: 0, w: doc.w, h: doc.h });
    c.fillRect(0, 0, doc.w, doc.h);
  } else {
    c.translate(p.x, p.y); c.rotate(p.rot * RAD); c.scale(p.sx, p.sy);
    if (l.type === 'art') {
      const b = l.art.bounds;
      c.drawImage(l.art.out, b.x, b.y, b.w, b.h, -b.w / 2, -b.h / 2, b.w, b.h);
    } else {
      const path = shapePath(l);
      if (l.closed && l.fill.type !== 'none') { c.fillStyle = CM.fillStyle(c, l.fill, localBox(l)); c.fill(path); }
      if (l.stroke.width > 0) {
        c.strokeStyle = l.stroke.color; c.lineWidth = l.stroke.width; c.lineJoin = c.lineCap = 'round';
        c.stroke(path);
      }
    }
  }
  c.restore();
}
function paint(c, t) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, doc.w, doc.h);
  for (const l of doc.layers) drawLayer(c, l, t);
}

function hitLayer(l, pt) {
  if (!l.visible || l.type === 'fill') return false;
  const p = evalLayer(l, time);
  if (!p.sx || !p.sy) return false;
  const [ux, uy] = unrot(p, pt), lx = ux / p.sx, ly = uy / p.sy, b = localBox(l);
  if (l.type === 'art') {
    if (lx < b.x || ly < b.y || lx >= b.x + b.w || ly >= b.y + b.h) return false;
    const a = l.art.bounds;
    return l.art.out.getContext('2d').getImageData(Math.floor(lx - b.x + a.x), Math.floor(ly - b.y + a.y), 1, 1).data[3] > 12;
  }
  const path = shapePath(l);
  hitCtx.lineWidth = Math.max(l.stroke.width, 14 / viewScale / Math.abs(p.sx));
  return (l.closed && hitCtx.isPointInPath(path, lx, ly)) || hitCtx.isPointInStroke(path, lx, ly);
}

function handles(l) {
  const p = evalLayer(l, time), b = localBox(l);
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => toDoc(p, x, y));
  const top = toDoc(p, 0, b.y);
  let dx = top[0] - p.x, dy = top[1] - p.y;
  const len = Math.hypot(dx, dy) || 1;
  if (len === 1 && !dx && !dy) dy = -1;
  const rot = [top[0] + dx / len * 28 / viewScale, top[1] + dy / len * 28 / viewScale];
  return { p, corners, top, rot };
}

function drawOverlay() {
  const u = 1 / viewScale; // one screen pixel in canvas units
  const l = selLayer();
  ctx.save();
  ctx.lineJoin = 'round';
  if (l && l.type !== 'fill' && l.visible && tool === 'select') {
    const hd = handles(l);
    ctx.beginPath();
    hd.corners.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y));
    ctx.closePath();
    ctx.moveTo(...hd.top); ctx.lineTo(...hd.rot);
    ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
    ctx.lineWidth = 1.5 * u; ctx.strokeStyle = '#c63d2f'; ctx.setLineDash([6 * u, 4 * u]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1d1812'; ctx.lineWidth = 1.5 * u;
    for (const [x, y] of hd.corners) { ctx.beginPath(); ctx.rect(x - 5 * u, y - 5 * u, 10 * u, 10 * u); ctx.fill(); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(hd.rot[0], hd.rot[1], 6 * u, 0, 7); ctx.fillStyle = '#d9a520'; ctx.fill(); ctx.stroke();
  }
  if (draft && draft.pts) {
    const pts = draft.pts;
    ctx.beginPath();
    pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y));
    if (draft.cursor && !draft.down) ctx.lineTo(...draft.cursor);
    ctx.lineWidth = Math.max(toolOpts.lineStroke, 2 * u); ctx.strokeStyle = toolOpts.stroke; ctx.lineCap = 'round'; ctx.stroke();
    ctx.lineWidth = 1 * u; ctx.strokeStyle = '#fff'; ctx.setLineDash([4 * u, 4 * u]); ctx.stroke(); ctx.setLineDash([]);
    const near = draft.cursor && pts.length >= 3 && Math.hypot(draft.cursor[0] - pts[0][0], draft.cursor[1] - pts[0][1]) < 12 * u;
    ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], (near ? 9 : 6) * u, 0, 7);
    ctx.fillStyle = near ? '#c63d2f' : '#fff'; ctx.strokeStyle = '#1d1812'; ctx.lineWidth = 1.5 * u; ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

let renderQueued = false;
function draw() {
  renderQueued = false;
  paint(ctx, playing ? Math.floor(time * doc.fps + 1e-6) / doc.fps : time);
  if (!playing && !recording) drawOverlay();
  $('tlHead').style.left = `calc(140px + (100% - 160px) * ${time / doc.duration})`;
  $('timeOut').textContent = `${time.toFixed(2)}s / ${doc.duration}s`;
}
function requestRender() { if (!renderQueued && !playing) { renderQueued = true; requestAnimationFrame(draw); } }
function fitBoard() {
  const st = $('stage'), s = Math.min((st.clientWidth - 40) / doc.w, (st.clientHeight - 40) / doc.h);
  if (cv.width !== doc.w || cv.height !== doc.h) { cv.width = doc.w; cv.height = doc.h; }
  cv.style.width = doc.w * s + 'px'; cv.style.height = doc.h * s + 'px';
  viewScale = s;
  requestRender();
}
function refresh() { renderLayers(); renderProps(); renderTimeline(); renderOpts(); requestRender(); }
function select(id) { if (sel !== id) { sel = id; refresh(); } }

// ---------- playback ----------
let lastTick = 0;
function setTime(t) { time = clamp(snapT(t), 0, doc.duration); syncProps(); requestRender(); }
function play() {
  if (playing) return;
  if (time >= doc.duration - 1e-6) time = 0;
  playing = true; $('playBtn').textContent = '⏸';
  lastTick = performance.now();
  requestAnimationFrame(tick);
}
function pause() {
  if (!playing) return;
  playing = false; $('playBtn').textContent = '▶';
  setTime(time);
}
function tick(now) {
  if (!playing) return;
  time += (now - lastTick) / 1000; lastTick = now;
  if (time >= doc.duration) {
    if (recording) { time = doc.duration; draw(); return finishRecording(); }
    if (doc.loop) time %= doc.duration; else { time = doc.duration; return pause(); }
  }
  draw();
  requestAnimationFrame(tick);
}

// ---------- board pointer tools ----------
const evPt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * doc.w / r.width, (e.clientY - r.top) * doc.h / r.height]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const topHit = pt => { for (let i = doc.layers.length - 1; i >= 0; i--) if (hitLayer(doc.layers[i], pt)) return doc.layers[i]; return null; };

cv.addEventListener('pointerdown', e => {
  if (e.button !== 0 || recording) return;
  pause();
  cv.setPointerCapture(e.pointerId);
  const pt = evPt(e);
  if (tool === 'select') {
    const cur = selLayer();
    if (cur && cur.type !== 'fill' && cur.visible) {
      const hd = handles(cur), r = 10 / viewScale, p0 = evalBase(cur, time);
      if (dist(pt, hd.rot) < r) { drag = { mode: 'rot', id: cur.id, p0, a0: Math.atan2(pt[1] - hd.p.y, pt[0] - hd.p.x), c: hd.p }; return; }
      if (hd.corners.some(c => dist(pt, c) < r)) { drag = { mode: 'scale', id: cur.id, p0, u0: unrot(hd.p, pt), c: hd.p }; return; }
    }
    const l = topHit(pt);
    select(l ? l.id : null);
    if (l) drag = { mode: 'move', id: l.id, p0: evalBase(l, time), start: pt };
  } else if (tool === 'shape') {
    const l = newShape(toolOpts.shape);
    l.stroke.width = toolOpts.shapeStroke; l.w = l.h = 1; l.x = pt[0]; l.y = pt[1];
    doc.layers.push(l); sel = l.id;
    drag = { mode: 'shape', id: l.id, start: pt };
  } else if (tool === 'line') {
    if (!draft) draft = { pts: [pt] };
    else if (draft.pts.length >= 3 && dist(pt, draft.pts[0]) < 12 / viewScale) return finishLine(true);
    else draft.pts.push(pt);
    draft.down = true; draft.cursor = pt;
    renderOpts();
  }
  requestRender();
});
cv.addEventListener('pointermove', e => {
  const pt = evPt(e);
  if (draft) {
    draft.cursor = pt;
    if (draft.down && dist(pt, draft.pts[draft.pts.length - 1]) > 5 / viewScale) { draft.pts.push(pt); draft.free = true; }
    return requestRender();
  }
  if (!drag) return;
  const l = byId(drag.id);
  if (!l) return;
  drag.moved = true;
  if (drag.mode === 'move') write(l, { x: drag.p0.x + pt[0] - drag.start[0], y: drag.p0.y + pt[1] - drag.start[1] });
  else if (drag.mode === 'rot') {
    let rot = drag.p0.rot + (Math.atan2(pt[1] - drag.c.y, pt[0] - drag.c.x) - drag.a0) / RAD;
    if (e.shiftKey) rot = Math.round(rot / 15) * 15;
    write(l, { rot });
  } else if (drag.mode === 'scale') {
    const u = unrot(drag.c, pt), u0 = drag.u0, min = 0.02;
    if (e.shiftKey) {
      const fx = Math.abs(u0[0]) > 1 ? u[0] / u0[0] : 1, fy = Math.abs(u0[1]) > 1 ? u[1] / u0[1] : 1;
      write(l, { sx: drag.p0.sx * (Math.abs(fx) < min ? min : fx), sy: drag.p0.sy * (Math.abs(fy) < min ? min : fy) });
    } else {
      const f = Math.max(min, Math.hypot(u[0], u[1]) / (Math.hypot(u0[0], u0[1]) || 1));
      write(l, { sx: drag.p0.sx * f, sy: drag.p0.sy * f });
    }
  } else if (drag.mode === 'shape') {
    let w = Math.abs(pt[0] - drag.start[0]), hh = Math.abs(pt[1] - drag.start[1]);
    if (e.shiftKey) w = hh = Math.max(w, hh);
    l.w = Math.max(1, w); l.h = Math.max(1, hh);
    l.x = drag.start[0] + Math.sign(pt[0] - drag.start[0] || 1) * w / 2;
    l.y = drag.start[1] + Math.sign(pt[1] - drag.start[1] || 1) * hh / 2;
  }
  syncProps(); requestRender();
});
const endDrag = () => {
  if (draft) {
    draft.down = false;
    if (draft.free) finishLine(draft.pts.length > 8 && dist(draft.pts[0], draft.pts[draft.pts.length - 1]) < 24 / viewScale);
    return;
  }
  if (!drag) return;
  const d = drag, l = byId(d.id);
  drag = null;
  if (d.mode === 'shape') {
    if (l.w < 6 && l.h < 6) l.w = l.h = 160;
    setTool('select'); commit(); refresh();
  } else if (d.moved) { commit(); renderLayers(); }
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('dblclick', e => {
  if (tool === 'line' && draft) return finishLine(false);
  if (tool === 'select') { const l = topHit(evPt(e)); if (l && l.type === 'art') editLayerArt(l.id); }
});

function finishLine(closed) {
  const d = draft;
  draft = null;
  if (!d) return;
  const pts = d.pts.filter((p, i) => !i || dist(p, d.pts[i - 1]) > 2);
  if (closed && pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 24 / viewScale) pts.pop();
  if (pts.length < 2) { renderOpts(); return requestRender(); }
  if (pts.length < 3) closed = false;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const l = newShape('path');
  l.name = (closed ? 'Cut shape ' : 'Line ') + countOf('shape');
  l.x = (x0 + x1) / 2; l.y = (y0 + y1) / 2; l.w = Math.max(1, x1 - x0); l.h = Math.max(1, y1 - y0);
  l.pts = pts.map(p => [p[0] - l.x, p[1] - l.y]);
  l.closed = closed; l.smooth = !!d.free;
  l.stroke.width = toolOpts.lineStroke;
  setTool('select');
  addLayer(l);
}

// ---------- tool options bar ----------
function setTool(t) {
  if (tool === 'line' && t !== 'line') draft = null;
  tool = t;
  for (const b of $('tools').children) b.classList.toggle('on', b.dataset.tool === t);
  cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
  renderOpts(); requestRender();
}
function colorInput(value, oninput, onchange) {
  const c = h('input', { type: 'color', value, oninput: () => oninput(c.value), onchange: () => onchange && onchange(c.value) });
  return c;
}
function renderOpts() {
  const bar = $('optsbar');
  if (tool === 'select') {
    bar.replaceChildren(h('span', { class: 'hint' }, 'Click a piece to select it. Drag to move · corner squares resize (hold Shift to stretch) · yellow knob rotates · double-click art to edit or cut it out.'));
  } else if (tool === 'shape') {
    bar.replaceChildren(
      h('div', { class: 'group' }, Object.entries(SHAPES).map(([k, name]) =>
        h('button', { class: toolOpts.shape === k ? 'on' : '', onclick: () => { toolOpts.shape = k; renderOpts(); } }, name))),
      h('label', {}, 'Fill', colorInput(toolOpts.fill, v => { toolOpts.fill = v; })),
      h('label', {}, 'Outline', colorInput(toolOpts.stroke, v => { toolOpts.stroke = v; }),
        h('input', { type: 'number', min: 0, max: 60, value: toolOpts.shapeStroke, title: 'Outline thickness', oninput: e => { toolOpts.shapeStroke = clamp(+e.target.value || 0, 0, 60); } })),
      h('span', { class: 'hint' }, 'Drag on the canvas to draw the shape (Shift keeps it even). Each shape becomes a new layer.'));
  } else {
    bar.replaceChildren(
      h('label', {}, 'Line', colorInput(toolOpts.stroke, v => { toolOpts.stroke = v; requestRender(); }),
        h('input', { type: 'number', min: 0, max: 60, value: toolOpts.lineStroke, title: 'Line thickness', oninput: e => { toolOpts.lineStroke = clamp(+e.target.value || 0, 0, 60); requestRender(); } })),
      h('label', {}, 'Fill when closed', colorInput(toolOpts.fill, v => { toolOpts.fill = v; })),
      draft ? h('div', { class: 'group' },
        h('button', { onclick: () => finishLine(false) }, 'Finish line (Enter)'),
        h('button', { class: 'primary', disabled: draft.pts.length < 3, onclick: () => finishLine(true) }, 'Close into shape'),
        h('button', { onclick: () => { draft = null; renderOpts(); requestRender(); } }, 'Cancel (Esc)')) : null,
      h('span', { class: 'hint' }, draft ? 'Keep clicking to add corners. Click the first dot to close the outline into a fillable shape.'
        : 'Click to place corners, or drag to draw freehand. End where you started to make a shape you can fill.'));
  }
}

// ---------- layers panel ----------
const ICON = { fill: '▦', shape: '◆', art: '✂' };
let dragLayerId = null;
function renderLayers() {
  const list = $('layerList');
  list.replaceChildren(...[...doc.layers].reverse().map(l => {
    const row = h('div', {
      class: 'layer-row' + (l.id === sel ? ' sel' : ''), draggable: true,
      onclick: () => select(l.id),
      ondragstart: e => { dragLayerId = l.id; e.dataTransfer.effectAllowed = 'move'; },
      ondragover: e => { if (dragLayerId) { e.preventDefault(); row.classList.add('drop'); } },
      ondragleave: () => row.classList.remove('drop'),
      ondrop: e => {
        e.preventDefault(); row.classList.remove('drop');
        const moving = byId(dragLayerId);
        dragLayerId = null;
        if (!moving || moving === l) return;
        doc.layers.splice(doc.layers.indexOf(moving), 1);
        doc.layers.splice(doc.layers.indexOf(l) + 1, 0, moving); // lands just above the row it was dropped on
        commit(); refresh();
      },
    },
      h('button', { class: 'eye' + (l.visible ? '' : ' off'), title: 'Show / hide', onclick: e => { e.stopPropagation(); l.visible = !l.visible; commit(); refresh(); } }, l.visible ? '👁' : '–'),
      h('span', { class: 'icon' }, ICON[l.type]),
      h('span', { class: 'name' }, l.name),
      l.keys.length || l.motion.type !== 'none' ? h('span', { class: 'keyed', title: 'Animated' }, '◆') : null);
    return row;
  }));
}
function moveLayer(dir) {
  const l = selLayer();
  if (!l) return;
  const i = doc.layers.indexOf(l), j = i + dir;
  if (j < 0 || j >= doc.layers.length) return;
  doc.layers.splice(i, 1); doc.layers.splice(j, 0, l);
  commit(); refresh();
}
function deleteLayer() {
  const l = selLayer();
  if (!l) return;
  doc.layers.splice(doc.layers.indexOf(l), 1);
  sel = null; commit(); refresh();
}
function duplicateLayer() {
  const l = selLayer();
  if (!l) return;
  const c = cloneLayer(l);
  c.id = 'L' + nextId++; c.name = l.name + ' copy';
  if (l.type !== 'fill') for (const o of [c, ...c.keys]) { o.x += 24; o.y += 24; }
  doc.layers.splice(doc.layers.indexOf(l) + 1, 0, c);
  sel = c.id; commit(); refresh();
}

// ---------- properties panel ----------
let propSync = [];
function syncProps() { for (const f of propSync) f(); }
function numField(get, set, step = 1) {
  const inp = h('input', {
    type: 'number', step,
    oninput: () => { if (inp.value !== '' && isFinite(+inp.value)) { set(+inp.value); requestRender(); } },
    onchange: () => { commit(); renderLayers(); },
  });
  propSync.push(() => { if (document.activeElement !== inp) inp.value = Math.round(get() * 100) / 100; });
  return inp;
}
function fillRows(l, allowNone) {
  const f = l.fill, live = () => requestRender();
  const types = { color: 'Solid color', gradient: 'Gradient', pattern: 'Pattern', texture: 'Texture' };
  if (allowNone) types.none = 'No fill';
  const rows = [CM.select('Fill', types, f.type, v => { f.type = v; commit(); renderProps(); requestRender(); })];
  if (f.type === 'none') return rows;
  rows.push(h('div', { class: 'row' }, f.type === 'color' ? 'Color' : 'Colors', h('span', { class: 'pair' },
    colorInput(f.color, v => { f.color = v; live(); }, commit),
    f.type !== 'color' ? colorInput(f.color2, v => { f.color2 = v; live(); }, commit) : null)));
  if (f.type === 'gradient') {
    rows.push(CM.select('Style', { linear: 'Straight', radial: 'Round' }, f.gradType, v => { f.gradType = v; commit(); renderProps(); requestRender(); }));
    if (f.gradType === 'linear') rows.push(CM.slider('Angle', 0, 360, 1, f.angle, v => { f.angle = v; live(); }, commit, v => v + '°'));
  }
  if (f.type === 'pattern') rows.push(CM.select('Pattern', CM.PATTERNS, f.pattern, v => { f.pattern = v; commit(); requestRender(); }));
  if (f.type === 'texture') rows.push(CM.select('Texture', CM.TEXTURES, f.texture, v => { f.texture = v; commit(); requestRender(); }));
  if (f.type === 'pattern' || f.type === 'texture') rows.push(CM.slider('Size', 0.25, 5, 0.05, f.scale, v => { f.scale = v; live(); }, commit, v => v.toFixed(2) + '×'));
  return rows;
}
function renderProps() {
  const box = $('props'), l = selLayer();
  propSync = [];
  if (!l) {
    box.replaceChildren(h('p', { class: 'hint' }, 'Nothing selected. Pick a layer, add art from the library, or draw with the Shape and Line tools.'));
    return;
  }
  const live = () => requestRender();
  const sect = t => h('div', { class: 'sect' }, t);
  const out = [];
  const name = h('input', { type: 'text', value: l.name, oninput: () => { l.name = name.value; }, onchange: () => { commit(); renderLayers(); renderTimeline(); } });
  out.push(h('label', { class: 'row' }, 'Name', name));

  const op = CM.slider('Opacity', 0, 100, 1, 100, v => { write(l, { opacity: v / 100 }); live(); }, commit, v => v + '%');
  propSync.push(() => { const v = Math.round(evalBase(l, time).opacity * 100), inp = op.querySelector('input'); if (document.activeElement !== inp) { inp.value = v; op.querySelector('output').textContent = v + '%'; } });
  out.push(op, CM.select('Blend', BLENDS, l.blend, v => { l.blend = v; commit(); live(); }));

  if (l.type === 'art') {
    out.push(sect('Art'), h('div', { class: 'btnrow' },
      h('button', { class: 'primary', onclick: () => editLayerArt(l.id) }, '✂ Edit / cut out'),
      h('button', { onclick: () => { for (const o of [l, ...l.keys]) o.sx = -o.sx; commit(); live(); } }, 'Flip')));
  }
  if (l.type === 'fill') out.push(sect('Fill'), fillRows(l, false));
  if (l.type === 'shape') {
    if (l.closed) out.push(sect('Fill'), fillRows(l, true));
    out.push(sect('Outline'),
      h('div', { class: 'row' }, 'Color', h('span', { class: 'pair' }, colorInput(l.stroke.color, v => { l.stroke.color = v; live(); }, commit))),
      CM.slider('Thickness', 0, 60, 1, l.stroke.width, v => { l.stroke.width = v; live(); }, commit));
    if (l.shape === 'path') {
      const mk = (label, key) => { const c = h('input', { type: 'checkbox', checked: l[key], onchange: () => { l[key] = c.checked; commit(); renderProps(); live(); } }); return h('label', {}, c, label); };
      out.push(h('div', { class: 'btnrow' }, l.pts.length > 2 ? mk('Closed shape', 'closed') : null, mk('Smooth curves', 'smooth')));
    }
  }
  if (l.type !== 'fill') {
    const cur = () => evalBase(l, time);
    out.push(sect('Position'),
      h('div', { class: 'row' }, 'X / Y', h('span', { class: 'pair' }, numField(() => cur().x, v => write(l, { x: v })), numField(() => cur().y, v => write(l, { y: v })))),
      h('div', { class: 'row' }, 'Size %', h('span', { class: 'pair' },
        numField(() => Math.abs(cur().sx) * 100, v => write(l, { sx: Math.max(1, v) / 100 * (cur().sx < 0 ? -1 : 1) })),
        numField(() => Math.abs(cur().sy) * 100, v => write(l, { sy: Math.max(1, v) / 100 * (cur().sy < 0 ? -1 : 1) })))),
      h('div', { class: 'row' }, 'Rotate °', h('span', { class: 'pair' }, numField(() => cur().rot, v => write(l, { rot: v })))));
  }

  out.push(sect('Animation'));
  out.push(h('p', { class: 'hint' }, l.keys.length
    ? `${l.keys.length} keyframe${l.keys.length > 1 ? 's' : ''}. Move the playhead, then move the piece — a new keyframe is made for you.`
    : 'Add a keyframe, move the playhead to another time, then move the piece. It will travel between the two.'));
  out.push(h('div', { class: 'btnrow' },
    h('button', { onclick: addKeyHere }, '◆ Add keyframe'),
    l.keys.length ? h('button', { onclick: () => { Object.assign(l, evalBase(l, time)); l.keys = []; commit(); refresh(); } }, 'Clear all') : null));
  if (l.keys.length > 1) out.push(CM.select('Movement', EASES, l.ease, v => { l.ease = v; commit(); live(); }));
  out.push(CM.select('Looping motion', l.type === 'fill' ? { none: 'None' } : MOTIONS, l.motion.type, v => { l.motion.type = v; commit(); refresh(); }));
  if (l.motion.type !== 'none') {
    out.push(
      CM.slider('Amount', 0.1, 5, 0.1, l.motion.amt, v => { l.motion.amt = v; live(); }, commit, v => v.toFixed(1)),
      CM.slider('Speed', 0.1, 6, 0.1, l.motion.speed, v => { l.motion.speed = v; live(); }, commit, v => v.toFixed(1)),
      h('p', { class: 'hint' }, 'Press play to see it move.'));
  }
  box.replaceChildren(...out.flat());
  syncProps();
}

function addKeyHere() {
  const l = selLayer();
  if (!l) return CM.toast('Select a layer first.');
  pause(); addKey(l, time); commit(); refresh();
}
function delKeyHere() {
  const l = selLayer(), k = l && keyAt(l, time);
  if (!k) return CM.toast('No keyframe for this layer at the playhead.');
  removeKey(l, k); commit(); refresh();
}

// ---------- timeline ----------
function renderTimeline() {
  const box = $('tlTracks'), head = $('tlHead') || h('div', { id: 'tlHead' });
  const ticks = [];
  const step = doc.duration > 30 ? 5 : doc.duration > 12 ? 2 : 1;
  for (let s = 0; s <= doc.duration; s += step) ticks.push(h('div', { class: 'tl-tick', style: `left:${s / doc.duration * 100}%` }, s + 's'));
  const rows = [h('div', { class: 'tl-row tl-ruler' }, h('div', { class: 'tl-label' }, ''), h('div', { class: 'tl-track' }, ticks))];
  for (const l of [...doc.layers].reverse()) {
    rows.push(h('div', { class: 'tl-row' + (l.id === sel ? ' sel' : '') },
      h('div', { class: 'tl-label', onclick: () => select(l.id) }, l.name),
      h('div', { class: 'tl-track', 'data-layer': l.id }, l.keys.map((k, i) =>
        h('div', { class: 'tl-key', 'data-layer': l.id, 'data-i': i, style: `left:${k.t / doc.duration * 100}%`, title: 'Drag to retime · double-click to delete' })))));
  }
  box.replaceChildren(...rows, head);
  head.style.height = box.scrollHeight + 'px';
}
let tlDrag = null, lastKeyDown = {};
const tlTime = (e, track) => { const r = track.getBoundingClientRect(); return snapT(clamp((e.clientX - r.left) / r.width, 0, 1) * doc.duration); };
$('tlTracks').addEventListener('pointerdown', e => {
  const key = e.target.closest('.tl-key'), track = e.target.closest('.tl-track');
  if (!track) return;
  pause();
  $('tlTracks').setPointerCapture(e.pointerId);
  if (key) {
    const l = byId(key.dataset.layer), i = +key.dataset.i, k = l.keys[i], now = performance.now();
    if (lastKeyDown.key === k && now - lastKeyDown.at < 400) { removeKey(l, k); commit(); refresh(); return; }
    lastKeyDown = { key: k, at: now };
    if (sel !== l.id) { sel = l.id; refresh(); }
    setTime(k.t);
    const el = $('tlTracks').querySelector(`.tl-key[data-layer="${l.id}"][data-i="${i}"]`);
    tlDrag = { key: k, layer: l, el, track: el.parentElement };
  } else {
    if (track.dataset.layer) select(track.dataset.layer);
    tlDrag = { track: document.querySelector('.tl-ruler .tl-track') };
    setTime(tlTime(e, tlDrag.track));
  }
});
$('tlTracks').addEventListener('pointermove', e => {
  if (!tlDrag) return;
  const t = tlTime(e, tlDrag.track);
  if (tlDrag.key) {
    if (t === tlDrag.key.t) return;
    tlDrag.key.t = t; tlDrag.moved = true;
    tlDrag.el.style.left = t / doc.duration * 100 + '%';
  }
  setTime(t);
});
const tlEnd = () => {
  const d = tlDrag;
  tlDrag = null;
  if (!d || !d.moved) return;
  // A keyframe dropped onto another replaces it.
  d.layer.keys = d.layer.keys.filter(k => k === d.key || Math.abs(k.t - d.key.t) > 0.5 / doc.fps).sort((a, b) => a.t - b.t);
  commit(); refresh();
};
$('tlTracks').addEventListener('pointerup', tlEnd);
$('tlTracks').addEventListener('pointercancel', tlEnd);

// ---------- art library ----------
const lib = [];
let libSel = null, libNote = '';
async function itemArt(it) {
  if (!it.art) it.art = CM.artFromImage(await CM.loadImage(it.url));
  return it.art;
}
function renderLibrary() {
  const grid = $('libGrid');
  const tile = it => h('button', {
    class: 'lib-item' + (it.id === libSel ? ' sel' : ''), title: it.name + ' — double-click to add to the board', draggable: true,
'data-id': it.id,
    onclick: () => { libSel = it.id; syncLibSel(); },
    ondblclick: () => addArtToBoard(it),
    ondragstart: e => { e.dataTransfer.setData('text/collage-lib', it.id); e.dataTransfer.effectAllowed = 'copy'; },
  }, h('img', { src: it.thumb || it.url, alt: it.name, loading: 'lazy' }), h('span', {}, it.name));
  const cuts = lib.filter(i => i.kind === 'cutout'), srcs = lib.filter(i => i.kind !== 'cutout');
  grid.replaceChildren(...[
    libNote ? h('p', { class: 'lib-msg' }, libNote) : null,
    cuts.length ? h('h3', {}, 'Your cut-outs') : null,
    cuts.length ? h('div', { class: 'lib-items' }, cuts.map(tile)) : null,
    srcs.length ? h('h3', {}, 'Pictures') : null,
    srcs.length ? h('div', { class: 'lib-items' }, srcs.map(tile)) : null,
  ].filter(Boolean));
  syncLibSel();
}
function syncLibSel() {
  for (const el of $('libGrid').querySelectorAll('.lib-item')) el.classList.toggle('sel', el.dataset.id === libSel);
  $('libAdd').disabled = $('libEdit').disabled = !lib.some(i => i.id === libSel);
}
async function loadLibrary() {
  try {
    const r = await fetch('api/library');
    if (!r.ok) throw new Error(r.status);
    for (const it of await r.json()) lib.push({ id: 'A' + nextId++, ...it });
  } catch {
    libNote = 'Could not read the library folder. Start the app with start.bat (or "node server.js") and open http://localhost:5173.';
  }
  renderLibrary();
}
function placeArt(art, name, pt) {
  const l = { ...baseLayer('art', name), art };
  const b = art.bounds, s = Math.min(1, doc.w * 0.6 / b.w, doc.h * 0.7 / b.h);
  l.sx = l.sy = s;
  if (pt) { l.x = pt[0]; l.y = pt[1]; }
  setTool('select');
  addLayer(l);
}
async function addArtToBoard(it, pt) {
  try { placeArt(CM.cloneArt(await itemArt(it)), it.name, pt); }
  catch (err) { CM.toast(err.message); }
}
async function saveCutout(st, baseName) {
  const name = baseName.replace(/-cut(-\d+)?$/, '') + '-cut';
  const it = { id: 'A' + nextId++, name, kind: 'cutout', art: st, thumb: CM.artCrop(st, 220).toDataURL('image/png') };
  lib.unshift(it); libSel = it.id; renderLibrary();
  CM.toast('Saved to the library as "' + name + '".');
  try {
    const blob = await new Promise(res => CM.artCrop(st).toBlob(res, 'image/png'));
    const r = await fetch('api/library?kind=cutout&name=' + encodeURIComponent(name + '.png'), { method: 'POST', body: blob });
    if (!r.ok) throw new Error(r.status);
    const saved = await r.json();
    it.name = saved.name; it.url = saved.url;
    renderLibrary();
  } catch { CM.toast('Saved for this session only — could not write it to the library folder.'); }
}
async function editLibraryItem(it) {
  try {
    CM.openEditor({
      art: await itemArt(it), title: 'Edit: ' + it.name, applyLabel: 'Add to board',
      onApply: st => placeArt(st, it.name),
      onSave: st => saveCutout(st, it.name),
    });
  } catch (err) { CM.toast(err.message); }
}
function editLayerArt(id) {
  const l = byId(id);
  if (!l || l.type !== 'art') return;
  pause();
  CM.openEditor({
    art: l.art, title: 'Edit: ' + l.name, applyLabel: 'Apply to layer',
    onApply: (st, d) => {
      const L = byId(id);
      if (!L) return;
      L.art = st;
      // The cut-out's centre moved by d (in picture pixels); shift the layer so it stays put on the board.
      for (const o of [L, ...L.keys]) {
        const c = Math.cos(o.rot * RAD), s = Math.sin(o.rot * RAD), dx = d.x * o.sx, dy = d.y * o.sy;
        o.x += dx * c - dy * s; o.y += dx * s + dy * c;
      }
      commit(); refresh();
    },
    onSave: st => saveCutout(st, l.name),
  });
}
async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const it = { id: 'A' + nextId++, name: f.name.replace(/\.[^.]+$/, ''), kind: 'source', url: URL.createObjectURL(f) };
    lib.push(it); libSel = it.id;
    // Also copy it into the library folder so it is there next time.
    fetch('api/library?name=' + encodeURIComponent(f.name), { method: 'POST', body: f }).catch(() => {});
  }
  renderLibrary();
}
$('libAdd').onclick = () => { const it = lib.find(i => i.id === libSel); if (it) addArtToBoard(it); };
$('libEdit').onclick = () => { const it = lib.find(i => i.id === libSel); if (it) editLibraryItem(it); };
$('uploadBtn').onclick = () => $('uploadFile').click();
$('uploadFile').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('libraryPanel').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
$('libraryPanel').addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
cv.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/collage-lib')) e.preventDefault(); });
cv.addEventListener('drop', e => {
  const it = lib.find(i => i.id === e.dataTransfer.getData('text/collage-lib'));
  if (it) { e.preventDefault(); addArtToBoard(it, evPt(e)); }
});

// ---------- save / open / export ----------
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function saveProject() {
  const arts = new Map();
  const layers = doc.layers.map(l => {
    const c = cloneLayer(l);
    if (l.art) { if (!arts.has(l.art)) arts.set(l.art, arts.size); c.art = arts.get(l.art); }
    return c;
  });
  const data = {
    app: 'collage-maker', version: 1,
    doc: { w: doc.w, h: doc.h, duration: doc.duration, fps: doc.fps, loop: doc.loop }, layers,
    arts: [...arts.keys()].map(a => ({ orig: a.orig.toDataURL('image/png'), mask: a.mask.toDataURL('image/png'), fx: a.fx })),
  };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'collage.json');
}
async function openProject(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'collage-maker') throw new Error('That is not a Collage Maker project file.');
    // Check and build everything first, so a damaged file changes nothing.
    const damaged = () => new Error('The project file is damaged.');
    if (!data.doc || !Array.isArray(data.layers) || !Array.isArray(data.arts)) throw damaged();
    const { w, h, duration, fps, loop } = data.doc;
    if (![w, h, duration, fps].every(n => Number.isFinite(n) && n > 0)) throw damaged();
    const toCanvas = async url => {
      try { return CM.copyCanvas(await CM.loadImage(url)); }
      catch { throw new Error('A picture in the project file could not be read.'); }
    };
    const arts = [];
    for (const a of data.arts) arts.push(CM.buildArt({ orig: await toCanvas(a.orig), mask: await toCanvas(a.mask), fx: { ...CM.defaultFx(), ...a.fx } }));
    const layers = data.layers.map(l => {
      if (l.type === 'art' && !arts[l.art]) throw damaged();
      return { ...l, id: 'L' + nextId++, art: l.type === 'art' ? arts[l.art] : undefined };
    });
    Object.assign(doc, { w, h, duration, fps, loop: !!loop });
    doc.layers = layers;
    sel = null; time = 0;
    syncDocControls(); fitBoard(); commit(); refresh();
  } catch (err) { CM.toast('Could not open: ' + err.message); }
}
function exportPNG() {
  pause();
  const c = CM.canvas(doc.w, doc.h);
  paint(c.getContext('2d'), time);
  c.toBlob(b => download(b, 'collage.png'), 'image/png');
}
// ---------- HTML + CSS export ----------
// Writes the collage as it stands at the start of the timeline: one positioned element per layer
// (div for full-canvas fills, img for art, svg for shapes) so it can be animated by hand afterwards.
async function exportHTML() {
  const name = prompt('Name for the exported page.\nA folder with this name is created inside "exports".', 'my-collage');
  if (!name) return;
  pause();
  const tab = window.open('about:blank');
  const files = [], images = new Map(), ids = new Set(), imgNames = new Set();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'layer';
  const unique = (set, base) => {
    if (/^\d/.test(base)) base = 'layer-' + base;
    let id = base;
    for (let i = 2; set.has(id); i++) id = base + '-' + i;
    set.add(id);
    return id;
  };
  const image = (key, base, canvas) => {
    if (!images.has(key)) {
      const path = 'images/' + unique(imgNames, slug(base)) + '.png';
      files.push({ path, base64: canvas().toDataURL('image/png').split(',')[1] });
      images.set(key, path);
    }
    return images.get(key);
  };
  const tile = f => {
    const n = f.type === 'pattern' ? f.pattern : f.texture, c = CM.tile(n, f.color, f.color2);
    return { path: image(`tile|${n}|${f.color}|${f.color2}`, `${n}-${f.color.slice(1)}-${f.color2.slice(1)}`, () => c), size: r2(c.width * f.scale) };
  };

  const html = [], css = [];
  let firstPiece = null;
  for (const l of doc.layers) {
    if (!l.visible) continue;
    const p = evalBase(l, 0), id = unique(ids, slug(l.name)), decl = [];
    const tf = [];
    if (p.rot) tf.push(`rotate(${r2(p.rot)}deg)`);
    if (p.sx !== 1 || p.sy !== 1) tf.push(`scale(${r2(p.sx)}, ${r2(p.sy)})`);
    const place = b => {
      decl.push(`left: ${r2(p.x - b.w / 2)}px`, `top: ${r2(p.y - b.h / 2)}px`, `width: ${r2(b.w)}px`, `height: ${r2(b.h)}px`);
      if (tf.length) decl.push('transform: ' + tf.join(' '));
    };
    if (l.type === 'fill') {
      const f = l.fill;
      let bg = f.color;
      if (f.type === 'gradient') {
        bg = f.gradType === 'radial'
          ? `radial-gradient(circle ${r2(Math.max(doc.w, doc.h) / 2)}px at center, ${f.color}, ${f.color2})`
          : `linear-gradient(${f.angle + 90}deg, ${f.color}, ${f.color2})`;
      } else if (f.type === 'pattern' || f.type === 'texture') {
        const t = tile(f);
        bg = `url("${t.path}") 0 0 / ${t.size}px ${t.size}px repeat`;
      }
      decl.push('left: 0', 'top: 0', 'width: 100%', 'height: 100%', 'background: ' + bg);
      html.push(`  <div class="layer" id="${id}"></div>`);
    } else if (l.type === 'art') {
      firstPiece = firstPiece || id;
      place(l.art.bounds);
      html.push(`  <img class="layer" id="${id}" src="${image(l.art, l.name, () => CM.artCrop(l.art))}" alt="${esc(l.name)}">`);
    } else {
      firstPiece = firstPiece || id;
      const b = localBox(l), f = l.fill;
      place(b);
      let defs = '', fill = 'none';
      if (l.closed && f.type !== 'none') {
        fill = f.color;
        if (f.type === 'gradient') {
          fill = `url(#${id}-fill)`;
          const stops = `<stop offset="0" stop-color="${f.color}"/><stop offset="1" stop-color="${f.color2}"/>`;
          if (f.gradType === 'radial') defs = `<radialGradient id="${id}-fill" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${r2(Math.max(b.w, b.h) / 2)}">${stops}</radialGradient>`;
          else {
            const a = f.angle * RAD, dx = Math.cos(a), dy = Math.sin(a), L = (Math.abs(dx) * b.w + Math.abs(dy) * b.h) / 2;
            defs = `<linearGradient id="${id}-fill" gradientUnits="userSpaceOnUse" x1="${r2(-dx * L)}" y1="${r2(-dy * L)}" x2="${r2(dx * L)}" y2="${r2(dy * L)}">${stops}</linearGradient>`;
          }
        } else if (f.type === 'pattern' || f.type === 'texture') {
          const t = tile(f);
          fill = `url(#${id}-fill)`;
          defs = `<pattern id="${id}-fill" patternUnits="userSpaceOnUse" x="${r2(b.x)}" y="${r2(b.y)}" width="${t.size}" height="${t.size}"><image href="${t.path}" width="${t.size}" height="${t.size}" preserveAspectRatio="none"/></pattern>`;
        }
      }
      const stroke = l.stroke.width > 0 ? ` stroke="${l.stroke.color}" stroke-width="${l.stroke.width}" stroke-linejoin="round" stroke-linecap="round"` : '';
      html.push(`  <svg class="layer" id="${id}" viewBox="${r2(b.x)} ${r2(b.y)} ${r2(b.w)} ${r2(b.h)}" role="img" aria-label="${esc(l.name)}">`
        + (defs ? `<defs>${defs}</defs>` : '') + `<path d="${shapeD(l)}" fill="${fill}"${stroke}/></svg>`);
    }
    if (p.opacity < 1) decl.push('opacity: ' + r2(clamp(p.opacity, 0, 1)));
    if (l.blend !== 'source-over') decl.push('mix-blend-mode: ' + l.blend);
    css.push(`/* ${l.name.replace(/\*\//g, '')} */\n#${id} {\n${decl.map(d => '  ' + d + ';').join('\n')}\n}`);
  }

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>

<!-- Each layer of the collage is one element, bottom layer first. Its id comes from the layer name. -->
<div class="collage" id="collage">
${html.join('\n')}
</div>

<!-- To animate with GSAP, uncomment and edit:
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script>
  gsap.to('#${firstPiece || 'collage'}', { y: -40, rotation: 8, duration: 0.6, repeat: -1, yoyo: true, ease: 'steps(4)' });
</script>
-->

</body>
</html>
`;
  const sheet = `/* Exported from Collage Maker. Positions are in pixels on a ${doc.w} x ${doc.h} stage. */
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #1d1812;
}
.collage {
  position: relative;
  width: ${doc.w}px;
  height: ${doc.h}px;
  overflow: hidden;
}
.layer {
  position: absolute;
  display: block;
}
svg.layer {
  overflow: visible; /* outlines may sit just outside the shape's box */
}

${css.join('\n\n')}
`;
  files.push({ path: 'index.html', text: page }, { path: 'style.css', text: sheet });
  try {
    const r = await fetch('api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, files }) });
    if (!r.ok) throw new Error(await r.text());
    const out = await r.json();
    CM.toast('Exported to the "' + out.dir + '" folder.');
    if (tab) tab.location = out.url;
  } catch (err) {
    if (tab) tab.close();
    CM.toast('Export failed: ' + err.message);
  }
}
function exportVideo() {
  if (recording) return;
  const mime = window.MediaRecorder && ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) return CM.toast('This browser cannot record video.');
  pause();
  const chunks = [], rec = new MediaRecorder(cv.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8e6 });
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => { download(new Blob(chunks, { type: 'video/webm' }), 'collage.webm'); CM.toast('Video saved.'); };
  recording = rec;
  $('videoBtn').textContent = '● Recording…'; $('videoBtn').disabled = true;
  time = 0; draw();
  rec.start();
  play();
}
function finishRecording() {
  const rec = recording;
  playing = false; $('playBtn').textContent = '▶';
  setTimeout(() => {
    rec.stop(); recording = null;
    $('videoBtn').textContent = '● Video'; $('videoBtn').disabled = false;
    setTime(0);
  }, 200);
}

// ---------- top-level controls ----------
function syncButtons() { $('undoBtn').disabled = hi <= 0; $('redoBtn').disabled = hi >= hist.length - 1; }
function syncDocControls() {
  const v = doc.w + 'x' + doc.h, s = $('sizeSel');
  if (![...s.options].some(o => o.value === v)) s.append(h('option', { value: v }, `${doc.w} × ${doc.h}`));
  s.value = v;
  $('durInp').value = doc.duration; $('fpsSel').value = doc.fps; $('loopChk').checked = doc.loop;
}
$('tools').addEventListener('click', e => { if (e.target.dataset.tool) setTool(e.target.dataset.tool); });
$('undoBtn').onclick = undo;
$('redoBtn').onclick = redo;
$('sizeSel').onchange = e => { [doc.w, doc.h] = e.target.value.split('x').map(Number); fitBoard(); commit(); };
$('saveBtn').onclick = saveProject;
$('openBtn').onclick = () => $('openFile').click();
$('openFile').onchange = e => { if (e.target.files[0]) openProject(e.target.files[0]); e.target.value = ''; };
$('pngBtn').onclick = exportPNG;
$('htmlBtn').onclick = exportHTML;
$('videoBtn').onclick = exportVideo;
$('playBtn').onclick = () => (playing ? pause() : play());
$('rewindBtn').onclick = () => { pause(); setTime(0); };
$('keyBtn').onclick = addKeyHere;
$('delKeyBtn').onclick = delKeyHere;
$('loopChk').onchange = e => { doc.loop = e.target.checked; commit(); };
$('durInp').onchange = e => {
  doc.duration = clamp(+e.target.value || 6, 1, 120); e.target.value = doc.duration;
  for (const l of doc.layers) l.keys = l.keys.filter(k => k.t <= doc.duration);
  setTime(Math.min(time, doc.duration)); commit(); refresh();
};
$('fpsSel').onchange = e => { doc.fps = +e.target.value; setTime(time); commit(); };
$('addFillBtn').onclick = () => addLayer(newFill('#d9a520'));
$('dupBtn').onclick = duplicateLayer;
$('delBtn').onclick = deleteLayer;
$('dupBtn').before(
  h('button', { title: 'Bring forward (Ctrl+])', onclick: () => moveLayer(1) }, '▲'),
  h('button', { title: 'Send backward (Ctrl+[)', onclick: () => moveLayer(-1) }, '▼'));

window.addEventListener('keydown', e => {
  if (CM.editorOpen || recording) return;
  const tag = e.target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !/^(range|checkbox|color)$/.test(e.target.type))) return;
  const k = e.key.toLowerCase(), l = selLayer();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'd') { e.preventDefault(); duplicateLayer(); }
    else if (k === ']') { e.preventDefault(); moveLayer(1); }
    else if (k === '[') { e.preventDefault(); moveLayer(-1); }
    else if (k === 's') { e.preventDefault(); saveProject(); }
    return;
  }
  if (k === ' ') { e.preventDefault(); if (tag === 'BUTTON') e.target.blur(); playing ? pause() : play(); }
  else if (k === 'v') setTool('select');
  else if (k === 's') setTool('shape');
  else if (k === 'l') setTool('line');
  else if (k === 'k') addKeyHere();
  else if (k === 'enter' && draft) { e.preventDefault(); finishLine(false); }
  else if (k === 'escape') { if (draft) { draft = null; renderOpts(); requestRender(); } else select(null); }
  else if ((k === 'delete' || k === 'backspace') && l) { e.preventDefault(); deleteLayer(); }
  else if (k.startsWith('arrow') && l && l.type !== 'fill') {
    e.preventDefault();
    const n = e.shiftKey ? 10 : 1, p = evalBase(l, time);
    write(l, { x: p.x + (k === 'arrowleft' ? -n : k === 'arrowright' ? n : 0), y: p.y + (k === 'arrowup' ? -n : k === 'arrowdown' ? n : 0) });
    commit(); syncProps(); requestRender();
  }
});
window.addEventListener('resize', fitBoard);

// ---------- start ----------
const bg = newFill('#3f5fa8');
bg.name = 'Background';
doc.layers.push(bg);
sel = bg.id;
syncDocControls();
setTool('select');
commit();
fitBoard();
refresh();
const ready = loadLibrary();   // resolves once the library list has loaded (or failed)

CM.app = { ready, doc, lib, addArtToBoard, itemArt, addLayer, newShape, newFill, select, setTime, addKey, commit, refresh, paint, editLibraryItem, exportHTML };
})();
