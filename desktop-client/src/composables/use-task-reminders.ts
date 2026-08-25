import { cancelAll, isPermissionGranted, requestPermission, Schedule, sendNotification } from '@tauri-apps/plugin-notification'
import { listTasks, isTauriRuntime } from '../api/native'
import type { Task } from '../types'
import { tasksForDate } from '../utils/task-occurrence'

const SCHEDULE_HORIZON = 48 * 60 * 60_000

type ReminderPermission = 'granted' | 'denied' | 'unsupported'

export async function getReminderPermission(): Promise<ReminderPermission> {
  if (!isTauriRuntime()) return 'unsupported'
  return await isPermissionGranted() ? 'granted' : 'denied'
}

export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (!isTauriRuntime()) return 'unsupported'
  if (await isPermissionGranted()) return 'granted'
  return await requestPermission() === 'granted' ? 'granted' : 'denied'
}

export function createTaskReminderScheduler(_userId: string) {
  let syncing = false
  let stopped = false
  let revision = 0

  async function sync() {
    if (syncing || stopped || !isTauriRuntime()) return
    syncing = true
    const currentRevision = revision
    try {
      await cancelAll()
      if (stopped || currentRevision !== revision || await getReminderPermission() !== 'granted') return
      const now = Date.now()
      const tasks = await listTasks({ includeCompleted: false })
      if (stopped || currentRevision !== revision) return
      for (const date of reminderDates(now)) for (const item of tasksForDate(tasks, date)) scheduleItemReminders(item, date, now)
    } catch {
      // 自动同步失败时等待下一次事项变化或窗口恢复后重试。
    } finally {
      syncing = false
      if (!stopped && currentRevision !== revision) void sync()
    }
  }

  function start() {
    stopped = false
    revision += 1
    void sync()
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', syncOnVisible)
  }

  function stop() {
    stopped = true
    revision += 1
    window.removeEventListener('focus', sync)
    document.removeEventListener('visibilitychange', syncOnVisible)
    if (isTauriRuntime()) void cancelAll()
  }

  function syncOnVisible() {
    if (document.visibilityState === 'visible') void sync()
  }

  return { start, stop, sync }
}

function scheduleItemReminders(item: Task, date: string, now: number) {
  if (item.status !== 'todo' || !item.plannedDate || !item.plannedTime || item.parentTaskId) return
  const plannedAt = new Date(`${date}T${item.plannedTime}:00`).getTime()
  for (const offset of item.reminderOffsets) {
    const triggerAt = plannedAt - offset * 60_000
    if (triggerAt <= now || triggerAt > now + SCHEDULE_HORIZON) continue
    sendNotification({
      title: offset ? `提前 ${formatOffset(offset)}：${item.title}` : `现在开始：${item.title}`,
      body: `${date.slice(5).replace('-', '月')}日 ${item.plannedTime}`,
      schedule: Schedule.at(new Date(triggerAt))
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
