import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { marked } = require('../../desktop-client/node_modules/marked')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }
const server = http.createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (pathname === '/readme-preview.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<!doctype html><meta charset="utf-8"><body>${marked.parse(await fs.readFile(path.join(root, 'README.md'), 'utf8'))}</body>`)
      return
    }
    if (pathname.startsWith('/desktop/')) pathname = `/desktop-client/dist/${pathname.slice(9) || 'index.html'}`
    if (pathname.startsWith('/mobile/')) pathname = `/uni-client/dist/build/h5/${pathname.slice(8) || 'index.html'}`
    if (pathname.startsWith('/assets/')) {
      const desktopAsset = path.join(root, 'desktop-client/dist', pathname)
      try { await fs.access(desktopAsset); pathname = `/desktop-client/dist${pathname}` }
      catch { pathname = `/uni-client/dist/build/h5${pathname}` }
    }
    if (pathname.startsWith('/static/')) pathname = `/uni-client/dist/build/h5${pathname}`
    const file = path.resolve(root, `.${pathname}`)
    assert(file.startsWith(`${root}${path.sep}`))
    const content = await fs.readFile(file)
    response.setHeader('Content-Type', `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`)
    response.end(content)
  } catch {
    response.statusCode = 404
    response.end('Not found')
  }
})
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sui-time-brand-check-'))
let context
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true,
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/docs/brand/index.html`)
  await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); await document.fonts.ready })
  await page.getByRole('button', { name: '圆角', exact: true }).click()
  assert.equal(await page.locator('.mask').getAttribute('data-shape'), 'square')
  await page.getByRole('button', { name: '圆形', exact: true }).click()
  assert.equal(await page.locator('.mask').getAttribute('data-shape'), 'circle')
  await page.screenshot({ path: path.join(root, 'docs/brand/preview.png'), fullPage: true })
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('link', { name: '下载高清 PNG' }).click()
  assert.equal((await downloadEvent).suggestedFilename(), 'sui-time-icon.png')
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  console.log('PASS 品牌预览：深浅背景、圆形/圆角切换、PNG下载、390px布局')
  await page.goto(`${origin}/readme-preview.html`)
  const readmeIcon = page.getByAltText('岁岁时光 · 岁岁刻度图标')
  await readmeIcon.evaluate(image => image.decode())
  assert.equal(await readmeIcon.evaluate(image => image.naturalWidth), 1024)
  console.log('PASS README 渲染：正式图标可加载')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${origin}/desktop/`)
  const desktopIcon = page.locator('.brand-lockup img, .brand-menu-trigger img').first()
  await desktopIcon.waitFor()
  await desktopIcon.evaluate(image => image.decode())
  const desktopSvg = await desktopIcon.evaluate(async image => (await fetch(image.src)).text())
  assert(desktopSvg.includes('岁岁刻度'))
  assert((await page.locator('link[rel="icon"]').getAttribute('href')).includes('sui-time-icon'))
  console.log('PASS 桌面构建页面：应用品牌图标和 favicon')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/mobile/`)
  await page.locator('uni-page').waitFor()
  const mobileSvg = await page.locator('link[rel="icon"]').evaluate(async link => (await fetch(link.href)).text())
  assert(mobileSvg.includes('岁岁刻度'))
  console.log('PASS 移动 H5：首屏加载及正式 favicon')
  const res = 'uni-client/android-templates/app/src/main/res'
  const assets = []
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    for (const variant of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']) {
      assets.push({ file: `${res}/mipmap-${density}/${variant}.png`, size: variant.endsWith('foreground') ? size * 2.25 : size })
    }
  }
  for (const { file, size } of assets) {
    const png = await fs.readFile(path.join(root, file))
    assert.equal(png.readUInt32BE(16), size, file)
    assert.equal(png.readUInt32BE(20), size, file)
  }
  const foreground = await page.evaluate(async url => {
    const image = new Image(); image.src = url; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = image.naturalWidth
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
    let ink = 0
    for (let x = 0; x < canvas.width; x += 12) for (let y = 0; y < canvas.height; y += 12) if (ctx.getImageData(x, y, 1, 1).data[3] > 0) ink++
    return { corner: ctx.getImageData(0, 0, 1, 1).data[3], ink }
  }, `${origin}/${res}/mipmap-xxxhdpi/ic_launcher_foreground.png`)
  assert.equal(foreground.corner, 0)
  assert(foreground.ink > 0)
  const source = await fs.readFile(path.join(root, 'desktop-client/src/assets/brand/sui-time-icon.svg'), 'utf8')
  assert.equal(await fs.readFile(path.join(root, 'docs/brand/sui-time-icon.svg'), 'utf8'), source)
  assert.equal(await fs.readFile(path.join(root, 'uni-client/src/static/sui-time-icon.svg'), 'utf8'), source)
  const calendar = source.match(/<g filter="url\(#shadow\)">([\s\S]*?)<\/g>/)[1]
  const splashMark = await fs.readFile(path.join(root, res, 'drawable/splash_mark.xml'), 'utf8')
  for (const [, data] of calendar.matchAll(/<path\s+d="([^"]+)"/g)) assert(splashMark.includes(`android:pathData="${data}"`))
  assert.deepEqual(errors, [])
  console.log('PASS 安卓15张图标尺寸、透明前景、正式 SVG 一致性；无页面运行异常')
} finally {
  if (context) await context.close()
  await new Promise(resolve => server.close(resolve))
  await fs.rm(profile, { recursive: true, force: true })
}
