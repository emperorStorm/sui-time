import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const brand = path.join(root, 'docs/brand')
const source = await fs.readFile(path.join(root, 'desktop-client/src/assets/brand/sui-time-icon.svg'), 'utf8')
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sui-time-brand-'))
let context

try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
    headless: true,
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1
  })
  const page = await context.newPage()
  await page.setContent('<html><body style="margin:0"><canvas></canvas></body></html>')
  async function png(svg, size, output) {
    const base64 = await page.evaluate(async ({ svg, size }) => {
      const image = new Image()
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await image.decode()
      const canvas = document.querySelector('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(image, 0, 0, size, size)
      return canvas.toDataURL('image/png').split(',')[1]
    }, { svg, size })
    await fs.writeFile(output, Buffer.from(base64, 'base64'))
  }
  await fs.writeFile(path.join(brand, 'sui-time-icon.svg'), source)
  await png(source, 1024, path.join(brand, 'sui-time-icon.png'))
  await fs.writeFile(path.join(root, 'uni-client/src/static/sui-time-icon.svg'), source)
  const calendar = source.match(/<g filter="url\(#shadow\)">([\s\S]*?)<\/g>/)[1]
  const background = source.replace(/<g filter="url\(#shadow\)">[\s\S]*?<\/g>/, '').replace('rx="232"', 'rx="0"')
  const defs = source.match(/<defs>([\s\S]*?)<\/defs>/)[1]
  const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>${defs}</defs><g transform="translate(51.2 51.2) scale(.9)"><g filter="url(#shadow)">${calendar}</g></g></svg>`
  const tempDefault = path.join(profile, 'default.png')
  const tempBackground = path.join(profile, 'background.png')
  const tempForeground = path.join(profile, 'foreground.png')
  await png(source, 1024, tempDefault)
  await png(background, 1024, tempBackground)
  await png(foreground, 1024, tempForeground)
  const manifest = path.join(profile, 'icons.json')
  await fs.writeFile(manifest, JSON.stringify({ default: 'default.png', android_bg: 'background.png', android_fg: 'foreground.png', android_fg_scale: 100, bg_color: '#90D0FA' }))
  execFileSync(process.execPath, [path.join(root, 'tauri-desktop/node_modules/@tauri-apps/cli/tauri.js'), 'icon', manifest, '--output', path.join(root, 'tauri-desktop/src-tauri/icons')], { stdio: 'inherit' })
  await png(source, 64, path.join(root, 'tauri-desktop/src-tauri/icons/64x64.png'))
  await png(source, 1024, path.join(root, 'tauri-desktop/src-tauri/icons/icon.png'))
  const res = path.join(root, 'uni-client/android-templates/app/src/main/res')
  const attributes = { d: 'pathData', fill: 'fillColor', stroke: 'strokeColor', 'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLineCap', 'stroke-linejoin': 'strokeLineJoin' }
  const vectorPaths = [...calendar.matchAll(/<path\s+([^>]+)\/>/g)].map(([, pathAttributes]) => {
    const androidAttributes = [...pathAttributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => {
      if (!attributes[name]) throw new Error(`不支持的矢量属性：${name}`)
      const androidValue = value === 'none' ? '@android:color/transparent' : value === 'url(#blue)' ? '#218BE0' : value
      return `android:${attributes[name]}="${androidValue}"`
    })
    return `        <path ${androidAttributes.join(' ')} />`
  })
  await fs.writeFile(path.join(res, 'drawable/splash_mark.xml'), `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n    <group android:translateX="5.4" android:translateY="5.4" android:scaleX="0.094921875" android:scaleY="0.094921875">\n${vectorPaths.join('\n')}\n    </group>\n</vector>\n`)
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    await png(source, size, path.join(res, `mipmap-${density}/ic_launcher.png`))
    const round = source.replace('rx="232"', 'rx="512"')
    await png(round, size, path.join(res, `mipmap-${density}/ic_launcher_round.png`))
    await png(foreground, size * 2.25, path.join(res, `mipmap-${density}/ic_launcher_foreground.png`))
  }
  await png(background, 432, path.join(res, 'drawable-nodpi/ic_launcher_background.png'))
  await png(source, 192, path.join(res, 'drawable/icon.png'))
  console.log('已生成桌面图标、安卓图标、文档图片和 H5 图标')
} finally {
  if (context) await context.close()
  await fs.rm(profile, { recursive: true, force: true })
}
