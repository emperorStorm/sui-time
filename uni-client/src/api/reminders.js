import { androidCall, androidPermissions } from './android.js'

let latestSnapshot = '[]'
let revision = 0
let running = null
let lastResult = { supported: false }

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
        lastResult = result ? JSON.parse(result) : { supported: false }
      } catch (error) { lastResult = { supported: true, error: error.message || String(error) } }
    } while (completed !== revision)
    return lastResult
  }).finally(() => { running = null })
  return running
}

export function reminderState() {
  try { return { ...lastResult, ...androidPermissions() } } catch (error) { return { supported: true, error: error.message || String(error) } }
}

export function sendReminderTest() {
  const result = androidCall('ReminderBridge', 'test')
  if (!result) throw new Error('仅安卓客户端支持系统提醒')
  const state = JSON.parse(result)
  if (state.error) throw new Error(state.error)
}
