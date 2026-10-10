import { cancelAll, isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import {
  clearNativeReminders,
  getNativeReminderPermission,
  isTauriRuntime,
  listTasks,
  openNativeReminderNotificationSettings,
  replaceNativeReminders,
  requestNativeReminderPermission,
  sendNativeReminderTestNotification,
  type NativeReminderRequest,
  type ReminderPermission,
  type ReminderPermissionResult
} from '../api/native'
import type { Task } from '../types'
import { tasksForDate } from '../utils/task-occurrence'

const SCHEDULE_HORIZON = 48 * 60 * 60_000
const SYNC_INTERVAL = 15 * 60_000
// 登录切换时，旧用户的清理必须排在新用户的排程之前。
let reminderWork: Promise<unknown> = Promise.resolve()

function queueReminderWork(operation: () => Promise<void>) {
  const work = reminderWork.then(operation)
  reminderWork = work.catch(() => {})
  return work
}

export { type ReminderPermission, type ReminderPermissionResult }

export async function getReminderPermission(): Promise<ReminderPermissionResult> {
  if (!isTauriRuntime()) return { status: 'unsupported' }
  const nativePermission = await getNativeReminderPermission()
  if (nativePermission.status !== 'unsupported') return nativePermission
  return { status: await isPermissionGranted() ? 'granted' : 'denied' }
}

export async function requestReminderPermission(): Promise<ReminderPermissionResult> {
  if (!isTauriRuntime()) return { status: 'unsupported' }
  const nativePermission = await requestNativeReminderPermission()
  if (nativePermission.status !== 'unsupported') return nativePermission
  if (await isPermissionGranted()) return { status: 'granted' }
  return { status: await requestPermission() === 'granted' ? 'granted' : 'denied' }
}

export async function openReminderNotificationSettings() {
  await openNativeReminderNotificationSettings()
}

export async function sendReminderTestNotification() {
  const nativePermission = await getNativeReminderPermission()
  if (nativePermission.status !== 'unsupported') {
    if (nativePermission.status !== 'granted') throw new Error(nativePermission.detail || '请先允许系统通知')
    return sendNativeReminderTestNotification()
  }
  await sendNotification({ title: '岁岁时光通知测试', body: '系统提醒已经准备就绪。' })
}

export function createTaskReminderScheduler(userId: string, onError?: (message: string) => void, onPermission?: (result: ReminderPermissionResult) => void) {
  let syncing = false
  let stopped = true
  let revision = 0
  let intervalId: number | undefined
  let lastError = ''

  async function sync() {
    if (stopped || !isTauriRuntime()) return
    revision += 1
    if (syncing) return
    syncing = true
    const currentRevision = revision
    try {
      await queueReminderWork(async () => {
        if (stopped || currentRevision !== revision) return
        const nativePermission = await getNativeReminderPermission()
        if (stopped || currentRevision !== revision) return
        if (nativePermission.status !== 'unsupported') {
          onPermission?.(nativePermission)
          if (nativePermission.status !== 'granted') {
            await clearNativeReminders()
            if (nativePermission.status === 'error') throw new Error(nativePermission.detail || '无法读取系统通知权限')
            return
          }
          const tasks = await listTasks({ includeCompleted: false })
          if (stopped || currentRevision !== revision) return
          await replaceNativeReminders(createNativeReminderRequests(userId, tasks, Date.now()))
        } else {
          await cancelAll()
          if (stopped || currentRevision !== revision || (await getReminderPermission()).status !== 'granted') return
          const now = Date.now()
          const tasks = await listTasks({ includeCompleted: false })
          if (stopped || currentRevision !== revision) return
          for (const date of reminderDates(now)) for (const item of tasksForDate(tasks, date)) sendFallbackReminders(item, date, now)
        }
      })
      lastError = ''
    } catch (error) {
      const message = formatError(error)
      if (!stopped && message !== lastError) onError?.(message)
      lastError = message
    } finally {
      syncing = false
      if (!stopped && currentRevision !== revision) void sync()
    }
  }

  function start() {
    if (!stopped) return
    stopped = false
    revision += 1
    void sync()
    intervalId = window.setInterval(sync, SYNC_INTERVAL)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', syncOnVisible)
  }

  function stop() {
    if (stopped) return
    stopped = true
    revision += 1
    window.clearInterval(intervalId)
    window.removeEventListener('focus', sync)
    document.removeEventListener('visibilitychange', syncOnVisible)
    if (!isTauriRuntime()) return
    // 立即入队，不能在异步权限查询结束后才入队清理。
    void queueReminderWork(async () => {
      const permission = await getNativeReminderPermission()
      if (permission.status === 'unsupported') await cancelAll()
      else await clearNativeReminders()
    }).catch(error => onError?.(formatError(error)))
  }

  function syncOnVisible() {
    if (document.visibilityState === 'visible') void sync()
  }

  return { start, stop, sync }
}

function createNativeReminderRequests(userId: string, tasks: Task[], now: number): NativeReminderRequest[] {
  const requests: NativeReminderRequest[] = []
  for (const date of reminderDates(now)) {
    for (const item of tasksForDate(tasks, date)) {
      if (item.status !== 'todo' || !item.plannedTime || item.scheduleKind === 'all_day' || item.parentTaskId) continue
      const plannedAt = new Date(`${date}T${item.plannedTime}:00`).getTime()
      for (const offset of item.reminderOffsets) {
        const triggerAt = plannedAt - offset * 60_000
        if (triggerAt <= now || triggerAt > now + SCHEDULE_HORIZON) continue
        requests.push({
          identifier: `sui-time:${userId}:${item.id}:${date}:${offset}:${triggerAt}`,
          title: offset ? `提前 ${formatOffset(offset)}：${item.title}` : item.title,
          body: `${date.slice(5).replace('-', '月')}日 ${item.plannedTime}`,
          triggerAt
        })
      }
    }
  }
  return requests.sort((left, right) => left.triggerAt - right.triggerAt)
}

function sendFallbackReminders(item: Task, date: string, now: number) {
  if (item.status !== 'todo' || !item.plannedTime || item.parentTaskId) return
  const plannedAt = new Date(`${date}T${item.plannedTime}:00`).getTime()
  for (const offset of item.reminderOffsets) {
    const triggerAt = plannedAt - offset * 60_000
    if (triggerAt <= now || triggerAt > now + SCHEDULE_HORIZON) continue
    void sendNotification({
      title: offset ? `提前 ${formatOffset(offset)}：${item.title}` : item.title,
      body: `${date.slice(5).replace('-', '月')}日 ${item.plannedTime}`
    })
  }
}

function reminderDates(now: number) {
  const dates: string[] = []
  const cursor = new Date(now)
  cursor.setHours(12, 0, 0, 0)
  for (let index = 0; index < 3; index += 1) {
    dates.push(dateString(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function formatOffset(offset: number) {
  return offset >= 60 ? `${offset / 60}小时` : `${offset}分钟`
}

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatError(error: unknown) {
  const message = String(error).replace(/^Error:\s*/, '')
  return message || '系统提醒同步失败，请检查通知权限后重试'
}
