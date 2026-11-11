// Art editor: cut pieces out of a picture (eraser, restore, magic wand, scissors) and apply color effects.
(() => {
'use strict';
const CM = window.CM;

// ---------- small DOM helpers shared with app.js ----------
CM.h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};
const h = CM.h;
CM.slider = (label, min, max, step, value, oninput, onchange, fmt = v => v) => {
  const out = h('output', {}, String(fmt(value)));
  const inp = h('input', {
    type: 'range', min, max, step, value,
    oninput: () => { out.textContent = fmt(+inp.value); oninput(+inp.value); },
    onchange: () => onchange && onchange(+inp.value),
  });
  return h('label', { class: 'row' }, label, inp, out);
};
CM.select = (label, options, value, onchange) => {
  const sel = h('select', { onchange: () => onchange(sel.value) },
    Object.entries(options).map(([v, t]) => h('option', { value: v }, t)));
  sel.value = value;
  return h('label', { class: 'row' }, label, sel);
};
// A short message at the bottom of the screen. It stays up about as long as it takes to
// read (2.6-12 s; warnings at least 6 s), stays while hovered, and hides on click.
// { warn: true } styles it as a warning, for things the user needs to know about.
let toastTimer, toastMs = 0;
CM.toast = (msg, { warn = false } = {}) => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.toggle('warn', warn); t.classList.remove('hidden');
  toastMs = Math.min(12000, Math.max(warn ? 6000 : 2600, msg.length * 65));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), toastMs);
};
{
  const t = document.getElementById('toast');
  t.addEventListener('mouseenter', () => clearTimeout(toastTimer));
  t.addEventListener('mouseleave', () => { toastTimer = setTimeout(() => t.classList.add('hidden'), 2000); });
  t.addEventListener('click', () => { clearTimeout(toastTimer); t.classList.add('hidden'); });
}

// ---------- editor state ----------
const $ = id => document.getElementById(id);
const root = $('editor'), cv = $('edCanvas'), g = cv.getContext('2d');
const MAX_UNDO = 15;
let W = null;            // working copy: { orig, mask }
let fx, fxC, comp;       // effect settings, effects render, effects+mask composite
let cb = null;           // callbacks from the caller
const V = { x: 0, y: 0, z: 1 };
let tool = 'erase', undo = [], redo = [], trim, startPivot, origData = null;
let stroke = null, lasso = null, pan = null, mouse = null, spaceDown = false, fxQueued = false;
const brush = { size: 40, hard: 0.8 }, wandOpt = { tol: 32, contig: true }, lassoOpt = { mode: 'keep' };
let backdrop = 'checker';

const checker = CM.canvas(16, 16);
{
  const c = checker.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, 16, 16);
  c.fillStyle = '#cfcfcf'; c.fillRect(0, 0, 8, 8); c.fillRect(8, 8, 8, 8);
}

const HINTS = {
  erase: 'Drag to rub parts of the picture away. Scroll to zoom, hold Space to pan, [ and ] change brush size.',
  restore: 'Drag to paint erased parts back in.',
  wand: 'Click a flat area (like a white background) to remove it. Raise tolerance to take more.',
  lasso: 'Draw a loop around a piece, like cutting it from a magazine.',
  pan: 'Drag to move the view. Scroll to zoom.',
};

CM.editorOpen = false;
CM.openEditor = o => {
  cb = o;
  W = { orig: o.art.orig, mask: CM.copyCanvas(o.art.mask) };
  fx = { ...o.art.fx };
  trim = { x: 0, y: 0 };
  const b = o.art.bounds;
  startPivot = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  undo = []; redo = []; origData = null; stroke = lasso = pan = null;
  $('edTitle').textContent = o.title || 'Edit art';
  $('edApply').textContent = o.applyLabel || 'Apply';
  $('edSave').hidden = !o.onSave;
  root.classList.remove('hidden');
  CM.editorOpen = true;
  buildFxUI();
  setTool(tool);
  rebuildFx();
  fit();
};
function close() {
  root.classList.add('hidden');
  CM.editorOpen = false;
  W = fxC = comp = origData = null; undo = []; redo = [];
}
const result = () => CM.buildArt({ orig: W.orig, mask: CM.copyCanvas(W.mask), fx: { ...fx } });

// ---------- rendering ----------
function rebuildFx() {
  fxC = CM.renderFx(W.orig, fx);
  if (!comp || comp.width !== W.orig.width || comp.height !== W.orig.height) comp = CM.canvas(W.orig.width, W.orig.height);
  recomposite();
}
function recomposite() {
  const x = comp.getContext('2d');
  x.globalCompositeOperation = 'copy'; x.drawImage(fxC, 0, 0);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(W.mask, 0, 0);
  x.globalCompositeOperation = 'source-over';
  draw();
}
function fit() {
  const r = cv.getBoundingClientRect();
  V.z = Math.min((r.width - 40) / W.orig.width, (r.height - 40) / W.orig.height);
  V.x = (r.width - W.orig.width * V.z) / 2;
  V.y = (r.height - W.orig.height * V.z) / 2;
  draw();
}
function draw() {
  if (!W) return;
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#2a251f'; g.fillRect(0, 0, r.width, r.height);
  g.save();
  g.translate(V.x, V.y); g.scale(V.z, V.z);
  if (backdrop === 'checker') {
    const p = g.createPattern(checker, 'repeat');
    p.setTransform(new DOMMatrix().scale(1 / V.z));
    g.fillStyle = p;
  } else g.fillStyle = backdrop;
  g.fillRect(0, 0, W.orig.width, W.orig.height);
  g.imageSmoothingEnabled = V.z < 3;
  g.drawImage(comp, 0, 0);
  g.restore();
  if (lasso && lasso.length > 1) {
    g.beginPath();
    lasso.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x * V.z + V.x, y * V.z + V.y));
    g.lineWidth = 3; g.strokeStyle = '#000'; g.setLineDash([]); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.setLineDash([6, 5]); g.stroke(); g.setLineDash([]);
  }
  if (mouse && (tool === 'erase' || tool === 'restore') && !pan) {
    g.beginPath(); g.arc(mouse.sx, mouse.sy, brush.size / 2 * V.z, 0, 7);
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
    g.lineWidth = 1.2; g.strokeStyle = '#fff'; g.stroke();
  }
}

// ---------- undo ----------
const snap = () => ({ orig: W.orig, mask: CM.copyCanvas(W.mask), trim: { ...trim } });
function pushUndo() {
  undo.push(snap());
  if (undo.length > MAX_UNDO) undo.shift();
  redo = [];
}
function restoreSnap(s) {
  const resized = s.orig !== W.orig;
  W.orig = s.orig; W.mask = s.mask; trim = s.trim;
  if (resized) { origData = null; rebuildFx(); fit(); } else recomposite();
}
function doUndo() { if (undo.length) { redo.push(snap()); restoreSnap(undo.pop()); } }
function doRedo() { if (redo.length) { undo.push(snap()); restoreSnap(redo.pop()); } }

// ---------- tools ----------
function stamp(x, y) {
  const m = W.mask.getContext('2d'), r = brush.size / 2;
  m.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
  if (brush.hard >= 0.98) m.fillStyle = '#fff';
  else {
    const gr = m.createRadialGradient(x, y, r * brush.hard, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    m.fillStyle = gr;
  }
  m.beginPath(); m.arc(x, y, r, 0, 7); m.fill();
  m.globalCompositeOperation = 'source-over';
}
function strokeTo(x, y) {
  const dx = x - stroke.x, dy = y - stroke.y, dist = Math.hypot(dx, dy);
  const n = Math.ceil(dist / Math.max(1, brush.size * 0.12));
  for (let i = 1; i <= n; i++) stamp(stroke.x + dx * i / n, stroke.y + dy * i / n);
  stroke.x = x; stroke.y = y;
}

// Removes the clicked color: connected region only, or everywhere in the picture.
function wand(ix, iy) {
  const w = W.orig.width, hh = W.orig.height;
  if (ix < 0 || iy < 0 || ix >= w || iy >= hh) return false;
  if (!origData) origData = W.orig.getContext('2d').getImageData(0, 0, w, hh).data;
  const d = origData, m = W.mask.getContext('2d'), md = m.getImageData(0, 0, w, hh), a = md.data, tol = wandOpt.tol;
  const i0 = (iy * w + ix) * 4, r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2];
  const dist = i => Math.max(Math.abs(d[i] - r0), Math.abs(d[i + 1] - g0), Math.abs(d[i + 2] - b0));
  // Inside tolerance: fully removed. Just outside: partly removed, which softens the fringe.
  const apply = (p, dd) => {
    if (dd <= tol) a[p * 4 + 3] = 0;
    else if (dd < tol * 2) { const v = 255 * (dd - tol) / tol; if (a[p * 4 + 3] > v) a[p * 4 + 3] = v; }
  };
  if (wandOpt.contig) {
    const seen = new Uint8Array(w * hh), stack = [iy * w + ix];
    seen[stack[0]] = 1;
    while (stack.length) {
      const p = stack.pop(), dd = dist(p * 4);
      apply(p, dd);
      if (dd > tol) continue;
      const x = p % w;
      if (x > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (p >= w && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (p < w * (hh - 1) && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
  } else for (let p = 0, n = w * hh; p < n; p++) apply(p, dist(p * 4));
  m.putImageData(md, 0, 0);
  return true;
}

function applyLasso(pts) {
  const m = W.mask.getContext('2d');
  m.save();
  m.globalCompositeOperation = lassoOpt.mode === 'keep' ? 'destination-in' : 'destination-out';
  m.beginPath();
  pts.forEach(([x, y], i) => m[i ? 'lineTo' : 'moveTo'](x, y));
  m.closePath(); m.fillStyle = '#fff'; m.fill();
  m.restore();
}

function doTrim() {
  const b = CM.alphaBounds(comp);
  if (!b) return CM.toast('Nothing left to trim to.');
  const pad = 2;
  const x0 = Math.max(0, b.x - pad), y0 = Math.max(0, b.y - pad);
  const x1 = Math.min(W.orig.width, b.x + b.w + pad), y1 = Math.min(W.orig.height, b.y + b.h + pad);
  if (x0 === 0 && y0 === 0 && x1 === W.orig.width && y1 === W.orig.height) return CM.toast('Already trimmed.');
  pushUndo();
  const crop = src => { const c = CM.canvas(x1 - x0, y1 - y0); c.getContext('2d').drawImage(src, -x0, -y0); return c; };
  W = { orig: crop(W.orig), mask: crop(W.mask) };
  trim = { x: trim.x + x0, y: trim.y + y0 };
  origData = null;
  rebuildFx(); fit();
}

// ---------- pointer ----------
const pt = e => {
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  return { sx, sy, x: (sx - V.x) / V.z, y: (sy - V.y) / V.z };
};
cv.addEventListener('pointerdown', e => {
  if (!W) return;
  cv.setPointerCapture(e.pointerId);
  const p = pt(e);
  if (e.button !== 0 || spaceDown || tool === 'pan') { pan = { sx: p.sx, sy: p.sy, vx: V.x, vy: V.y }; return; }
  if (tool === 'erase' || tool === 'restore') { pushUndo(); stroke = { x: p.x, y: p.y }; stamp(p.x, p.y); recomposite(); }
  else if (tool === 'wand') { pushUndo(); if (wand(Math.floor(p.x), Math.floor(p.y))) recomposite(); else undo.pop(); }
  else if (tool === 'lasso') lasso = [[p.x, p.y]];
});
cv.addEventListener('pointermove', e => {
  if (!W) return;
  const p = mouse = pt(e);
  if (pan) { V.x = pan.vx + p.sx - pan.sx; V.y = pan.vy + p.sy - pan.sy; draw(); }
  else if (stroke) { strokeTo(p.x, p.y); recomposite(); }
  else { if (lasso) lasso.push([p.x, p.y]); draw(); }
});
const endPointer = () => {
  if (!W) return;
  if (lasso) {
    if (lasso.length > 3) { pushUndo(); applyLasso(lasso); }
    lasso = null; recomposite();
  }
  stroke = pan = null;
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { mouse = null; draw(); });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const p = pt(e), f = e.deltaY < 0 ? 1.15 : 1 / 1.15, z = CM.clamp(V.z * f, 0.05, 32), k = z / V.z;
  V.x = p.sx - (p.sx - V.x) * k; V.y = p.sy - (p.sy - V.y) * k; V.z = z;
  draw();
}, { passive: false });
window.addEventListener('resize', draw);

// ---------- side panels ----------
function setTool(t) {
  tool = t;
  for (const b of $('edTools').children) b.classList.toggle('on', b.dataset.t === t);
  $('edHint').textContent = HINTS[t];
  cv.style.cursor = t === 'pan' ? 'grab' : t === 'erase' || t === 'restore' ? 'none' : 'crosshair';
  const box = $('edToolOpts');
  box.replaceChildren();
  if (t === 'erase' || t === 'restore') {
    box.append(
      CM.slider('Brush size', 4, 400, 1, brush.size, v => { brush.size = v; }),
      CM.slider('Soft edge', 0, 100, 1, Math.round((1 - brush.hard) * 100), v => { brush.hard = 1 - v / 100; }, null, v => v + '%'));
  } else if (t === 'wand') {
    const chk = h('input', { type: 'checkbox', checked: wandOpt.contig, onchange: () => { wandOpt.contig = chk.checked; } });
    box.append(
      CM.slider('Tolerance', 1, 120, 1, wandOpt.tol, v => { wandOpt.tol = v; }),
      h('label', {}, chk, 'Only the connected area'));
  } else if (t === 'lasso') {
    box.append(CM.select('Scissors', { keep: 'Keep what I circle', remove: 'Remove what I circle' }, lassoOpt.mode, v => { lassoOpt.mode = v; }));
  }
}
$('edTools').addEventListener('click', e => { if (e.target.dataset.t) setTool(e.target.dataset.t); });

const FX = [
  ['hue', 'Hue shift', -180, 180, 1], ['sat', 'Saturation', 0, 300, 1], ['bri', 'Brightness', 0, 250, 1],
  ['con', 'Contrast', 0, 250, 1], ['gray', 'Black & white', 0, 100, 1], ['sepia', 'Sepia', 0, 100, 1],
  ['invert', 'Negative', 0, 100, 1], ['blur', 'Blur', 0, 30, 0.5], ['pixel', 'Pixelate', 1, 48, 1],
];
const PRESETS = {
  Photocopy: { gray: 100, con: 230, bri: 110 },
  'Old print': { sepia: 85, con: 120, sat: 80 },
  Technicolor: { sat: 230, con: 125 },
  Negative: { invert: 100 },
};
function queueFx() {
  if (fxQueued) return;
  fxQueued = true;
  requestAnimationFrame(() => { fxQueued = false; if (W) rebuildFx(); });
}
function buildFxUI() {
  const box = $('edFx');
  box.replaceChildren(
    h('div', { class: 'btnrow' }, Object.entries(PRESETS).map(([name, p]) =>
      h('button', { onclick: () => { fx = { ...CM.defaultFx(), ovColor: fx.ovColor, ...p }; buildFxUI(); queueFx(); } }, name))),
    ...FX.map(([k, label, min, max, step]) => CM.slider(label, min, max, step, fx[k], v => { fx[k] = v; queueFx(); })),
    h('h3', {}, 'Color overlay'),
    (() => {
      const c = h('input', { type: 'color', value: fx.ovColor, oninput: () => { fx.ovColor = c.value; queueFx(); } });
      return h('label', { class: 'row' }, 'Color', c);
    })(),
    CM.slider('Amount', 0, 100, 1, fx.ovAmt, v => { fx.ovAmt = v; queueFx(); }, null, v => v + '%'),
    CM.select('Style', { color: 'Tint', multiply: 'Multiply (ink)', screen: 'Screen (glow)', overlay: 'Overlay', 'source-over': 'Solid' },
      fx.ovMode, v => { fx.ovMode = v; queueFx(); }));
}

$('edFxReset').onclick = () => { fx = CM.defaultFx(); buildFxUI(); queueFx(); };
$('edUndo').onclick = doUndo;
$('edRedo').onclick = doRedo;
$('edFit').onclick = fit;
$('edTrim').onclick = doTrim;
$('edInvert').onclick = () => {
  pushUndo();
  const c = CM.canvas(W.mask.width, W.mask.height), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-out'; x.drawImage(W.mask, 0, 0);
  W.mask = c; recomposite();
};
$('edReset').onclick = () => {
  pushUndo();
  const m = W.mask.getContext('2d');
  m.fillStyle = '#fff'; m.fillRect(0, 0, W.mask.width, W.mask.height);
  recomposite();
};
$('edBackdrop').onchange = e => { backdrop = e.target.value; draw(); };
$('edCancel').onclick = close;
$('edSave').onclick = () => cb.onSave(result());
$('edApply').onclick = () => {
  const st = result(), b = st.bounds, o = cb;
  // How far the cut-out's centre moved, so a layer on the board can stay put.
  const d = { x: b.x + b.w / 2 - (startPivot.x - trim.x), y: b.y + b.h / 2 - (startPivot.y - trim.y) };
  close();
  o.onApply(st, d);
};

window.addEventListener('keydown', e => {
  if (!CM.editorOpen) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    else if (k === 'y') { e.preventDefault(); doRedo(); }
    return;
  }
  if (k === ' ') { spaceDown = true; e.preventDefault(); }
  else if (k === 'e') setTool('erase');
  else if (k === 'r') setTool('restore');
  else if (k === 'w') setTool('wand');
  else if (k === 'l') setTool('lasso');
  else if (k === '[' || k === ']') {
    brush.size = CM.clamp(Math.round(brush.size * (k === ']' ? 1.25 : 0.8)), 4, 400);
    setTool(tool); draw();
  }
});
window.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });
})();
