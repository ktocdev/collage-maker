// Shared Playwright fixtures.
//
//   server   a Collage Maker server on a free port, with a temporary data folder seeded
//            with generated pictures. Never the real library/. One per worker, shared by
//            its tests; a spec that writes to the library sets `test.use({ isolate: true })`
//            to get a fresh one per test, so its files cannot leak into other tests.
//   page     fails the test on any uncaught page error or console.error.
//   app      the page, opened and with the library loaded (CM.app.ready).
const base = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../server.js');
const { PICTURES } = require('./png.js');

// Chrome logs this when hit-testing reads pixels; it is advice, not an error (handoff note).
const IGNORED = [/willReadFrequently/];

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collage-e2e-'));
  for (const [rel, bytes] of Object.entries(PICTURES)) {
    fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, rel), bytes);
  }
  const server = createServer({ dataDir });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`, dataDir,
    stop: async () => { await new Promise(r => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

const test = base.test.extend({
  isolate: [false, { option: true }],

  sharedServer: [async ({}, use) => {
    const s = await startServer();
    await use(s);
    await s.stop();
  }, { scope: 'worker' }],

  server: async ({ isolate, sharedServer }, use) => {
    if (!isolate) return use(sharedServer);
    const s = await startServer();
    await use(s);
    await s.stop();
  },

  baseURL: async ({ server }, use) => use(server.url),

  page: async ({ page }, use) => {
    const problems = [];
    page.on('pageerror', err => problems.push('pageerror: ' + err.message));
    page.on('console', msg => {
      if (msg.type() === 'error' && !IGNORED.some(re => re.test(msg.text()))) problems.push('console.error: ' + msg.text());
    });
    await use(page);
    base.expect(problems, 'the page logged errors').toEqual([]);
  },

  app: async ({ page }, use) => {
    await page.goto('/');
    await page.evaluate(() => window.CM.app.ready);
    await use(page);
  },
});

module.exports = { test, expect: base.expect };
