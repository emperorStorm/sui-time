import { reactive } from 'vue'

// 仅诊断构建（SUI_DIAG=1）启用，正式包编译为 false 并被摇树移除。
export const diagEnabled = typeof __SUI_DIAG__ !== 'undefined' && __SUI_DIAG__

export const diag = reactive({ ua: '', engine: '', version: '', errors: [], events: [], open: false, installed: false })

const stamp = () => new Date().toTimeString().slice(0, 8)

function push(list, line, limit) {
  list.push(line)
  if (list.length > limit) list.shift()
}

export function diagLog(label, detail) {
  if (!diagEnabled) return
  push(diag.events, `${stamp()} ${label}${detail ? ' | ' + detail : ''}`, 120)
}

export function diagError(label, cause) {
  if (!diagEnabled) return
  const detail = cause?.stack || cause?.message || String(cause)
  push(diag.errors, `${stamp()} ${label}: ${detail}`.slice(0, 600), 40)
  diag.open = true
}

export function installDiagnostics() {
  if (!diagEnabled || diag.installed) return
  diag.installed = true
  try {
    diag.ua = (typeof plus !== 'undefined' && plus.navigator?.getUserAgent?.()) || navigator.userAgent || ''
  } catch (cause) { diag.ua = '' }
  diag.engine = (diag.ua.match(/Chrome\/(\d+)/) || [])[1] || 'unknown'
  try {
    diag.version = typeof plus !== 'undefined' && plus.runtime
      ? `${plus.runtime.version} (${plus.runtime.versionCode})`
      : (uni.getSystemInfoSync?.().appVersion || 'H5')
  } catch (cause) { diag.version = '读取失败' }
  window.addEventListener('error', event => diagError('error', event.error || event.message))
  window.addEventListener('unhandledrejection', event => diagError('rejection', event.reason))
  const originalError = console.error
  console.error = (...args) => {
    diagError('console.error', args.map(arg => arg?.stack || arg?.message || String(arg)).join(' '))
    originalError.apply(console, args)
  }
  document.addEventListener('click', event => {
    const path = []
    let node = event.target
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) path.push(node.className || node.tagName)
    diagLog('click', path.join(' < '))
  }, true)
  document.addEventListener('touchstart', event => {
    const node = event.target
    diagLog('touchstart', `${node?.className || node?.tagName} touches=${event.touches?.length ?? '?'}`)
  }, true)
}
