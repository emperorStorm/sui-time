import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { generateAndroidUpdate } from '../scripts/generate-android-update.mjs'

async function updateHarness() {
  const requests = [], downloads = [], installs = [], settings = []
  let permission = false, current = { version: '0.6.2', versionCode: '602' }, state
  const context = vm.createContext({ Uint8Array, Date, console, plus: { os: { name: 'Android' }, io: { resolveLocalFileSystemURL(path, callback) { callback({ remove() {} }) } }, runtime: { ...current, install: (path, options, done) => { installs.push(path); done() } }, downloader: { createDownload: (url, options, done) => {
    const task = { filename: options.filename, downloadedSize: 4, totalSize: 4, start() {}, abort() { this.aborted = true }, addEventListener(type, callback) { this.progress = callback } }
    downloads.push({ task, done }); return task
  } } }, uni: { request: options => { const task = { abort: () => options.fail() }; requests.push({ options, task }); return task }, setStorageSync() {}, getStorageSync() { return null }, removeStorageSync() {} } })
  const module = new vm.SourceTextModule(await readFile(new URL('../src/api/update.js', import.meta.url), 'utf8'), { context })
  await module.link(name => name.endsWith('.json') ? new vm.SyntheticModule(['default'], function () { this.setExport('default', { versionName: '0.6.2', versionCode: 602 }) }, { context }) : new vm.SyntheticModule(['androidPermissions', 'androidSettings'], function () {
    this.setExport('androidPermissions', () => ({ install: permission })); this.setExport('androidSettings', kind => settings.push(kind))
  }, { context }))
  await module.evaluate()
  const api = module.namespace
  api.subscribeUpdate(value => { state = value })
  return { api, requests, downloads, installs, settings, context, permit: () => { permission = true }, state: () => state }
}

test('版本码、运行时版本、无效清单及网络失败不误报最新', async () => {
  const h = await updateHarness()
  h.context.plus.runtime.version = '0.6.1'; h.context.plus.runtime.versionCode = 601
  assert.equal(h.api.installedVersion().code, 601)
  assert.equal(h.api.compareVersions('0.100.0', '1.0.0'), -1)
  assert.throws(() => h.api.validateUpdateManifest({ version: '0.6.3', url: 'https://github.com/sui-time/releases/v0.6.3/a.apk' }), /OSS/)
  assert.throws(() => h.api.validateUpdateManifest({ version: '0.6.3', url: 'https://oss@github.com/sui-time/releases/v0.6.3/a.apk' }), /OSS/)
  const a = h.api.checkUpdate(), b = h.api.checkUpdate()
  assert.equal(a, b); assert.equal(h.requests.length, 1)
  h.requests[0].options.fail()
  await a
  assert.equal(h.state().status, 'error')
  const second = h.api.checkUpdate()
  h.requests[1].options.success({ statusCode: 200, data: { version: 'bad' } })
  await second
  assert.equal(h.state().status, 'error')
})

async function found(h) {
  const check = h.api.checkUpdate()
  h.requests.at(-1).options.success({ statusCode: 200, data: { version: '0.6.3', versionCode: 603, url: 'https://downloads.example.cn/sui-time/releases/v0.6.3/app.apk' } })
  await check
}

test('OSS拒绝、取消下载、进度、安装授权往返与取消后重新安装', async () => {
  const h = await updateHarness()
  await found(h)
  const forbidden = h.api.downloadUpdate()
  h.requests.at(-1).options.success({ statusCode: 400 })
  await forbidden
  assert.equal(h.state().status, 'download-error'); assert.equal(h.downloads.length, 0)
  const canceled = h.api.downloadUpdate()
  h.api.cancelDownload(); await canceled
  assert.equal(h.state().status, 'found')
  const download = h.api.downloadUpdate()
  h.requests.at(-1).options.success({ statusCode: 206, data: new Uint8Array([0x50, 0x4b, 3, 4]).buffer })
  await download
  const { task, done } = h.downloads[0]
  task.progress({ downloadedSize: 2, totalSize: 4 })
  assert.equal(h.state().progress, 50)
  await h.api.downloadUpdate()
  assert.equal(h.downloads.length, 1)
  done(task, 200)
  assert.equal(h.state().status, 'waiting'); assert.deepEqual(h.settings, ['install']); assert.equal(h.installs.length, 0)
  h.permit(); h.api.resumeUpdateInstallation()
  assert.equal(h.installs.length, 1); assert.equal(h.state().status, 'waiting')
  h.api.installDownloaded(); assert.equal(h.installs.length, 2)
  h.context.plus.runtime.versionCode = 603
  h.api.resumeUpdateInstallation()
  assert.equal(h.state().status, 'latest')
})

test('清单生成仅在完整公开 APK 校验通过后写入，失败保留旧清单', async () => {
  const dir = await mkdtemp(`${tmpdir()}/sui-time-update-test-`)
  try {
    const apk = `${dir}/app.apk`, output = `${dir}/latest.json`
    await writeFile(apk, new Uint8Array([0x50, 0x4b, 3, 4])); await writeFile(output, '旧清单')
    const args = { tag: 'v0.6.2', baseUrl: 'https://downloads.example.cn', apk, output, manifest: { versionName: '0.6.2', versionCode: 602 }, release: { body: '中文更新说明' } }
    await assert.rejects(generateAndroidUpdate(args, async () => new Response('ApkDownloadForbidden', { status: 400 })), /旧清单保留/)
    assert.equal(await readFile(output, 'utf8'), '旧清单')
    await assert.rejects(generateAndroidUpdate(args, async () => new Response('错误文件')), /不一致/)
    assert.equal(await readFile(output, 'utf8'), '旧清单')
    const result = await generateAndroidUpdate(args, async () => new Response(new Uint8Array([0x50, 0x4b, 3, 4])))
    assert.equal(result.versionCode, 602); assert.equal(result.notes, '中文更新说明')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
