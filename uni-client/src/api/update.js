import buildManifest from '../manifest.json'
import { androidPermissions, androidSettings, androidUpdate } from './android.js'

export const OSS_BASE_URL = 'https://package.laoshi.chat'
export const APP_VERSION = buildManifest.versionName
const MANIFEST_URL = `${OSS_BASE_URL}/sui-time/latest-android.json`
const CACHE_KEY = 'sui-time:downloaded-update'
const listeners = new Set()
let state = { status: 'idle', currentVersion: APP_VERSION, currentCode: Number(buildManifest.versionCode), progress: 0, message: '' }
let checkPromise = null
let downloadTask = null
let preflightRequest = null
let generation = 0
let downloaded = null
let waitingForPermission = false
let installing = false

function validCache(item) {
  try {
    if (!item || !/^[0-9a-f-]{36}\.apk$/.test(item.name || '') || !Number.isSafeInteger(item.size) || item.size < 4) return false
    validateUpdateManifest({ version: item.version, versionCode: item.code || undefined, url: item.url })
    return true
  } catch { return false }
}

function discardCache(item = downloaded) {
  if (validCache(item)) {
    const result = androidUpdate('remove', item.name)
    if (!result.ok) throw new Error(result.message || '无法清理安装包缓存')
  }
  try { uni.removeStorageSync(CACHE_KEY) } catch { throw new Error('无法清理安装包缓存记录，请重试') }
  downloaded = null
  waitingForPermission = false
}

function inspectCache(item) {
  if (!validCache(item)) return { ok: false, message: '安装包缓存已失效，请重新下载' }
  return androidUpdate('inspect', item.name, String(item.size))
}

function cacheFailed(message) {
  let detail = message || '安装包缓存已失效'
  let action = '请重新下载或使用浏览器下载'
  try { discardCache() } catch (error) { detail += `；${error.message || String(error)}`; action = '请重试或使用浏览器下载' }
  publish({ status: 'download-error', message: `${detail}，${action}` })
}

function publish(patch) { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); return state }
export function subscribeUpdate(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener) }

export function installedVersion() {
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.runtime) return { version: plus.runtime.version || APP_VERSION, code: Number(plus.runtime.versionCode || buildManifest.versionCode) }
  // #endif
  return { version: APP_VERSION, code: Number(buildManifest.versionCode) }
}

export function compareVersions(a, b) {
  const left = String(a).replace(/^v/, '').split('.').map(Number)
  const right = String(b).replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}

export function validateUpdateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || !/^\d+\.\d+\.\d+$/.test(manifest.version || '')) throw new Error('更新清单格式错误，请稍后重试')
  if (manifest.versionCode !== undefined && (!/^[1-9]\d*$/.test(String(manifest.versionCode)) || !Number.isSafeInteger(Number(manifest.versionCode)))) throw new Error('更新清单中的版本码无效')
  // OSS 默认域名禁止公开 APK，因此同时允许官方 GitHub Release 资产作为兜底分发地址。
  const url = String(manifest.url || '')
  const ossUrl = /^https:\/\/([a-z0-9.-]+)(?::(\d{1,5}))?\/sui-time\/releases\/v\d+\.\d+\.\d+\/[^/?#]+\.apk(?:\?[^#]*)?$/i.exec(url)
  const githubUrl = /^https:\/\/github\.com\/emperorStorm\/sui-time\/releases\/download\/v\d+\.\d+\.\d+\/sui-time-\d+\.\d+\.\d+-android\.apk(?:\?[^#]*)?$/i.test(url)
  if (!ossUrl && !githubUrl) throw new Error('更新清单必须提供有效的 OSS 或官方 GitHub Release HTTPS 安装包地址')
  if (ossUrl && (/((^|\.)github(?:usercontent)?\.com)$/i.test(ossUrl[1]) || ossUrl[1].split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) || (ossUrl[2] && (Number(ossUrl[2]) < 1 || Number(ossUrl[2]) > 65535)))) throw new Error('更新清单中的 OSS 安装包地址无效')
  if (manifest.notes !== undefined && typeof manifest.notes !== 'string') throw new Error('更新清单中的更新说明无效')
  return manifest
}

export function checkUpdate() {
  if (checkPromise) return checkPromise
  if (['downloading', 'installing', 'waiting'].includes(state.status)) return Promise.resolve(state)
  const current = installedVersion()
  const cached = validCache(downloaded) && downloaded.version &&
    (downloaded.code ? current.code < downloaded.code : compareVersions(current.version, downloaded.version) < 0) ? downloaded : null
  const checkFailed = message => publish(cached && downloaded === cached
    ? { status: 'ready', latestVersion: cached.version, latestCode: cached.code, downloadUrl: cached.url, checkError: true, message: `检查更新失败：${message}。可尝试安装已下载的安装包。` }
    : { status: 'error', checkError: true, message })
  publish({ status: 'checking', currentVersion: current.version, currentCode: current.code, message: '', checkError: false })
  checkPromise = new Promise(resolve => {
    // #ifdef APP-PLUS
    if (typeof plus !== 'undefined' && plus.os?.name === 'Android') {
      uni.request({
        url: `${MANIFEST_URL}?t=${Date.now()}`, timeout: 10000,
        success: response => {
          try {
            if (response.statusCode !== 200) throw new Error(`更新检查失败（HTTP ${response.statusCode}）`)
            const manifest = validateUpdateManifest(response.data)
            const newer = manifest.versionCode !== undefined ? Number(manifest.versionCode) > current.code : compareVersions(manifest.version, current.version) > 0
            resolve(publish(newer ? { status: 'found', latestVersion: manifest.version, latestCode: Number(manifest.versionCode || 0), notes: manifest.notes || '修复已知问题，优化使用体验。', downloadUrl: manifest.url } : { status: 'latest' }))
          } catch (error) { resolve(checkFailed(error.message || String(error))) }
        },
        fail: () => resolve(checkFailed('无法连接更新服务，请检查网络后重试'))
      })
      return
    }
    // #endif
    resolve(publish({ status: 'latest' }))
  }).catch(error => checkFailed(error.message || String(error))).finally(() => { checkPromise = null })
  return checkPromise
}

function verifyDownload(url, token) {
  return new Promise((resolve, reject) => {
    preflightRequest = uni.request({
      url, timeout: 15000, header: { Range: 'bytes=0-3' }, responseType: 'arraybuffer',
      success: response => {
        if (token !== generation) { resolve(false); return }
        if (![200, 206].includes(response.statusCode)) {
          const reason = response.statusCode === 404 ? '安装包已失效，请稍后重新检查更新。' : response.statusCode === 403 ? '下载服务未允许访问安装包，请稍后重试。' : '下载服务拒绝安装包请求，请维护者核对下载域名和分发配置。'
          reject(new Error(`下载失败（HTTP ${response.statusCode}）。${reason}`)); return
        }
        const bytes = new Uint8Array(response.data)
        if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) { reject(new Error('下载地址未返回有效 APK，请检查 OSS 分发配置')); return }
        resolve(true)
      },
      fail: () => token === generation ? reject(new Error('无法连接安装包下载地址，请检查网络后重试')) : resolve(false),
      complete: () => { if (token === generation) preflightRequest = null }
    })
  })
}

export async function downloadUpdate(force = false) {
  if (['downloading', 'installing', 'waiting'].includes(state.status) || installing || !state.downloadUrl) return
  if (downloaded?.url === state.downloadUrl && !force && state.status !== 'download-error') { installDownloaded(); return }
  if (downloaded) {
    try { discardCache() }
    catch (error) { publish({ status: 'download-error', message: `${error.message || String(error)}，请重试或使用浏览器下载` }); return }
  }
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.os?.name === 'Android') {
    const token = ++generation
    publish({ status: 'downloading', progress: 0, downloadedBytes: 0, totalBytes: 0, message: '' })
    try {
      if (!await verifyDownload(state.downloadUrl, token) || token !== generation) return
      let completed = false
      downloadTask = plus.downloader.createDownload(state.downloadUrl, { filename: `_doc/updates/sui-time-${state.latestVersion}-${state.latestCode}.apk`, retry: 1, timeout: 30 }, (task, status) => {
        if (token !== generation || completed) return
        completed = true
        downloadTask = null
        let staged = false
        try {
          const { filename, downloadedSize, totalSize } = task
          const contentRange = task.getResponseHeader?.('Content-Range') || ''
          const range = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(contentRange.trim())
          const expectedSize = status === 206 ? Number(range?.[3] || 0) : totalSize
          console.info('[SuiTimeUpdate] download', { status, filename, downloadedSize, totalSize, contentRange })
          if (![200, 206].includes(status) || !Number.isSafeInteger(downloadedSize) || downloadedSize < 4 ||
            (status === 206 && (!range || Number(range[1]) > Number(range[2]) || Number(range[2]) !== expectedSize - 1)) ||
            (expectedSize > 0 && downloadedSize !== expectedSize)) throw new Error(`下载未完成（HTTP ${status}）`)
          const source = plus.io.convertLocalFileSystemURL(filename)
          const directory = plus.io.convertLocalFileSystemURL('_doc/updates/')
          if (!source || !directory) throw new Error('无法解析下载文件路径')
          const result = androidUpdate('stage', source, directory, String(downloadedSize))
          if (!result.ok) throw new Error(result.message || '无法读取下载的安装包')
          downloaded = { url: state.downloadUrl, name: result.name, size: Number(result.size), version: state.latestVersion, code: state.latestCode }
          if (!validCache(downloaded)) throw new Error('安装包缓存信息无效')
          try { uni.setStorageSync(CACHE_KEY, downloaded) } catch { /* 缓存失败不影响本次安装。 */ }
          staged = true
        } catch (error) {
          cacheFailed(error.message || '无法读取下载的安装包')
        } finally {
          // SDK 的 abort 会异步删除源 APK，必须先完成私有缓存转存。
          try { task.abort() } catch (error) { console.error('[SuiTimeUpdate] release', error) }
        }
        if (staged) {
          publish({ status: 'ready', progress: 100 })
          installDownloaded()
        }
      })
      downloadTask.addEventListener('statechanged', task => {
        if (token !== generation || completed) return
        publish({ downloadedBytes: task.downloadedSize || 0, totalBytes: task.totalSize || 0, progress: task.totalSize ? Math.min(99, Math.floor(task.downloadedSize / task.totalSize * 100)) : 0 })
      })
      downloadTask.start()
    } catch (error) {
      if (token === generation) {
        downloadTask?.abort(); downloadTask = null
        publish({ status: 'download-error', message: error.message || String(error) })
      }
    }
    return
  }
  // #endif
  publish({ status: 'download-error', message: '仅安卓安装包支持应用内下载安装' })
}

export function cancelDownload() {
  if (state.status !== 'downloading') return
  generation++
  preflightRequest?.abort()
  preflightRequest = null
  downloadTask?.abort()
  downloadTask = null
  waitingForPermission = false
  publish({ status: 'found', message: '', progress: 0 })
}

export function installDownloaded() {
  if (!downloaded || installing || waitingForPermission || state.status === 'waiting') return
  installing = true
  try {
    const inspected = inspectCache(downloaded)
    if (!inspected.ok) { cacheFailed(inspected.message); return }
    if (!androidPermissions().install) {
      waitingForPermission = true
      publish({ status: 'waiting', message: '安装包已下载。请允许“安装未知应用”，返回后继续安装。' })
      androidSettings('install')
      return
    }
    publish({ status: 'installing', message: '正在打开系统安装界面，请确认安装' })
    const result = androidUpdate('install', downloaded.name, String(downloaded.size))
    if (!result.ok) {
      const recheck = inspectCache(downloaded)
      if (!recheck.ok) cacheFailed(recheck.message)
      else publish({ status: 'ready', message: `无法打开系统安装界面：${result.message || '请重试'}` })
      return
    }
    publish({ status: 'waiting', message: '已打开系统安装界面，请确认安装；返回后可重新安装。' })
  } catch (error) {
    waitingForPermission = false
    publish({ status: 'ready', message: `安装未完成：${error.message || String(error)}` })
  } finally { installing = false }
}

export function resumeUpdateInstallation() {
  if (installing || ['downloading', 'installing'].includes(state.status)) return
  try {
    if (!downloaded) downloaded = uni.getStorageSync(CACHE_KEY) || null
    if (!downloaded) return
    if (!validCache(downloaded)) {
      const previous = downloaded
      try { uni.removeStorageSync(CACHE_KEY) } catch { throw new Error('无法清理旧版更新缓存记录，请重试') }
      downloaded = null
      if (previous.version && previous.url) {
        try {
          validateUpdateManifest({ version: previous.version, versionCode: previous.code || undefined, url: previous.url })
          publish({ status: 'download-error', latestVersion: previous.version, latestCode: previous.code, downloadUrl: previous.url, message: '旧版安装包缓存不可继续使用，请重新下载' })
        } catch { publish({ status: 'error', message: '安装包缓存无效，请重新检查更新' }) }
      } else publish({ status: 'error', message: '安装包缓存无效，请重新检查更新' })
      return
    }
    const current = installedVersion()
    if ((downloaded.code && current.code >= downloaded.code) || (!downloaded.code && compareVersions(current.version, downloaded.version) >= 0)) {
      discardCache()
      publish({ status: 'latest', currentVersion: current.version, currentCode: current.code, message: '' })
      return
    }
    const inspected = inspectCache(downloaded)
    if (!inspected.ok) {
      publish({ latestVersion: downloaded.version, latestCode: downloaded.code, downloadUrl: downloaded.url })
      cacheFailed(inspected.message)
      return
    }
    if (waitingForPermission) {
      waitingForPermission = false
      if (androidPermissions().install) {
        publish({ status: 'ready' })
        installDownloaded()
      } else publish({ status: 'ready', message: '未获得安装未知应用权限，可授权后重试或使用浏览器下载。' })
    } else if (state.status === 'waiting') {
      publish({ status: 'ready', message: '已返回应用，尚未检测到新版本；如已取消安装可重新安装。' })
    } else if (state.status === 'idle') {
      publish({ status: 'ready', latestVersion: downloaded.version, latestCode: downloaded.code, downloadUrl: downloaded.url, message: '上次下载的安装包已保留，可继续安装' })
    }
  } catch (error) { publish({ status: 'error', message: error.message || String(error) }) }
}

export function openUpdateInBrowser() {
  if (!state.downloadUrl) return
  try { validateUpdateManifest({ version: state.latestVersion, url: state.downloadUrl }); plus.runtime.openURL(state.downloadUrl, error => publish({ message: error.message || '无法打开下载地址' })) }
  catch (error) { publish({ message: error.message || String(error) }) }
}
