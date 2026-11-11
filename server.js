// Tiny local server for Collage Maker: serves the app and lists / stores library art.
//
// Run directly with `node server.js`. Tests can instead call `createServer({ dataDir })`
// to point library/ and exports/ at a temporary folder.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const IMG = /\.(jpe?g|png|gif|webp|avif)$/i;
// The static files the browser may fetch. Anything not listed here is never served.
const APP_FILES = new Set(['/index.html', '/style.css']);
const APP_SCRIPT = /^\/js\/[\w-]+\.js$/;
const EXPORT_FILE = /\.(html|css|png)$/i;   // what /api/export can write
const LIBRARY_LIMIT = 40 * 1024 * 1024;
const EXPORT_LIMIT = 300 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif',
};

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

// Only accept writes from the app itself. A missing Origin (curl, scripts) is allowed;
// an Origin that is not a parseable URL, such as "null", is rejected.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// Collects a request body up to `limit` bytes. Calls done(buffer) or answers 413 itself.
function readBody(req, res, limit, done) {
  const chunks = [];
  let size = 0, over = false;
  req.on('data', c => {
    if (over) return;
    size += c.length;
    if (size > limit) {
      over = true;
      res.setHeader('Connection', 'close');
      send(res, 413, 'too large');
      res.on('finish', () => req.destroy());
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => { if (!over) done(Buffer.concat(chunks)); });
}

// Resolves a URL path under `base`, or returns null if it escapes it.
function inside(base, rel) {
  const file = path.normalize(path.join(base, rel));
  return file.startsWith(base + path.sep) ? file : null;
}

function createServer({ dataDir = process.env.COLLAGE_DATA_DIR || ROOT } = {}) {
  const DATA = path.resolve(dataDir);
  const LIB = path.join(DATA, 'library');
  const CUT = path.join(LIB, 'cutouts');
  const EXPORTS = path.join(DATA, 'exports');
  fs.mkdirSync(CUT, { recursive: true });

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/library' && req.method === 'GET') {
      const items = [...listImages(CUT, 'library/cutouts/', 'cutout'), ...listImages(LIB, 'library/', 'source')];
      return send(res, 200, JSON.stringify(items), TYPES['.json']);
    }

    if (url.pathname === '/api/library' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, 'forbidden');
      let name = path.basename(url.searchParams.get('name') || '').replace(/[^\w.\-]+/g, '_');
      if (!IMG.test(name)) return send(res, 400, 'not an image name');
      const dir = url.searchParams.get('kind') === 'cutout' ? CUT : LIB;
      return readBody(req, res, LIBRARY_LIMIT, body => {
        const ext = path.extname(name), stem = name.slice(0, -ext.length);
        for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${stem}-${i}${ext}`;
        fs.writeFile(path.join(dir, name), body, { flag: 'wx' }, err => {
          if (err) return send(res, 500, 'write failed');
          const prefix = dir === CUT ? 'library/cutouts/' : 'library/';
          send(res, 200, JSON.stringify({ name: name.slice(0, -ext.length), url: prefix + encodeURIComponent(name) }), TYPES['.json']);
        });
      });
    }

    // Export a collage as a folder of HTML + CSS + images under exports/.
    if (url.pathname === '/api/export' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, 'forbidden');
      return readBody(req, res, EXPORT_LIMIT, body => {
        let data;
        try { data = JSON.parse(body.toString('utf8')); } catch { return send(res, 400, 'bad json'); }
        if (!data || typeof data !== 'object') return send(res, 400, 'bad json');
        const slug = String(data.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'collage';
        const OK = /^(index\.html|style\.css|images\/[a-z0-9][a-z0-9._-]*\.png)$/;
        const valid = f => f && typeof f === 'object' && OK.test(f.path) && (typeof f.text === 'string' || typeof f.base64 === 'string');
        if (!Array.isArray(data.files) || !data.files.every(valid)) return send(res, 400, 'bad file list');
        try {
          // Never overwrite an earlier export: it may hold hand-written animation code.
          let dirName = slug;
          for (let i = 2; fs.existsSync(path.join(EXPORTS, dirName)); i++) dirName = `${slug}-${i}`;
          const dir = path.join(EXPORTS, dirName);
          fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
          for (const f of data.files) {
            fs.writeFileSync(path.join(dir, f.path), typeof f.base64 === 'string' ? Buffer.from(f.base64, 'base64') : f.text);
          }
          send(res, 200, JSON.stringify({ dir: 'exports/' + dirName, url: `exports/${dirName}/index.html` }), TYPES['.json']);
        } catch (err) { send(res, 500, 'export failed: ' + err.message); }
      });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');

    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'bad path'); }
    if (rel === '/') rel = '/index.html';
    // Only the app's own files and the data folders are public; everything else
    // (server code, docs, tests, .git, package.json) answers 404.
    const top = rel.split(/[\\/]/)[1];
    let file;
    if (top === 'library' || top === 'exports') {
      if (!(top === 'library' ? IMG : EXPORT_FILE).test(rel)) return send(res, 404, 'not found');
      file = inside(path.join(DATA, top), rel.slice(top.length + 1));
    } else {
      if (!APP_FILES.has(rel) && !APP_SCRIPT.test(rel)) return send(res, 404, 'not found');
      file = inside(ROOT, rel);
    }
    if (!file) return send(res, 403, 'forbidden');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

module.exports = { createServer };

if (require.main === module) {
  const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 5173;
  const server = createServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Collage Maker running at http://localhost:${server.address().port}`);
  });
}
