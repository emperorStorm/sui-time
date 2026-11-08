import { androidCall, androidPermissions } from './android.js'

let latestSnapshot = '[]'
let revision = 0
let running = null
let lastResult = { supported: false, warnings: [] }
const listeners = new Set()

function publish() {
  for (const listener of listeners) {
    try { listener(reminderState()) } catch (error) { console.error('更新提醒状态失败', error) }
  }
}

export function subscribeReminderState(listener) {
  listeners.add(listener)
  listener(reminderState())
  return () => listeners.delete(listener)
}

export function syncTaskReminders(tasks) {
  latestSnapshot = JSON.stringify(tasks.filter(task => !task.parentTaskId))
  revision++
  if (running) return running
  running = Promise.resolve().then(async () => {
    let completed
    do {
      completed = revision
      try {
        const result = androidCall('ReminderBridge', 'replace', latestSnapshot)
        const next = result ? JSON.parse(result) : { supported: false }
        // 失败或权限不足时原生可能无法重新计算，保留上次已知的受影响事项。
        const retain = !!next.error || (next.supported && (!next.notifications || !next.exactAlarm) && !Array.isArray(next.warnings))
        const incoming = Array.isArray(next.warnings) ? next.warnings.map(item => ({ ...item })) : []
        const warnings = retain ? [...lastResult.warnings.filter(old => !incoming.some(item => item.id === old.id)), ...incoming] : incoming
        lastResult = { ...next, warnings, warningsStale: retain, scheduleReady: !!(next.supported && next.notifications && next.exactAlarm && !next.error) }
      } catch (error) {
        lastResult = { supported: true, error: error.message || String(error), warnings: lastResult.warnings, warningsStale: true }
      }
      if (completed === revision) publish()
    } while (completed !== revision)
    return { ...lastResult, warnings: lastResult.warnings.map(item => ({ ...item })) }
  }).finally(() => { running = null })
  return running
}

export function reminderState() {
  try {
    const permissions = androidPermissions()
    if (permissions.supported && (permissions.error || !permissions.notifications || !permissions.exactAlarm)) lastResult.scheduleReady = false
    return { ...lastResult, ...permissions, error: lastResult.error || permissions.error, warnings: lastResult.warnings.map(item => ({ ...item })) }
  } catch (error) { return { ...lastResult, supported: true, error: lastResult.error || error.message || String(error), warnings: lastResult.warnings.map(item => ({ ...item })) } }
}

export function reminderSummary(state) {
  const known = state.warnings?.length ? `；另有 ${state.warnings.length} 项已知不支持` : ''
  if (state.error) return `提醒排程出错：${state.error}${known}`
  if (!state.supported) return '仅安卓客户端支持系统提醒'
  if (!state.notifications || !state.exactAlarm) return `提醒未安排：请开启通知和准时提醒权限${known}`
  if (state.warnings?.length) return `${state.warnings.length} 项重复规则暂不支持安卓提醒`
  if (!state.scheduleReady || typeof state.scheduled !== 'number') return '提醒状态待同步'
  return `已安排 ${state.scheduled} 个提醒；实际送达受系统设置影响`
}

export function reminderSaveMessage(result, needsReminder = true) {
  const parts = []
  if (result?.error) parts.push(`提醒排程失败：${result.error}`)
  else if (result?.supported && needsReminder && (!result.notifications || !result.exactAlarm)) parts.push('需开启通知和准时提醒权限')
  if (result?.warnings?.length) parts.push(`${result.warnings.length} 项重复规则暂不支持安卓提醒，请查看提醒状态`)
  return parts.length ? `事项已保存，${parts.join('；')}` : ''
}

export function sendReminderTest() {
  const result = androidCall('ReminderBridge', 'test')
  if (!result) throw new Error('仅安卓客户端支持系统提醒')
  const state = JSON.parse(result)
  if (state.error) throw new Error(state.error)
}
