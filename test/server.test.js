// Server tests. Run with: node --test test/
// Each test file starts its own server on a free port with a temporary data folder,
// so nothing is written into the real library/ or exports/.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createServer } = require('../server.js');

const ROOT = path.join(__dirname, '..');
let server, base, port, data;

before(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'collage-test-'));
  server = createServer({ dataDir: data });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
  fs.rmSync(data, { recursive: true, force: true });
});

// Raw request, so paths are sent exactly as written (fetch would normalise "..").
function raw(method, reqPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const upload = (name, body, { kind, headers } = {}) =>
  fetch(`${base}/api/library?name=${encodeURIComponent(name)}${kind ? `&kind=${kind}` : ''}`,
    { method: 'POST', body, headers });

const exportJSON = (payload, headers = {}) =>
  fetch(`${base}/api/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

// --- data folder ---------------------------------------------------------

test('creates library/cutouts in the data folder on startup', () => {
  assert.ok(fs.statSync(path.join(data, 'library', 'cutouts')).isDirectory());
});

test('COLLAGE_DATA_DIR and PORT=0 work when run as a script', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collage-env-'));
  fs.mkdirSync(path.join(dir, 'library'));
  fs.writeFileSync(path.join(dir, 'library', 'only-here.png'), 'x');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, COLLAGE_DATA_DIR: dir, PORT: '0' },
  });
  try {
    const url = await new Promise((resolve, reject) => {
      child.stdout.on('data', d => { const m = /http:\/\/localhost:(\d+)/.exec(String(d)); if (m) resolve(`http://127.0.0.1:${m[1]}`); });
      child.on('exit', code => reject(new Error('server exited ' + code)));
    });
    const items = await (await fetch(url + '/api/library')).json();
    assert.deepEqual(items.map(i => i.name), ['only-here']);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- static files --------------------------------------------------------

test('serves the app page at /', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(await res.text(), /<html/i);
});

test('serves scripts with a JavaScript content type', async () => {
  const res = await fetch(base + '/js/core.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/javascript/);
});

test('serves library/ and exports/ from the data folder, not the project', async () => {
  fs.writeFileSync(path.join(data, 'library', 'static-check.png'), 'png-bytes');
  fs.mkdirSync(path.join(data, 'exports', 'static-check'), { recursive: true });
  fs.writeFileSync(path.join(data, 'exports', 'static-check', 'index.html'), '<p>hi</p>');
  const img = await fetch(base + '/library/static-check.png');
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(await img.text(), 'png-bytes');
  assert.equal(await (await fetch(base + '/exports/static-check/index.html')).text(), '<p>hi</p>');
});

test('returns 404 for a missing file', async () => {
  assert.equal((await fetch(base + '/nope.html')).status, 404);
  assert.equal((await fetch(base + '/library/nope.png')).status, 404);
});

test('rejects path traversal out of the app and data folders', async () => {
  const secret = path.join(path.dirname(data), path.basename(data) + '-secret.txt');
  fs.writeFileSync(secret, 'secret');
  try {
    const attempts = [
      '/..%2f..%2f..%2fetc%2fpasswd',
      // URL parsing resolves %2e%2e itself, so this one is clamped to /etc/passwd under the app folder.
      '/%2e%2e/%2e%2e/etc/passwd',
      '/..%5c..%5cserver.js',
      `/library/..%2f..%2f${path.basename(secret)}`,
      `/library/..%5c..%5c${path.basename(secret)}`,
      '/exports/..%2fserver.js',
      '/library/..%5c..%5cserver.js',
    ];
    for (const p of attempts) {
      const res = await raw('GET', p);
      assert.ok([403, 404].includes(res.status), `${p} -> ${res.status}`);
      assert.notEqual(res.body.toString(), 'secret', p);
    }
  } finally { fs.rmSync(secret); }
});

test('returns 400 for a malformed percent-encoding', async () => {
  assert.equal((await raw('GET', '/%E0%A4%A')).status, 400);
});

test('returns 405 for other methods', async () => {
  assert.equal((await fetch(base + '/index.html', { method: 'PUT', body: 'x' })).status, 405);
  assert.equal((await fetch(base + '/index.html', { method: 'DELETE' })).status, 405);
});

test('HEAD returns headers and no body', async () => {
  const res = await raw('HEAD', '/index.html');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 0);
});

// --- GET /api/library ----------------------------------------------------

test('lists cut-outs first, then sources, sorted, images only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collage-list-'));
  const s = createServer({ dataDir: dir });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try {
    const lib = path.join(dir, 'library');
    for (const n of ['b.jpg', 'a.PNG', 'notes.txt', 'c.webp']) fs.writeFileSync(path.join(lib, n), 'x');
    fs.mkdirSync(path.join(lib, 'folder.png'));                 // a directory with an image name
    fs.writeFileSync(path.join(lib, 'cutouts', 'z-cut.png'), 'x');
    fs.writeFileSync(path.join(lib, 'cutouts', 'odd name#1.png'), 'x');
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/library`);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.deepEqual(await res.json(), [
      { name: 'odd name#1', url: 'library/cutouts/odd%20name%231.png', kind: 'cutout' },
      { name: 'z-cut', url: 'library/cutouts/z-cut.png', kind: 'cutout' },
      { name: 'a', url: 'library/a.PNG', kind: 'source' },
      { name: 'b', url: 'library/b.jpg', kind: 'source' },
      { name: 'c', url: 'library/c.webp', kind: 'source' },
    ]);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- POST /api/library ---------------------------------------------------

test('upload saves bytes to library/ and returns name and url', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
  const res = await upload('photo.png', bytes);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { name: 'photo', url: 'library/photo.png' });
  assert.deepEqual(fs.readFileSync(path.join(data, 'library', 'photo.png')), bytes);
  // and it can be fetched back through the static route
  assert.deepEqual(Buffer.from(await (await fetch(base + '/library/photo.png')).arrayBuffer()), bytes);
});

test('kind=cutout saves to library/cutouts/', async () => {
  const res = await upload('piece.png', 'x', { kind: 'cutout' });
  assert.deepEqual(await res.json(), { name: 'piece', url: 'library/cutouts/piece.png' });
  assert.ok(fs.existsSync(path.join(data, 'library', 'cutouts', 'piece.png')));
});

test('upload never overwrites: adds a numeric suffix', async () => {
  const names = [];
  for (const body of ['one', 'two', 'three']) names.push((await (await upload('dupe.jpg', body)).json()).name);
  assert.deepEqual(names, ['dupe', 'dupe-2', 'dupe-3']);
  assert.equal(fs.readFileSync(path.join(data, 'library', 'dupe.jpg'), 'utf8'), 'one');
  assert.equal(fs.readFileSync(path.join(data, 'library', 'dupe-3.jpg'), 'utf8'), 'three');
});

test('concurrent uploads of the same name never overwrite each other', async () => {
  const bodies = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const results = await Promise.all(bodies.map(async b => {
    const res = await upload('race.png', b);
    return { body: b, status: res.status, out: res.status === 200 ? await res.json() : null };
  }));
  // Every upload reported as saved must still be on disk with its own bytes.
  for (const r of results.filter(r => r.status === 200)) {
    const file = path.join(data, 'library', decodeURIComponent(r.out.url.slice('library/'.length)));
    assert.equal(fs.readFileSync(file, 'utf8'), r.body, `${r.out.url} was overwritten`);
  }
  assert.ok(results.every(r => r.status === 200 || r.status === 500), 'only success or a clean failure');
});

test('upload sanitises the name and strips directories', async () => {
  const cases = [
    ['../../evil.png', 'evil'],
    // path.basename treats "\" as a separator on Windows only.
    ['..\\..\\win.png', process.platform === 'win32' ? 'win' : '.._.._win'],
    ['my photo (1).png', 'my_photo_1_'],
    ['ünïcode.webp', '_n_code'],
  ];
  for (const [name, expected] of cases) {
    const res = await upload(name, 'x');
    assert.equal(res.status, 200, name);
    const out = await res.json();
    assert.equal(out.name, expected, name);
    assert.ok(fs.existsSync(path.join(data, 'library', decodeURIComponent(out.url.slice('library/'.length)))), name);
  }
  assert.ok(!fs.existsSync(path.join(data, 'evil.png')));
  assert.ok(!fs.existsSync(path.join(path.dirname(data), 'evil.png')));
});

test('upload rejects names without an image extension', async () => {
  for (const name of ['notes.txt', 'script.js', 'png', 'image.png.exe', '']) {
    const res = await upload(name, 'x');
    assert.equal(res.status, 400, JSON.stringify(name));
  }
});

test('upload rejects bodies over 40 MB with 413 and writes nothing', async () => {
  const big = Buffer.alloc(40 * 1024 * 1024 + 1);
  const res = await upload('huge.png', big).catch(err => ({ status: 'error', err }));
  // The server answers 413 and closes; depending on timing the client sees the
  // 413 or a reset while still sending. Either way, nothing must be written.
  if (res.status !== 'error') assert.equal(res.status, 413);
  assert.ok(!fs.existsSync(path.join(data, 'library', 'huge.png')));
  // and the server is still up
  assert.equal((await fetch(base + '/api/library')).status, 200);
});

test('upload accepts a body of exactly 40 MB', async () => {
  const res = await upload('limit.png', Buffer.alloc(40 * 1024 * 1024));
  assert.equal(res.status, 200);
  assert.equal(fs.statSync(path.join(data, 'library', 'limit.png')).size, 40 * 1024 * 1024);
});

// --- origin check (both POST endpoints) ----------------------------------

for (const [label, send] of [
  ['library', headers => upload('origin.png', 'x', { headers })],
  ['export', headers => exportJSON({ name: 'origin', files: [] }, headers)],
]) {
  test(`${label}: allows same origin and no origin`, async () => {
    assert.equal((await send({ Origin: base })).status, 200);
    assert.equal((await send({})).status, 200);
  });

  test(`${label}: rejects a different origin with 403`, async () => {
    for (const Origin of ['http://evil.example', `http://localhost:${port + 1}`, `http://127.0.0.1:${port + 1}`]) {
      assert.equal((await send({ Origin })).status, 403, Origin);
    }
  });

  // B1: this used to throw inside the request handler and crash the process.
  test(`${label}: rejects an unparseable Origin such as "null" without crashing`, async () => {
    for (const Origin of ['null', 'not a url', '://']) {
      assert.equal((await send({ Origin })).status, 403, Origin);
    }
    assert.equal((await fetch(base + '/api/library')).status, 200, 'server still running');
  });
}

test('rejected origins write nothing', async () => {
  await upload('blocked.png', 'x', { headers: { Origin: 'http://evil.example' } });
  await exportJSON({ name: 'blocked', files: [{ path: 'index.html', text: 'x' }] }, { Origin: 'null' });
  assert.ok(!fs.existsSync(path.join(data, 'library', 'blocked.png')));
  assert.ok(!fs.existsSync(path.join(data, 'exports', 'blocked')));
});

// --- POST /api/export ----------------------------------------------------

test('export writes text and base64 files and returns dir and url', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 200]);
  const res = await exportJSON({
    name: 'My Collage!',
    files: [
      { path: 'index.html', text: '<h1>hi</h1>' },
      { path: 'style.css', text: 'body{}' },
      { path: 'images/a-1.png', base64: png.toString('base64') },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { dir: 'exports/my-collage', url: 'exports/my-collage/index.html' });
  const dir = path.join(data, 'exports', 'my-collage');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<h1>hi</h1>');
  assert.equal(fs.readFileSync(path.join(dir, 'style.css'), 'utf8'), 'body{}');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'images', 'a-1.png')), png);
  assert.equal(await (await fetch(base + '/exports/my-collage/index.html')).text(), '<h1>hi</h1>');
});

test('export slugs the name and falls back to "collage"', async () => {
  const slug = async name => (await (await exportJSON({ name, files: [] })).json()).dir;
  assert.equal(await slug('  --Pink Hearts__2026--  '), 'exports/pink-hearts-2026');
  assert.equal(await slug('../../etc'), 'exports/etc');
  assert.equal(await slug('!!!'), 'exports/collage');
  assert.equal(await slug(undefined), 'exports/collage-2');
  assert.equal(await slug(42), 'exports/42');
});

test('export never overwrites an earlier export', async () => {
  const dirs = [];
  for (const text of ['first', 'second']) {
    dirs.push((await (await exportJSON({ name: 'again', files: [{ path: 'index.html', text }] })).json()).dir);
  }
  assert.deepEqual(dirs, ['exports/again', 'exports/again-2']);
  assert.equal(fs.readFileSync(path.join(data, 'exports', 'again', 'index.html'), 'utf8'), 'first');
});

test('export rejects file paths outside the allowed set', async () => {
  const bad = [
    '../escape.html', 'images/../../escape.png', 'images/sub/a.png', 'images/A.png',
    'images/.hidden.png', 'images/a.jpg', 'script.js', '/index.html', 'images\\a.png', 'index.html ',
  ];
  for (const p of bad) {
    const res = await exportJSON({ name: 'bad-' + bad.indexOf(p), files: [{ path: p, text: 'x' }] });
    assert.equal(res.status, 400, p);
  }
  assert.ok(!fs.existsSync(path.join(path.dirname(data), 'escape.html')));
  assert.ok(!fs.readdirSync(path.join(data, 'exports')).some(n => n.startsWith('bad-')), 'no folder created');
});

// B2: these used to write the string "undefined" or return 500.
test('export rejects malformed payloads with 400 and creates nothing', async () => {
  const before = fs.readdirSync(path.join(data, 'exports')).length;
  const payloads = [
    'not json',
    'null',
    '[]',
    '"text"',
    { name: 'x' },
    { name: 'x', files: 'index.html' },
    { name: 'x', files: [null] },
    { name: 'x', files: [{ path: 'index.html' }] },                  // no content
    { name: 'x', files: [{ path: 'index.html', text: 42 }] },        // content not a string
    { name: 'x', files: [{ path: 'images/a.png', base64: null }] },
  ];
  for (const p of payloads) {
    const res = await exportJSON(p);
    assert.equal(res.status, 400, JSON.stringify(p));
  }
  assert.equal(fs.readdirSync(path.join(data, 'exports')).length, before);
});

test('export rejects bodies over 300 MB', async () => {
  // Stream the body so the test does not hold 300 MB in memory.
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/export' }, r => {
      r.resume(); r.on('end', () => resolve({ status: r.statusCode }));
    });
    req.on('error', () => resolve({ status: 'reset' }));
    const chunk = Buffer.alloc(8 * 1024 * 1024, 0x20);
    let sent = 0;
    (function write() {
      while (sent <= 300 * 1024 * 1024) {
        sent += chunk.length;
        if (!req.write(chunk)) return req.once('drain', write);
      }
      req.end();
    })();
  });
  assert.ok([413, 'reset'].includes(res.status), String(res.status));
  assert.equal((await fetch(base + '/api/library')).status, 200, 'server still running');
});
