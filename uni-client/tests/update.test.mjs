import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { generateAndroidUpdate } from '../scripts/generate-android-update.mjs'

async function updateHarness(cached = null) {
  const requests = [], downloads = [], installs = [], settings = [], calls = []
  let permission = false, current = { version: '0.6.2', versionCode: '602' }, state, available = true, stageError = '', installError = '', removeError = '', storageError = false
  const name = '12345678-1234-1234-1234-123456789abc.apk'
  const context = vm.createContext({ Uint8Array, Date, console, plus: { os: { name: 'Android' }, io: { convertLocalFileSystemURL(path) { return path.startsWith('_doc/') ? `/private/doc/${path.slice(5)}` : path } }, runtime: { ...current }, downloader: { createDownload: (url, options, done) => {
    const task = { filename: options.filename, downloadedSize: 4, totalSize: 4, start() {}, abort() { this.aborted = true }, addEventListener(type, callback) { this.progress = callback } }
    downloads.push({ task, done }); return task
  } } }, uni: { request: options => { const task = { abort: () => options.fail() }; requests.push({ options, task }); return task }, setStorageSync(key, value) { cached = value }, getStorageSync() { return cached }, removeStorageSync() { if (storageError) throw new Error('缓存存储失败'); cached = null } } })
  const module = new vm.SourceTextModule(await readFile(new URL('../src/api/update.js', import.meta.url), 'utf8'), { context })
  await module.link(path => path.endsWith('.json') ? new vm.SyntheticModule(['default'], function () { this.setExport('default', { versionName: '0.6.2', versionCode: 602 }) }, { context }) : new vm.SyntheticModule(['androidPermissions', 'androidSettings', 'androidUpdate'], function () {
    this.setExport('androidPermissions', () => ({ install: permission })); this.setExport('androidSettings', kind => settings.push(kind))
    this.setExport('androidUpdate', (method, ...args) => {
      calls.push([method, ...args])
      if (method === 'stage') return stageError ? { ok: false, message: stageError } : { ok: true, name, size: 4 }
      if (method === 'inspect') return available ? { ok: true } : { ok: false, message: '文件不可读' }
      if (method === 'install') { installs.push(args[0]); return installError ? { ok: false, message: installError } : { ok: true } }
      if (method === 'remove' && removeError) return { ok: false, message: removeError }
      return { ok: true }
    })
  }, { context }))
  await module.evaluate()
  const api = module.namespace
  api.subscribeUpdate(value => { state = value })
  return { api, requests, downloads, installs, settings, calls, context, name, permit: () => { permission = true }, unavailable: () => { available = false }, stageFail: () => { stageError = '文件不可读' }, installFail: () => { installError = '系统安装器不可用' }, setRemoveError: value => { removeError = value }, setStorageError: value => { storageError = value }, state: () => state }
}

test('版本码、运行时版本、无效清单及网络失败不误报最新', async () => {
  const h = await updateHarness()
  h.context.plus.runtime.version = '0.6.1'; h.context.plus.runtime.versionCode = 601
  assert.equal(h.api.installedVersion().code, 601)
  assert.equal(h.api.compareVersions('0.100.0', '1.0.0'), -1)
  assert.equal(h.api.OSS_BASE_URL, 'https://package.laoshi.chat')
  assert.doesNotThrow(() => h.api.validateUpdateManifest({ version: '0.6.7', url: 'https://package.laoshi.chat/sui-time/releases/v0.6.7/sui-time-0.6.7-android.apk' }))
  assert.throws(() => h.api.validateUpdateManifest({ version: '0.6.7', url: 'http://package.laoshi.chat/sui-time/releases/v0.6.7/sui-time-0.6.7-android.apk' }), /OSS|GitHub/)
  assert.doesNotThrow(() => h.api.validateUpdateManifest({ version: '0.6.4', url: 'https://github.com/emperorStorm/sui-time/releases/download/v0.6.4/sui-time-0.6.4-android.apk' }))
  assert.throws(() => h.api.validateUpdateManifest({ version: '0.6.3', url: 'https://github.com/sui-time/releases/v0.6.3/a.apk' }), /OSS|GitHub/)
  assert.throws(() => h.api.validateUpdateManifest({ version: '0.6.3', url: 'https://oss@github.com/emperorStorm/sui-time/releases/download/v0.6.3/sui-time-0.6.3-android.apk' }), /OSS|GitHub/)
  const a = h.api.checkUpdate(), b = h.api.checkUpdate()
  assert.equal(a, b); assert.equal(h.requests.length, 1)
  assert.match(h.requests[0].options.url, /^https:\/\/package\.laoshi\.chat\/sui-time\/latest-android\.json\?t=\d+$/)
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
  h.requests.at(-1).options.success({ statusCode: 200, data: { version: '0.6.4', versionCode: 604, url: 'https://github.com/emperorStorm/sui-time/releases/download/v0.6.4/sui-time-0.6.4-android.apk' } })
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
  task.filename = '_doc/updates/sui-time-0.6.4-604-actual'
  done(task, 200)
  assert.deepEqual(h.calls[0], ['stage', '/private/doc/updates/sui-time-0.6.4-604-actual', '/private/doc/updates/', '4'])
  assert.equal(h.state().status, 'waiting'); assert.deepEqual(h.settings, ['install']); assert.equal(h.installs.length, 0)
  h.api.installDownloaded(); h.api.cancelDownload(); assert.equal(h.settings.length, 1); assert.equal(h.state().status, 'waiting')
  h.permit(); h.api.resumeUpdateInstallation()
  assert.equal(h.installs.length, 1); assert.equal(h.state().status, 'waiting')
  h.api.installDownloaded(); assert.equal(h.installs.length, 1)
  h.api.resumeUpdateInstallation(); assert.equal(h.state().status, 'ready')
  assert.match(h.state().message, /尚未检测到新版本/)
  h.api.installDownloaded(); assert.equal(h.installs.length, 2)
  h.context.plus.runtime.versionCode = 604
  h.api.resumeUpdateInstallation()
  assert.equal(h.state().status, 'latest')
  assert.deepEqual(h.calls.at(-1), ['remove', h.name])
})

test('恢复下载包后检查失败仍可安装，并可再次检查', async () => {
  const cached = { name: '12345678-1234-1234-1234-123456789abc.apk', size: 4, version: '0.6.4', code: 604, url: 'https://github.com/emperorStorm/sui-time/releases/download/v0.6.4/sui-time-0.6.4-android.apk' }
  for (const failure of ['network', 'http']) {
    const h = await updateHarness(cached)
    h.api.resumeUpdateInstallation(); assert.equal(h.state().status, 'ready')
    const check = h.api.checkUpdate()
    if (failure === 'network') h.requests.at(-1).options.fail()
    else h.requests.at(-1).options.success({ statusCode: 503 })
    await check
    assert.equal(h.state().status, 'ready'); assert.equal(h.state().checkError, true)
    assert.match(h.state().message, /检查更新失败/)
    assert.equal(h.state().downloadUrl, cached.url)
    h.permit(); h.api.installDownloaded()
    assert.deepEqual(h.installs, [cached.name])
  }
  const h = await updateHarness(cached)
  h.api.resumeUpdateInstallation()
  const first = h.api.checkUpdate(); h.requests.at(-1).options.fail(); await first
  await found(h)
  assert.equal(h.state().status, 'found'); assert.equal(h.state().checkError, false)
  const next = h.api.checkUpdate(); h.requests.at(-1).options.fail(); await next
  assert.equal(h.state().status, 'ready'); assert.equal(h.state().downloadUrl, cached.url)
  const sheet = await readFile(new URL('../src/components/UpdateSheet.vue', import.meta.url), 'utf8')
  assert.match(sheet, /state.status === 'ready' && state.checkError/)
  assert.match(sheet, /emit\('install'\)/)
})

test('授权拒绝、安装器失败及明确重新下载', async () => {
  const h = await updateHarness()
  await found(h)
  const download = h.api.downloadUpdate()
  h.requests.at(-1).options.success({ statusCode: 206, data: new Uint8Array([0x50, 0x4b, 3, 4]).buffer })
  await download
  h.downloads[0].done(h.downloads[0].task, 200)
  h.api.resumeUpdateInstallation()
  assert.equal(h.state().status, 'ready'); assert.match(h.state().message, /未获得/)
  h.permit(); h.installFail(); h.api.installDownloaded()
  assert.equal(h.state().status, 'ready'); assert.match(h.state().message, /系统安装器不可用/)
  const retry = h.api.downloadUpdate(true)
  assert.equal(h.calls.filter(call => call[0] === 'remove').length, 1)
  h.requests.at(-1).options.success({ statusCode: 206, data: new Uint8Array([0x50, 0x4b, 3, 4]).buffer })
  await retry
  assert.equal(h.downloads.length, 2)
  h.api.cancelDownload()
  h.downloads[1].done(h.downloads[1].task, 200)
  assert.equal(h.state().status, 'found'); assert.equal(h.installs.length, 1)
})

test('更新缓存清理失败时明确阻断并可重试', async () => {
  const cached = { name: '12345678-1234-1234-1234-123456789abc.apk', size: 4, version: '0.6.4', code: 604, url: 'https://github.com/emperorStorm/sui-time/releases/download/v0.6.4/sui-time-0.6.4-android.apk' }
  for (const failure of ['file', 'storage']) {
    const h = await updateHarness(cached)
    h.api.resumeUpdateInstallation()
    if (failure === 'file') h.setRemoveError('无法清理安装包')
    else h.setStorageError(true)
    await h.api.downloadUpdate(true)
    assert.equal(h.state().status, 'download-error')
    assert.match(h.state().message, /无法清理/)
    assert.equal(h.requests.length, 0)
    h.setRemoveError(''); h.setStorageError(false)
    const retry = h.api.downloadUpdate()
    h.requests.at(-1).options.success({ statusCode: 206, data: new Uint8Array([0x50, 0x4b, 3, 4]).buffer })
    await retry
    assert.equal(h.downloads.length, 1)
  }
})

test('失效缓存与旧版路径只清理桥接目录，不删除其他路径', async () => {
  const url = 'https://github.com/emperorStorm/sui-time/releases/download/v0.6.4/sui-time-0.6.4-android.apk'
  const h = await updateHarness({ name: '12345678-1234-1234-1234-123456789abc.apk', size: 4, version: '0.6.4', code: 604, url })
  h.unavailable(); h.api.resumeUpdateInstallation()
  assert.equal(h.state().status, 'download-error'); assert.match(h.state().message, /重新下载/)
  assert.deepEqual(h.calls.map(call => call[0]), ['inspect', 'remove'])
  const retry = h.api.downloadUpdate()
  h.requests.at(-1).options.success({ statusCode: 206, data: new Uint8Array([0x50, 0x4b, 3, 4]).buffer })
  await retry
  assert.equal(h.downloads.length, 1)
  const legacy = await updateHarness({ path: '/用户文件/保留.apk', version: '0.6.4', code: 604, url })
  legacy.api.resumeUpdateInstallation()
  assert.equal(legacy.state().status, 'download-error'); assert.equal(legacy.calls.length, 0)
})

test('下载完成的文件无法读取时不安装，重试重新下载', async () => {
  const h = await updateHarness()
  await found(h); h.stageFail()
  const first = h.api.downloadUpdate()
  h.requests.at(-1).options.success({ statusCode: 206, data: new Uint8Array([0x50, 0x4b, 3, 4]).buffer })
  await first
  h.downloads[0].done(h.downloads[0].task, 200)
  assert.equal(h.state().status, 'download-error'); assert.match(h.state().message, /文件不可读/)
  assert.equal(h.installs.length, 0)
  const retry = h.api.downloadUpdate()
  h.requests.at(-1).options.success({ statusCode: 206, data: new Uint8Array([0x50, 0x4b, 3, 4]).buffer })
  await retry
  assert.equal(h.downloads.length, 2)
})

test('原生提供者仅暴露更新子目录且使用 APK 系统安装器', async () => {
  const manifest = await readFile(new URL('../android-templates/app/src/main/AndroidManifest.template.xml', import.meta.url), 'utf8')
  const paths = await readFile(new URL('../android-templates/app/src/main/res/xml/update_file_paths.xml', import.meta.url), 'utf8')
  const bridge = await readFile(new URL('../android-templates/app/src/main/java/fun/upup/suitime/ApkInstallBridge.java', import.meta.url), 'utf8')
  assert.match(manifest, /\$\{applicationId\}\.updates\.fileprovider/)
  assert.match(manifest, /android:exported="false"\s+android:grantUriPermissions="true"/)
  assert.match(paths, /<files-path name="updates" path="updates\/"\s*\/>/)
  assert.doesNotMatch(paths, /external-path|external-files-path|root-path/)
  assert.match(bridge, /application\/vnd\.android\.package-archive/)
  assert.match(bridge, /FLAG_GRANT_READ_URI_PERMISSION/)
})

test('清单生成仅在完整公开 APK 校验通过后写入，失败保留旧清单', async () => {
  const dir = await mkdtemp(`${tmpdir()}/sui-time-update-test-`)
  try {
    const apk = `${dir}/app.apk`, output = `${dir}/latest.json`
    await writeFile(apk, new Uint8Array([0x50, 0x4b, 3, 4])); await writeFile(output, '旧清单')
    const args = { tag: 'v0.6.2', baseUrl: 'https://package.laoshi.chat', apk, output, manifest: { versionName: '0.6.2', versionCode: 602 }, release: { body: '中文更新说明' } }
    await assert.rejects(generateAndroidUpdate(args, async () => new Response('ApkDownloadForbidden', { status: 400 })), /旧清单保留/)
    assert.equal(await readFile(output, 'utf8'), '旧清单')
    await assert.rejects(generateAndroidUpdate(args, async () => new Response('错误文件')), /不一致/)
    assert.equal(await readFile(output, 'utf8'), '旧清单')
    const result = await generateAndroidUpdate(args, async () => new Response(new Uint8Array([0x50, 0x4b, 3, 4])))
    assert.equal(result.versionCode, 602); assert.equal(result.notes, '中文更新说明')
    assert.equal(result.url, 'https://package.laoshi.chat/sui-time/releases/v0.6.2/sui-time-0.6.2-android.apk')
    const githubArgs = { ...args, downloadUrl: 'https://github.com/emperorStorm/sui-time/releases/download/v0.6.2/sui-time-0.6.2-android.apk' }
    const githubResult = await generateAndroidUpdate(githubArgs, async () => new Response(new Uint8Array([0x50, 0x4b, 3, 4])))
    assert.equal(githubResult.url, githubArgs.downloadUrl)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
