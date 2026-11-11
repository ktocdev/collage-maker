// Shared Playwright fixtures.
//
//   server   one Collage Maker server per worker, on a free port, with a temporary
//            data folder seeded with generated pictures. Never the real library/.
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

const test = base.test.extend({
  server: [async ({}, use) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collage-e2e-'));
    for (const [rel, bytes] of Object.entries(PICTURES)) {
      fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dataDir, rel), bytes);
    }
    const server = createServer({ dataDir });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    await use({ url: `http://127.0.0.1:${server.address().port}`, dataDir });
    await new Promise(r => server.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }, { scope: 'worker' }],

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
