// Tiny local server for Collage Maker: serves the app and lists / stores library art.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const LIB = path.join(ROOT, 'library');
const CUT = path.join(LIB, 'cutouts');
const EXPORTS = path.join(ROOT, 'exports');
const PORT = Number(process.env.PORT) || 5173;
const IMG = /\.(jpe?g|png|gif|webp|avif)$/i;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif',
};

fs.mkdirSync(CUT, { recursive: true });

function listImages(dir, prefix, kind) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* missing folder is fine */ }
  return names
    .filter(n => IMG.test(n) && fs.statSync(path.join(dir, n)).isFile())
    .sort()
    .map(n => ({ name: n.replace(/\.[^.]+$/, ''), url: prefix + encodeURIComponent(n), kind }));
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/library' && req.method === 'GET') {
    const items = [...listImages(CUT, 'library/cutouts/', 'cutout'), ...listImages(LIB, 'library/', 'source')];
    return send(res, 200, JSON.stringify(items), TYPES['.json']);
  }

  if (url.pathname === '/api/library' && req.method === 'POST') {
    // Only accept writes from the app itself.
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, 'forbidden');
    let name = path.basename(url.searchParams.get('name') || '').replace(/[^\w.\-]+/g, '_');
    if (!IMG.test(name)) return send(res, 400, 'not an image name');
    const dir = url.searchParams.get('kind') === 'cutout' ? CUT : LIB;
    const ext = path.extname(name), stem = name.slice(0, -ext.length);
    for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${stem}-${i}${ext}`;
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 40 * 1024 * 1024) { send(res, 413, 'too large'); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      fs.writeFile(path.join(dir, name), Buffer.concat(chunks), err => {
        if (err) return send(res, 500, 'write failed');
        const prefix = dir === CUT ? 'library/cutouts/' : 'library/';
        send(res, 200, JSON.stringify({ name: stem, url: prefix + encodeURIComponent(name) }), TYPES['.json']);
      });
    });
    return;
  }

  // Export a collage as a folder of HTML + CSS + images under exports/.
  if (url.pathname === '/api/export' && req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, 'forbidden');
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 300 * 1024 * 1024) { send(res, 413, 'too large'); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const slug = String(data.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'collage';
        const OK = /^(index\.html|style\.css|images\/[a-z0-9][a-z0-9._-]*\.png)$/;
        if (!Array.isArray(data.files) || data.files.some(f => !OK.test(f.path))) return send(res, 400, 'bad file list');
        // Never overwrite an earlier export: it may hold hand-written animation code.
        let dirName = slug;
        for (let i = 2; fs.existsSync(path.join(EXPORTS, dirName)); i++) dirName = `${slug}-${i}`;
        const dir = path.join(EXPORTS, dirName);
        fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
        for (const f of data.files) {
          fs.writeFileSync(path.join(dir, f.path), f.base64 != null ? Buffer.from(f.base64, 'base64') : String(f.text));
        }
        send(res, 200, JSON.stringify({ dir: 'exports/' + dirName, url: `exports/${dirName}/index.html` }), TYPES['.json']);
      } catch (err) { send(res, 500, 'export failed: ' + err.message); }
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');

  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'bad path'); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Collage Maker running at http://localhost:${PORT}`);
});
