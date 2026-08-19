import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { listTasks, isTauriRuntime } from '../api/native'
import type { Task } from '../types'
import { tasksForDate } from '../utils/task-occurrence'

const CHECK_INTERVAL = 30_000
const DELIVERY_GRACE = 15 * 60_000
const DELIVERY_RETENTION = 7 * 24 * 60 * 60_000

type ReminderPermission = 'granted' | 'denied' | 'unsupported'
type DeliveryLog = Record<string, number>

export async function getReminderPermission(): Promise<ReminderPermission> {
  if (!isTauriRuntime()) return 'unsupported'
  return await isPermissionGranted() ? 'granted' : 'denied'
}

export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (!isTauriRuntime()) return 'unsupported'
  if (await isPermissionGranted()) return 'granted'
  return await requestPermission() === 'granted' ? 'granted' : 'denied'
}

export function createTaskReminderScheduler(userId: string) {
  let timer: number | undefined
  let running = false

  async function check() {
    if (running || !isTauriRuntime() || await getReminderPermission() !== 'granted') return
    running = true
    try {
      const now = Date.now()
      const deliveries = loadDeliveries(userId, now)
      const tasks = await listTasks({ includeCompleted: false })
      const dates = [-1, 0, 1].map(offset => dateString(addDays(new Date(), offset)))
      for (const date of dates) {
        for (const item of tasksForDate(tasks, date)) {
          if (item.status !== 'todo' || !item.plannedDate || !item.plannedTime || item.parentTaskId) continue
          await deliverDueReminder(item, date, now, deliveries)
        }
      }
      saveDeliveries(userId, deliveries)
    } finally {
      running = false
    }
  }

  function start() {
    void check()
    window.clearInterval(timer)
    timer = window.setInterval(() => void check(), CHECK_INTERVAL)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', checkOnVisible)
  }

  function stop() {
    window.clearInterval(timer)
    timer = undefined
    window.removeEventListener('focus', check)
    document.removeEventListener('visibilitychange', checkOnVisible)
  }

  function checkOnVisible() {
    if (document.visibilityState === 'visible') void check()
  }

  return { start, stop, check }
}

async function deliverDueReminder(item: Task, date: string, now: number, deliveries: DeliveryLog) {
  const plannedAt = new Date(`${date}T${item.plannedTime}:00`).getTime()
  for (const offset of item.reminderOffsets) {
    const triggerAt = plannedAt - offset * 60_000
    const key = `${item.id}:${date}:${offset}:${triggerAt}`
    if (deliveries[key] || triggerAt > now || triggerAt < now - DELIVERY_GRACE) continue
    await sendNotification({
      title: offset ? `提前 ${formatOffset(offset)}：${item.title}` : `现在开始：${item.title}`,
      body: `${date.slice(5).replace('-', '月')}日 ${item.plannedTime}`
    })
    deliveries[key] = now
  }
}

function loadDeliveries(userId: string, now: number): DeliveryLog {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(userId)) || '{}') as DeliveryLog
    return Object.fromEntries(Object.entries(value).filter(([, deliveredAt]) => now - deliveredAt < DELIVERY_RETENTION))
  } catch {
    return {}
  }
}

function saveDeliveries(userId: string, deliveries: DeliveryLog) {
  localStorage.setItem(storageKey(userId), JSON.stringify(deliveries))
}

function storageKey(userId: string) {
  return `sui-time:reminder-deliveries:${userId}`
}

function formatOffset(offset: number) {
  return offset >= 60 ? `${offset / 60}小时` : `${offset}分钟`
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
