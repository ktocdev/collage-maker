// Shared helpers: canvases, procedural patterns/textures, fills, and art (bitmap + mask + effects).
(() => {
'use strict';
const CM = window.CM = {};

CM.canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
CM.copyCanvas = src => {
  const c = CM.canvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
};
CM.loadImage = url => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('Could not load ' + url));
  img.src = url;
});
CM.clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const rgb = hex => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
};
const rng = seed => () => {
  seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

// ---------- Patterns & textures (all tile seamlessly) ----------
CM.PATTERNS = {
  stripes: 'Stripes', diagonal: 'Diagonal stripes', dots: 'Polka dots', checker: 'Checkerboard',
  grid: 'Grid', zigzag: 'Zigzag', crosshatch: 'Crosshatch', halftone: 'Halftone', scallop: 'Scallops',
};
CM.TEXTURES = {
  paper: 'Aged paper', grain: 'Grain', weave: 'Canvas weave', newsprint: 'Newsprint',
  clouds: 'Clouds', wood: 'Woodgrain',
};

// Periodic value noise in [0,1], period `cells` across the tile.
function noise2(r, cells) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const s = t => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = s(x - x0), fy = s(y - y0);
    const a = g[(y0 % cells) * cells + x0 % cells], b = g[(y0 % cells) * cells + (x0 + 1) % cells];
    const c = g[((y0 + 1) % cells) * cells + x0 % cells], d = g[((y0 + 1) % cells) * cells + (x0 + 1) % cells];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
function fbm(r, base) {
  const layers = [noise2(r, base), noise2(r, base * 2), noise2(r, base * 4), noise2(r, base * 8)];
  return (u, v) => (layers[0](u, v) * 8 + layers[1](u, v) * 4 + layers[2](u, v) * 2 + layers[3](u, v)) / 15;
}
function pixelTile(S, bg, fg, fn) {
  const c = CM.canvas(S, S), x = c.getContext('2d'), im = x.createImageData(S, S), d = im.data;
  const a = rgb(bg), b = rgb(fg);
  for (let py = 0, i = 0; py < S; py++) for (let px = 0; px < S; px++, i += 4) {
    const m = CM.clamp(fn(px / S, py / S), 0, 1);
    d[i] = a[0] + (b[0] - a[0]) * m; d[i + 1] = a[1] + (b[1] - a[1]) * m; d[i + 2] = a[2] + (b[2] - a[2]) * m; d[i + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return c;
}

function makeTile(name, bg, fg) {
  const r = rng(7);
  if (name === 'grain') return pixelTile(128, bg, fg, () => r() * r());
  if (name === 'clouds') { const n = fbm(r, 3); return pixelTile(256, bg, fg, (u, v) => (n(u, v) - 0.3) * 2); }
  if (name === 'wood') {
    const n = fbm(r, 2);
    return pixelTile(256, bg, fg, (u, v) => 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 9 + n(u, v * 0.999) * 14));
  }
  const S = name === 'paper' || name === 'newsprint' ? 256 : 64;
  const c = CM.canvas(S, S), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, S, S);
  x.fillStyle = fg; x.strokeStyle = fg;
  const wrap = draw => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { x.save(); x.translate(dx, dy); draw(); x.restore(); } };
  switch (name) {
    case 'stripes': x.fillRect(0, 0, S / 4, S); x.fillRect(S / 2, 0, S / 4, S); break;
    case 'diagonal':
      x.lineWidth = S / 5.6; x.lineCap = 'square';
      for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(i * S / 2 - S, S * 2); x.lineTo(i * S / 2 + S * 2, -S); x.stroke(); }
      break;
    case 'dots':
      for (const [px, py] of [[S / 4, S / 4], [S * 3 / 4, S * 3 / 4]]) { x.beginPath(); x.arc(px, py, S / 7, 0, 7); x.fill(); }
      break;
    case 'checker': x.fillRect(0, 0, S / 2, S / 2); x.fillRect(S / 2, S / 2, S / 2, S / 2); break;
    case 'grid': x.fillRect(0, 0, S, 3); x.fillRect(0, 0, 3, S); x.fillRect(0, S / 2, S, 3); x.fillRect(S / 2, 0, 3, S); break;
    case 'zigzag':
      x.lineWidth = S / 9; x.lineJoin = 'miter';
      for (const oy of [0, S / 2, S]) { x.beginPath(); x.moveTo(-S / 4, oy + S / 8); x.lineTo(S / 4, oy - S / 8); x.lineTo(S * 3 / 4, oy + S / 8); x.lineTo(S * 5 / 4, oy - S / 8); x.stroke(); }
      break;
    case 'crosshatch':
      x.lineWidth = 2;
      for (let i = -4; i <= 8; i++) { x.beginPath(); x.moveTo(i * S / 4, 0); x.lineTo(i * S / 4 + S, S); x.moveTo(i * S / 4, 0); x.lineTo(i * S / 4 - S, S); x.stroke(); }
      break;
    case 'halftone':
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        const rad = 0.6 + 3.2 * (0.5 + 0.5 * Math.cos((i + j) / 8 * Math.PI * 2));
        x.beginPath(); x.arc(i * 8 + 4, j * 8 + 4, rad, 0, 7); x.fill();
      }
      break;
    case 'scallop':
      x.lineWidth = 3;
      wrap(() => { for (const [px, py] of [[0, 0], [S / 2, S / 2], [S, 0], [0, S], [S, S]]) { x.beginPath(); x.arc(px, py, S / 2 - 2, 0, Math.PI); x.stroke(); } });
      break;
    case 'weave':
      for (let i = 0; i < S; i += 4) {
        x.globalAlpha = 0.18 + 0.2 * r(); x.fillRect(0, i, S, 2);
        x.globalAlpha = 0.18 + 0.2 * r(); x.fillRect(i, 0, 2, S);
      }
      break;
    case 'paper':
      for (let i = 0; i < 14; i++) {
        const px = r() * S, py = r() * S, rad = 20 + r() * 50;
        wrap(() => {
          const g = x.createRadialGradient(px, py, 0, px, py, rad);
          g.addColorStop(0, fg); g.addColorStop(1, 'transparent');
          x.globalAlpha = 0.07; x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
        });
      }
      x.fillStyle = fg;
      for (let i = 0; i < 2600; i++) { x.globalAlpha = 0.04 + r() * 0.14; x.fillRect(r() * S, r() * S, 1 + r(), 1 + r()); }
      x.lineWidth = 0.7;
      for (let i = 0; i < 50; i++) {
        const px = r() * S, py = r() * S, a = r() * 7, len = 4 + r() * 12;
        x.globalAlpha = 0.12 + r() * 0.15; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke();
      }
      break;
    case 'newsprint':
      for (const col of [6, 134]) for (let y = 6; y < S - 2; y += 7) {
        let px = col;
        const end = col + 116 - (r() < 0.15 ? r() * 70 : 0);
        x.globalAlpha = 0.75;
        while (px < end) { const w = Math.min(3 + r() * 13, end - px); x.fillRect(px, y, w, 3); px += w + 3; }
      }
      break;
  }
  x.globalAlpha = 1;
  return c;
}

const tiles = new Map();
CM.tile = (name, bg, fg) => {
  const key = name + bg + fg;
  let t = tiles.get(key);
  if (!t) {
    if (tiles.size > 80) tiles.clear();
    t = makeTile(name, bg, fg);
    tiles.set(key, t);
  }
  return t;
};

// ---------- Fills ----------
CM.defaultFill = (color = '#d8402f') => ({
  type: 'color', color, color2: '#f3e7c9', gradType: 'linear', angle: 90, pattern: 'stripes', texture: 'paper', scale: 1,
});
// Returns a canvas fillStyle for `fill` covering box {x,y,w,h}.
CM.fillStyle = (ctx, f, b) => {
  if (f.type === 'gradient') {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    let g;
    if (f.gradType === 'radial') g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(b.w, b.h) / 2);
    else {
      const a = f.angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
      const L = (Math.abs(dx) * b.w + Math.abs(dy) * b.h) / 2;
      g = ctx.createLinearGradient(cx - dx * L, cy - dy * L, cx + dx * L, cy + dy * L);
    }
    g.addColorStop(0, f.color); g.addColorStop(1, f.color2);
    return g;
  }
  if (f.type === 'pattern' || f.type === 'texture') {
    const p = ctx.createPattern(CM.tile(f.type === 'pattern' ? f.pattern : f.texture, f.color, f.color2), 'repeat');
    p.setTransform(new DOMMatrix().translate(b.x, b.y).scale(f.scale));
    return p;
  }
  return f.color;
};

// ---------- Art: original bitmap + cut-out mask + effects ----------
// An art state is treated as immutable once built: { orig, mask, fx, out, bounds }.
const MAX_SIDE = 1600;
CM.defaultFx = () => ({
  hue: 0, sat: 100, bri: 100, con: 100, gray: 0, sepia: 0, invert: 0, blur: 0, pixel: 1,
  ovColor: '#ff3b6b', ovAmt: 0, ovMode: 'color',
});

CM.artFromImage = img => {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const s = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const orig = CM.canvas(w0 * s, h0 * s);
  orig.getContext('2d').drawImage(img, 0, 0, orig.width, orig.height);
  const mask = CM.canvas(orig.width, orig.height), m = mask.getContext('2d');
  m.fillStyle = '#fff'; m.fillRect(0, 0, mask.width, mask.height);
  return CM.buildArt({ orig, mask, fx: CM.defaultFx() });
};

// Renders the effects (without the mask) to a new canvas.
CM.renderFx = (orig, fx) => {
  const w = orig.width, h = orig.height, c = CM.canvas(w, h), x = c.getContext('2d');
  const f = [];
  if (fx.hue) f.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.sat !== 100) f.push(`saturate(${fx.sat}%)`);
  if (fx.bri !== 100) f.push(`brightness(${fx.bri}%)`);
  if (fx.con !== 100) f.push(`contrast(${fx.con}%)`);
  if (fx.gray) f.push(`grayscale(${fx.gray}%)`);
  if (fx.sepia) f.push(`sepia(${fx.sepia}%)`);
  if (fx.invert) f.push(`invert(${fx.invert}%)`);
  if (fx.blur) f.push(`blur(${fx.blur}px)`);
  x.filter = f.length ? f.join(' ') : 'none';
  if (fx.pixel > 1) {
    const small = CM.canvas(w / fx.pixel, h / fx.pixel);
    small.getContext('2d').drawImage(orig, 0, 0, small.width, small.height);
    x.imageSmoothingEnabled = false;
    x.drawImage(small, 0, 0, w, h);
  } else x.drawImage(orig, 0, 0);
  x.filter = 'none';
  if (fx.ovAmt > 0) {
    x.globalAlpha = fx.ovAmt / 100;
    x.globalCompositeOperation = fx.ovMode;
    x.fillStyle = fx.ovColor;
    x.fillRect(0, 0, w, h);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-in'; // keep the overlay off transparent pixels
    x.drawImage(orig, 0, 0);
    x.globalCompositeOperation = 'source-over';
  }
  return c;
};

// Bounding box of visible pixels, or null if nothing is visible.
CM.alphaBounds = cv => {
  const w = cv.width, h = cv.height;
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    if (d[i] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

CM.buildArt = st => {
  const out = CM.renderFx(st.orig, st.fx), x = out.getContext('2d');
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(st.mask, 0, 0);
  st.out = out;
  st.bounds = CM.alphaBounds(out) || { x: 0, y: 0, w: out.width, h: out.height };
  return st;
};

CM.cloneArt = st => CM.buildArt({ orig: st.orig, mask: CM.copyCanvas(st.mask), fx: { ...st.fx } });

// The visible cut-out, cropped to its bounds.
CM.artCrop = (st, maxSide) => {
  const b = st.bounds, s = maxSide ? Math.min(1, maxSide / Math.max(b.w, b.h)) : 1;
  const c = CM.canvas(b.w * s, b.h * s);
  c.getContext('2d').drawImage(st.out, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
  return c;
};
})();
