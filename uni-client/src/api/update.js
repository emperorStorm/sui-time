import buildManifest from '../manifest.json'
import { androidPermissions, androidSettings } from './android.js'

export const OSS_BASE_URL = 'https://suisui-package.oss-cn-hangzhou.aliyuncs.com'
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
  // App 服务环境未必提供浏览器 URL 类，直接校验 HTTPS 域名和固定分发路径。
  const url = /^https:\/\/([a-z0-9.-]+)(?::(\d{1,5}))?\/sui-time\/releases\/v\d+\.\d+\.\d+\/[^/?#]+\.apk(?:\?[^#]*)?$/i.exec(manifest.url || '')
  if (!url || url[1].split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) || (url[2] && (Number(url[2]) < 1 || Number(url[2]) > 65535)) || /(^|\.)github(?:usercontent)?\.com$/i.test(url[1])) throw new Error('更新清单必须提供有效的 OSS HTTPS 安装包地址')
  if (manifest.notes !== undefined && typeof manifest.notes !== 'string') throw new Error('更新清单中的更新说明无效')
  return manifest
}

export function checkUpdate() {
  if (checkPromise) return checkPromise
  if (['downloading', 'installing', 'waiting'].includes(state.status)) return Promise.resolve(state)
  const current = installedVersion()
  publish({ status: 'checking', currentVersion: current.version, currentCode: current.code, message: '' })
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
          } catch (error) { resolve(publish({ status: 'error', message: error.message || String(error) })) }
        },
        fail: () => resolve(publish({ status: 'error', message: '无法连接更新服务，请检查网络后重试' }))
      })
      return
    }
    // #endif
    resolve(publish({ status: 'latest' }))
  }).catch(error => publish({ status: 'error', message: error.message || String(error) })).finally(() => { checkPromise = null })
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

export async function downloadUpdate() {
  if (['downloading', 'installing'].includes(state.status) || !state.downloadUrl) return
  if (downloaded?.url === state.downloadUrl) { installDownloaded(); return }
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.os?.name === 'Android') {
    const token = ++generation
    publish({ status: 'downloading', progress: 0, downloadedBytes: 0, totalBytes: 0, message: '' })
    try {
      if (!await verifyDownload(state.downloadUrl, token) || token !== generation) return
      downloadTask = plus.downloader.createDownload(state.downloadUrl, { filename: `_doc/updates/sui-time-${state.latestVersion}-${state.latestCode}.apk`, retry: 1, timeout: 30 }, (task, status) => {
        if (token !== generation) return
        downloadTask = null
        const rangeSize = Number(/\/(\d+)$/.exec(task.getResponseHeader?.('Content-Range') || '')?.[1] || 0)
        const expectedSize = status === 206 ? rangeSize : task.totalSize
        // 删除下载任务以释放 SDK 回调；完成文件保留供安装和授权往返复用。
        task.abort()
        if (![200, 206].includes(status) || task.downloadedSize < 4 || (status === 206 && !rangeSize) || (expectedSize > 0 && task.downloadedSize !== expectedSize)) { publish({ status: 'download-error', message: `下载未完成（HTTP ${status}），请重试或使用浏览器下载` }); return }
        downloaded = { url: state.downloadUrl, path: task.filename, version: state.latestVersion, code: state.latestCode }
        try { uni.setStorageSync(CACHE_KEY, downloaded) } catch { /* 缓存失败不影响本次安装。 */ }
        publish({ status: 'ready', progress: 100 })
        installDownloaded()
      })
      downloadTask.addEventListener('statechanged', task => {
        if (token !== generation) return
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
  generation++
  preflightRequest?.abort()
  preflightRequest = null
  downloadTask?.abort()
  downloadTask = null
  waitingForPermission = false
  publish({ status: 'found', message: '', progress: 0 })
}

export function installDownloaded() {
  if (!downloaded || state.status === 'installing') return
  try {
    if (!androidPermissions().install) {
      waitingForPermission = true
      publish({ status: 'waiting', message: '安装包已下载。请允许“安装未知应用”，返回后继续安装。' })
      androidSettings('install')
      return
    }
    waitingForPermission = false
    publish({ status: 'installing', message: '正在打开系统安装界面，请确认安装' })
    plus.runtime.install(downloaded.path, {}, () => publish({ status: 'waiting', message: '已交给系统安装，请完成确认。若取消，可点击重新安装。' }), error => publish({ status: 'ready', message: `安装未完成：${error.message || '请重试'}` }))
    // 部分安卓系统不回调 APK 安装结果，不把唤起安装当作升级成功。
    if (state.status === 'installing') publish({ status: 'waiting' })
  } catch (error) { publish({ status: 'ready', message: error.message || String(error) }) }
}

export function resumeUpdateInstallation() {
  try {
    if (!downloaded) downloaded = uni.getStorageSync(CACHE_KEY) || null
    if (!downloaded) return
    const current = installedVersion()
    if ((downloaded.code && current.code >= downloaded.code) || (!downloaded.code && compareVersions(current.version, downloaded.version) >= 0)) {
      const oldPath = downloaded.path
      downloaded = null; waitingForPermission = false
      uni.removeStorageSync(CACHE_KEY)
      // #ifdef APP-PLUS
      if (typeof plus !== 'undefined' && /^_doc\/updates\//.test(oldPath)) plus.io.resolveLocalFileSystemURL(oldPath, entry => entry.remove(() => {}, () => {}), () => {})
      // #endif
      publish({ status: 'latest', currentVersion: current.version, currentCode: current.code })
    } else if (waitingForPermission && androidPermissions().install) installDownloaded()
    else if (state.status === 'idle') publish({ status: 'ready', latestVersion: downloaded.version, latestCode: downloaded.code, downloadUrl: downloaded.url, message: '上次下载的安装包已保留，可继续安装' })
  } catch (error) { publish({ status: 'error', message: error.message || String(error) }) }
}

export function openUpdateInBrowser() {
  if (!state.downloadUrl) return
  try { validateUpdateManifest({ version: state.latestVersion, url: state.downloadUrl }); plus.runtime.openURL(state.downloadUrl, error => publish({ message: error.message || '无法打开下载地址' })) }
  catch (error) { publish({ message: error.message || String(error) }) }
}
