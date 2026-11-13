import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = await mkdtemp(path.join(tmpdir(), 'sui-time-splash-'))
let context
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
    headless: true,
    viewport: { width: 432, height: 936 },
    deviceScaleFactor: 2
  })
  const page = await context.newPage()
  await page.goto(pathToFileURL(path.join(root, 'scripts/splash-screen.html')).href)
  await page.evaluate(() => document.fonts.ready)
  const output = path.join(root, 'android-templates/app/src/main/res/drawable-nodpi/splash.png')
  await page.screenshot({ path: output })
  console.log(output)
} finally {
  await context?.close()
  await rm(profile, { recursive: true, force: true })
}
