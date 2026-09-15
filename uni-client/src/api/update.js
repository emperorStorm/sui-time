import { toast } from '../utils/platform'

// 与 GitHub Variables ALIYUN_OSS_BASE_URL 保持一致
export const OSS_BASE_URL = 'https://suisui-package.oss-cn-hangzhou.aliyuncs.com'
const UPDATE_MANIFEST_URL = `${OSS_BASE_URL}/sui-time/latest-android.json`
const GITHUB_REPOSITORY = 'emperorStorm/sui-time'
const GITHUB_REQUEST_TIMEOUT = 8000

export const APP_VERSION = '0.5.0'

function parseVersion(value) {
  const parts = String(value || '').replace(/^v/, '').split('.')
  return parts.reduce((sum, part, index) => sum + Number(part || 0) * Math.pow(100, 2 - index), 0)
}

function semverGt(a, b) {
  return parseVersion(a) > parseVersion(b)
}

function getUpdateCommits(currentVersion, latestVersion) {
  return new Promise((resolve) => {
    if (typeof fetch !== 'function') return resolve('')
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => controller && controller.abort(), GITHUB_REQUEST_TIMEOUT)
    fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/compare/v${currentVersion}...v${latestVersion}`, {
      signal: controller ? controller.signal : undefined
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.status))))
      .then((data) => {
        const messages = (data.commits || []).map((item) => `· ${item.commit.message.split('\n')[0]}`)
        resolve(messages.join('\n'))
      })
      .catch(() => resolve(''))
      .finally(() => clearTimeout(timer))
  })
}

// 返回 { status: 'latest' } 或 { status: 'found', latestVersion, notes, downloadUrl }
export function checkUpdate() {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    uni.request({
      url: UPDATE_MANIFEST_URL,
      timeout: 8000,
      success: async (res) => {
        const manifest = res.data
        if (!manifest || !manifest.version || !semverGt(manifest.version, APP_VERSION)) {
          resolve({ status: 'latest' })
          return
        }
        let notes = manifest.notes || ''
        if (!notes) {
          const commits = await getUpdateCommits(APP_VERSION, manifest.version)
          if (commits) notes = commits
        }
        resolve({ status: 'found', latestVersion: manifest.version, notes, downloadUrl: manifest.url })
      },
      fail: () => resolve({ status: 'latest' })
    })
    return
    // #endif
    resolve({ status: 'latest' })
  })
}

export function downloadUpdate(url) {
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.runtime && plus.runtime.openURL) {
    plus.runtime.openURL(url)
    toast('已在浏览器打开下载页')
    return
  }
  // #endif
  if (typeof window !== 'undefined' && window.open) {
    window.open(url, '_blank')
    toast('已在浏览器打开下载页')
  }
}
