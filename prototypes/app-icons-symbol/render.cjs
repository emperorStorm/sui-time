const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = __dirname;
const ids = ['stroke-arc', 'arc-ticks', 'stacked-paper'];
const allIds = ['current-official', ...ids];
const read = id => fs.readFileSync(path.join(root, 'assets', `${id}.svg`), 'utf8');

function checkContract(id) {
  const svg = read(id);
  const groups = [...svg.matchAll(/<g filter="url\(#shadow\)">([\s\S]*?)<\/g>/g)];
  assert.equal(groups.length, 1, `${id}: 必须只有一个 shadow 组`);
  const inner = groups[0][1];
  assert(!/<g\b/.test(inner), `${id}: shadow 组内不能嵌套 g`);
  assert(!/<(rect|circle|ellipse|line|polygon|polyline)\b/.test(inner), `${id}: shadow 组内只能使用 path`);
  assert(!/\b(opacity|fill-opacity|stroke-opacity|transform|clip-path)=/.test(inner), `${id}: 不得使用滤镜外属性`);
  assert.equal(inner.replace(/<path\b([^>]*)\/>/g, '').trim(), '', `${id}: 必须全部为自闭合 path`);
  for (const [, attributes] of inner.matchAll(/<path\b([^>]*)\/>/g)) {
    for (const [, name, value] of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) {
      assert(['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'].includes(name), `${id}: 不支持的属性 ${name}`);
      if (name === 'fill') assert(value === 'none' || value === 'url(#blue)' || /^#[0-9A-Fa-f]{6}$/.test(value), `${id}: 不支持的填充 ${value}`);
    }
  }
  assert(svg.includes('rx="232"'), `${id}: 缺少圆角裁切`);
}
ids.forEach(checkContract);

const svgData = Object.fromEntries(allIds.map(id => [id, `data:image/svg+xml;base64,${Buffer.from(read(id)).toString('base64')}`]));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sui-time-symbol-review-'));
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
    for (const id of allIds) {
      await page.goto(pathToFileURL(path.join(root, 'assets', `${id}.svg`)).href);
      await page.screenshot({ path: path.join(root, 'assets', `${id}.png`), omitBackground: true });
      const png = fs.readFileSync(path.join(root, 'assets', `${id}.png`));
      assert.equal(png.readUInt32BE(16), 1024, `${id}.png 宽度`);
      assert.equal(png.readUInt32BE(20), 1024, `${id}.png 高度`);
    }
    const pngData = Object.fromEntries(allIds.map(id => [id, `data:image/png;base64,${fs.readFileSync(path.join(root, 'assets', `${id}.png`)).toString('base64')}`]));
    const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const bundled = source
      .replace('const concepts = [', `const embeddedSvg = ${JSON.stringify(svgData)};\nconst embeddedPng = ${JSON.stringify(pngData)};\nconst concepts = [`)
      .replaceAll('src="assets/${id}.svg"', 'src="${embeddedSvg[id]}"')
      .replaceAll('href="assets/${c.id}.svg" download', 'href="${embeddedSvg[c.id]}" download="${c.id}.svg"')
      .replaceAll('href="assets/${c.id}.png" download', 'href="${embeddedPng[c.id]}" download="${c.id}.png"');
    fs.writeFileSync(path.join(root, 'dist', 'sui-time-symbol-icons.html'), bundled);
    for (const entry of ['index.html', 'dist/sui-time-symbol-icons.html']) {
      await page.setViewportSize({ width: 1520, height: 1120 });
      await page.goto(pathToFileURL(path.join(root, entry)).href);
      await page.locator('.hero-icon').last().waitFor();
      await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); await document.fonts.ready; });
      assert.equal(await page.locator('.card').count(), 3);
      assert.equal(await page.locator('img').count(), 32);
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
      const links = await page.locator('.asset-links a').evaluateAll(items => items.map(link => link.href));
      assert.equal(links.length, 6);
      for (const link of links) {
        if (link.startsWith('file:')) assert(fs.existsSync(fileURLToPath(link)));
        else assert(link.startsWith('data:image/'));
      }
      console.log(`PASS ${entry}: 3 concepts, 32 images, 6 download links, both masks, 1520/768/390px layouts`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS 源 SVG 符合生成链契约；PNG 均为 1024 × 1024；无页面错误');
  } finally {
    if (context) await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
