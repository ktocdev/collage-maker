// Minimal PNG encoder (RGBA, 8-bit) so tests can generate their own pictures
// instead of using anything from the real library.
const zlib = require('node:zlib');

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// pixel(x, y) returns [r, g, b, a], each 0-255.
function encodePNG(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The seeded test pictures. Small, asymmetric and distinct, so a wrong position,
// flip or rotation shows up as a pixel difference.
const PICTURES = {
  // Opaque: four coloured quadrants with a diagonal gradient line.
  'library/quadrants.png': encodePNG(120, 80, (x, y) => {
    const q = (x < 60 ? 0 : 1) + (y < 40 ? 0 : 2);
    const base = [[220, 40, 40], [40, 160, 60], [40, 80, 220], [240, 200, 30]][q];
    return Math.abs(x - y * 1.5) < 3 ? [255, 255, 255, 255] : [...base, 255];
  }),
  // Transparent: a dot whose alpha fades out towards the edge.
  'library/soft-dot.png': encodePNG(64, 64, (x, y) => {
    const d = Math.hypot(x - 31.5, y - 31.5) / 32;
    return [200, 60, 160, Math.max(0, Math.round(255 * (1 - d)))];
  }),
  // A saved cut-out: an L shape on transparency.
  'library/cutouts/ell-cut.png': encodePNG(40, 60, (x, y) =>
    (x < 14 || y > 45) ? [30, 30, 30, 255] : [0, 0, 0, 0]),
};

// Minimal 24-bit BMP: browsers display it, but the server's library folder does not
// accept the format, which makes it a realistic "saved for this session only" case.
function encodeBMP(w, h, pixel) {
  const row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h, b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, bl] = pixel(x, y), o = 54 + (h - 1 - y) * row + x * 3;
    b[o] = bl; b[o + 1] = g; b[o + 2] = r;
  }
  return b;
}

module.exports = { encodePNG, encodeBMP, PICTURES };
