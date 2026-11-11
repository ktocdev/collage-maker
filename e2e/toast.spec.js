// B15: messages at the bottom of the screen. Long messages and warnings used to vanish
// after 2.6 s like any other, too fast to read. Runs on a paused fake clock.
const { test, expect } = require('./support/fixtures.js');
const { encodeBMP } = require('./support/png.js');
const { key } = require('./support/board.js');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: 0 });
  await page.goto('/');
  await page.evaluate(() => CM.app.ready);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 50);
});
const toast = page => page.locator('#toast');
const bmp = { name: 'bitmap.bmp', mimeType: 'image/bmp', buffer: encodeBMP(8, 8, () => [10, 200, 30]) };

test('a short message shows briefly', async ({ page }) => {
  await key(page, 'Escape');                         // nothing selected
  await key(page, 'k');                              // "Select a layer first."
  await expect(toast(page)).toHaveText('Select a layer first.');
  await expect(toast(page)).not.toHaveClass(/\bwarn\b/);
  await page.clock.runFor(2000);
  await expect(toast(page)).toBeVisible();
  await page.clock.runFor(1000);
  await expect(toast(page)).toBeHidden();
});

test('a long warning stays up long enough to read, and looks like a warning', async ({ page }) => {
  await page.setInputFiles('#uploadFile', [bmp]);
  await expect(toast(page)).toContainText('this session only');
  await expect(toast(page)).toHaveClass(/\bwarn\b/);
  const ms = (await toast(page).textContent()).length * 65;      // about 65 ms per character
  expect(ms).toBeGreaterThan(6000);
  await page.clock.runFor(ms - 500);
  await expect(toast(page)).toBeVisible();
  await page.clock.runFor(1000);
  await expect(toast(page)).toBeHidden();
});

test('hovering keeps a message up; clicking dismisses it', async ({ page }) => {
  await page.setInputFiles('#uploadFile', [bmp]);
  await toast(page).hover();
  await page.clock.runFor(20000);
  await expect(toast(page)).toBeVisible();
  await toast(page).click();
  await expect(toast(page)).toBeHidden();
});

test('moving off a hovered message lets it go after 2 s', async ({ page }) => {
  await page.setInputFiles('#uploadFile', [bmp]);
  await toast(page).hover();
  await page.clock.runFor(15000);
  await page.mouse.move(5, 5);
  await page.clock.runFor(1500);
  await expect(toast(page)).toBeVisible();
  await page.clock.runFor(1000);
  await expect(toast(page)).toBeHidden();
});

test('messages are announced to screen readers', async ({ page }) => {
  await expect(toast(page)).toHaveAttribute('role', 'status');
  await expect(toast(page)).toHaveAttribute('aria-live', 'polite');
});
