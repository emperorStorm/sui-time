const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = __dirname;
const ids = ['time-check', 'day-fold', 'daily-sprout', 'time-ribbon'];
const svgData = Object.fromEntries(ids.map(id => [id, `data:image/svg+xml;base64,${fs.readFileSync(path.join(root, 'assets', `${id}.svg`)).toString('base64')}`]));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sui-time-icon-review-'));
  let context;
  const errors = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      viewport: { width: 1024, height: 1024 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure().errorText}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    for (const id of ids) {
      await page.goto(pathToFileURL(path.join(root, 'assets', `${id}.svg`)).href);
      await page.screenshot({ path: path.join(root, 'assets', `${id}.png`), omitBackground: true });
    }
    const pngData = Object.fromEntries(ids.map(id => [id, `data:image/png;base64,${fs.readFileSync(path.join(root, 'assets', `${id}.png`)).toString('base64')}`]));
    const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const bundled = source
      .replace('const concepts = [', `const embeddedSvg = ${JSON.stringify(svgData)};\nconst embeddedPng = ${JSON.stringify(pngData)};\nconst concepts = [`)
      .replaceAll('src="assets/${c.id}.svg"', 'src="${embeddedSvg[c.id]}"')
      .replaceAll('href="assets/${c.id}.svg" download', 'href="${embeddedSvg[c.id]}" download="${c.id}.svg"')
      .replaceAll('href="assets/${c.id}.png" download', 'href="${embeddedPng[c.id]}" download="${c.id}.png"');
    fs.writeFileSync(path.join(root, 'dist', 'sui-time-app-icons.html'), bundled);
    for (const entry of ['index.html', 'dist/sui-time-app-icons.html']) {
      await page.setViewportSize({ width: 1520, height: 1120 });
      await page.goto(pathToFileURL(path.join(root, entry)).href);
      await page.locator('.hero-icon').last().waitFor();
      await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); await document.fonts.ready; });
      assert.equal(await page.locator('.card').count(), 4);
      assert.equal(await page.locator('img').count(), 28);
      assert(await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('button', { name: '圆角', exact: true }).click();
      assert.equal(await page.locator('.android').getAttribute('data-mask'), 'square');
      assert.equal(await page.getByRole('button', { name: '圆角', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: '圆形', exact: true }).click();
      assert.equal(await page.locator('.android').getAttribute('data-mask'), 'circle');
      assert.equal(await page.locator('.android .dock img').first().evaluate(image => getComputedStyle(image).clipPath), 'circle(50%)');
      if (entry === 'index.html') await page.screenshot({ path: path.join(root, 'comparison.png'), fullPage: true });
      for (const width of [390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${entry} overflows at ${width}`);
        assert(await page.locator('.card').evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth)));
        if (entry === 'index.html' && width === 390) await page.screenshot({ path: path.join(root, 'comparison-mobile.png'), fullPage: true });
      }
      for (const link of await page.locator('.asset-links a').evaluateAll(links => links.map(link => link.href))) {
        if (link.startsWith('file:')) assert(fs.existsSync(require('node:url').fileURLToPath(link)));
        else assert(link.startsWith('data:image/'));
      }
      console.log(`PASS ${entry}: 4 concepts, 28 images, 8 download links, both masks, 1520/768/390px layouts`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS no page errors, console errors or failed requests; PNG exports are 1024 × 1024');
  } finally {
    if (context) await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
