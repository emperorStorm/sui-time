import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { Anniversary, AnniversaryInput, AnniversarySummary, AnniversaryRecord, AnniversaryRecordInput } from '../types'
import { normalizeAnniversary, prepareAnniversaryRecord } from '../../../shared/anniversary.mjs'
import { getVersion } from '@tauri-apps/api/app'
import { open, save } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import type { BootState, Category, CategoryInput, HolidayDay, Priority, ShowCompletedByView, Task, TaskChildrenInput, TaskInput, TaskQuery, TaskStatus, TaskView, UserSession } from '../types'

export type ReminderPermission = 'not_determined' | 'granted' | 'denied' | 'unsupported' | 'error'

export interface ReminderPermissionResult {
  status: ReminderPermission
  detail?: string
}

export interface NativeReminderRequest {
  identifier: string
  title: string
  body: string
  triggerAt: number
}

const GITHUB_REPOSITORY = 'emperorStorm/sui-time'
const GITHUB_REQUEST_TIMEOUT = 8000
const HOLIDAY_DATA_URL = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master'
const HOLIDAY_REQUEST_TIMEOUT = 8000
const HOLIDAY_CACHE_KEY = 'sui-time:holiday-calendar:v1'
const DEMO_SHOW_COMPLETED_KEY = 'sui-time:demo-user:show-completed'
const DEMO_LAST_TASK_CATEGORY_KEY = 'sui-time:last-task-category'
const DEMO_LAST_TASK_PRIORITY_KEY = 'sui-time:last-task-priority'

const demoCategories: Category[] = [
  { id: 'work', name: '工作', color: '#4D82D5', icon: 'briefcase-business', sortOrder: 1 },
  { id: 'growth', name: '成长', color: '#13A66A', icon: 'book-open', sortOrder: 2 },
  { id: 'life', name: '生活', color: '#EE7B48', icon: 'house', sortOrder: 3 }
]

let demoTasks: Task[] = [
  task('完成产品方案', 'work', today(), '10:00', '整理首版信息架构和界面细节。'),
  task('整理本周会议记录', 'work', addDays(today(), 1), null, ''),
  task('阅读半小时', 'growth', today(), '20:30', '保持输入，记录一个值得实践的想法。'),
  task('预订周末晚餐', 'life', addDays(today(), 3), '18:30', ''),
  task('写一封感谢信', null, null, null, '')
]

type HolidayCache = Record<string, HolidayDay[]>
type HolidayPayload = { year?: unknown; days?: unknown }
const holidayRequests = new Map<number, Promise<HolidayDay[] | null>>()

function task(title: string, categoryId: string | null, plannedDate: string | null, plannedTime: string | null, notes: string): Task {
  const category = demoCategories.find(item => item.id === categoryId)
  const now = Date.now()
  return { id: crypto.randomUUID(), title, categoryId, categoryName: category?.name ?? null, categoryColor: category?.color ?? null, categoryIcon: category?.icon ?? null, plannedDate, plannedTime, plannedEndTime: null, scheduleKind: plannedTime ? 'point' : 'all_day', priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', occurrenceOverrides: '{}', reminderOffsets: [], sortOrder: 0, parentTaskId: null, failureReason: null, notes, status: 'todo', createdAt: now, completedAt: null, updatedAt: now }
}

function today() {
  return formatDate(new Date())
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + amount)
  return formatDate(value)
}

function formatDate(value: Date) {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

export function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

const DEMO_ANNIVERSARIES_KEY = 'sui-time:anniversaries:demo-user:v1'

function demoAnniversaries(): Anniversary[] {
  const raw = window.localStorage.getItem(DEMO_ANNIVERSARIES_KEY)
  if (!raw) return []
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  if (!Array.isArray(parsed.anniversaries)) throw new Error('纪念日数据格式无效')
  return parsed.anniversaries
}

function demoAnniversaryRecords(): AnniversaryRecord[] {
  const raw = window.localStorage.getItem(DEMO_ANNIVERSARIES_KEY)
  if (!raw) return []
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? [] : parsed.anniversaryRecords || []
}

function writeDemoAnniversaries(items: Anniversary[], records = demoAnniversaryRecords()) {
  try { window.localStorage.setItem(DEMO_ANNIVERSARIES_KEY, JSON.stringify({ anniversaries: items, anniversaryRecords: records })) }
  catch { throw new Error('无法保存纪念日，存储空间可能不足，请减少照片后重试') }
}

export async function listAnniversaryRecords(query: { anniversaryId?: string; startDate?: string; endDate?: string } = {}): Promise<AnniversaryRecord[]> {
  if (isTauriRuntime()) return invoke('list_user_anniversary_records', { anniversaryId: query.anniversaryId ?? null, startDate: query.startDate ?? null, endDate: query.endDate ?? null })
  if (query.anniversaryId) await getAnniversary(query.anniversaryId)
  return demoAnniversaryRecords().filter(record => (!query.anniversaryId || record.anniversaryId === query.anniversaryId)
    && (!query.startDate || record.date >= query.startDate) && (!query.endDate || record.date <= query.endDate)).sort((a, b) => b.date.localeCompare(a.date))
}

export async function saveAnniversaryRecord(input: AnniversaryRecordInput): Promise<AnniversaryRecord> {
  if (isTauriRuntime()) return invoke('save_user_anniversary_record', { input })
  const items = demoAnniversaries()
  const item = items.find(item => item.id === input.anniversaryId)
  if (!item) throw new Error('纪念日不存在')
  const records = demoAnniversaryRecords()
  const index = records.findIndex(record => record.anniversaryId === input.anniversaryId && record.date === input.date)
  const result = prepareAnniversaryRecord(item, input, index >= 0 ? records[index] : null)
  if (index >= 0) records[index] = result
  else records.push(result)
  writeDemoAnniversaries(items, records)
  return result
}

export async function listAnniversaries(): Promise<AnniversarySummary[]> {
  if (isTauriRuntime()) return invoke('list_user_anniversaries')
  return demoAnniversaries().map(({ photos: _photos, coverIndex: _coverIndex, ...summary }) => summary)
}

export async function getAnniversary(anniversaryId: string): Promise<Anniversary> {
  if (isTauriRuntime()) return invoke('get_user_anniversary', { anniversaryId })
  const item = demoAnniversaries().find(item => item.id === anniversaryId)
  if (!item) throw new Error('纪念日不存在')
  return item
}

export async function saveAnniversary(input: AnniversaryInput): Promise<Anniversary> {
  const normalized = normalizeAnniversary(input)
  if (isTauriRuntime()) return invoke('save_user_anniversary', { input: normalized })
  const items = demoAnniversaries()
  const index = normalized.id ? items.findIndex(item => item.id === normalized.id) : -1
  if (normalized.id && index < 0) throw new Error('纪念日不存在')
  const now = Date.now()
  const result = { ...normalized, id: normalized.id || crypto.randomUUID(), createdAt: index >= 0 ? items[index].createdAt : now, updatedAt: now }
  if (index >= 0) items[index] = result
  else items.push(result)
  writeDemoAnniversaries(items)
  return result
}

export async function removeAnniversary(anniversaryId: string) {
  if (isTauriRuntime()) return invoke<void>('remove_user_anniversary', { anniversaryId })
  const items = demoAnniversaries()
  if (!items.some(item => item.id === anniversaryId)) throw new Error('纪念日不存在')
  writeDemoAnniversaries(items.filter(item => item.id !== anniversaryId), demoAnniversaryRecords().filter(record => record.anniversaryId !== anniversaryId))
}

export async function pinAnniversary(anniversaryId: string, pinned: boolean) {
  if (isTauriRuntime()) return invoke<void>('pin_user_anniversary', { anniversaryId, pinned })
  const items = demoAnniversaries()
  const item = items.find(item => item.id === anniversaryId)
  if (!item) throw new Error('纪念日不存在')
  item.pinned = pinned
  item.updatedAt = Date.now()
  writeDemoAnniversaries(items)
}

function invoke<T>(command: string, args?: Record<string, unknown>) {
  return tauriInvoke<T>(command, args)
}

export async function getNativeReminderPermission(): Promise<ReminderPermissionResult> {
  if (!isTauriRuntime()) return { status: 'unsupported' }
  return invoke('get_native_reminder_permission')
}

export async function requestNativeReminderPermission(): Promise<ReminderPermissionResult> {
  if (!isTauriRuntime()) return { status: 'unsupported' }
  return invoke('request_native_reminder_permission')
}

export async function replaceNativeReminders(requests: NativeReminderRequest[]) {
  if (!isTauriRuntime()) throw new Error('仅桌面客户端支持系统提醒')
  return invoke<void>('replace_native_reminders', { requests })
}

export async function clearNativeReminders() {
  if (!isTauriRuntime()) return
  return invoke<void>('clear_native_reminders')
}

export async function sendNativeReminderTestNotification() {
  if (!isTauriRuntime()) throw new Error('仅桌面客户端支持系统提醒')
  return invoke<void>('send_native_reminder_test_notification')
}

export async function openNativeReminderNotificationSettings() {
  if (!isTauriRuntime()) throw new Error('仅桌面客户端支持系统提醒')
  return invoke<void>('open_native_reminder_notification_settings')
}

export async function getBootState(): Promise<BootState> {
  if (isTauriRuntime()) return invoke('get_boot_state')
  return { needsSetup: false, session: { id: 'demo-user', username: '时光记录者', displayName: '时光记录者', showCompletedByView: loadDemoShowCompletedByView() } }
}

export async function createAccount(input: { username: string; password: string }): Promise<UserSession> {
  if (isTauriRuntime()) return invoke('create_account', { input })
  const showCompletedByView = { all: false, week: false, month: false }
  for (const view of Object.keys(showCompletedByView) as TaskView[]) saveDemoShowCompleted(view, false)
  return { id: 'demo-user', username: input.username, displayName: input.username, showCompletedByView }
}

export async function loginUser(input: { username: string; password: string }): Promise<UserSession> {
  if (isTauriRuntime()) return invoke('login_user', { input })
  return { id: 'demo-user', username: input.username, displayName: input.username, showCompletedByView: loadDemoShowCompletedByView() }
}

export async function logoutUser() {
  if (isTauriRuntime()) await invoke('logout_user')
}

export async function saveShowCompleted(view: TaskView, showCompleted: boolean): Promise<boolean> {
  if (isTauriRuntime()) return invoke('save_user_show_completed', { view, showCompleted })
  saveDemoShowCompleted(view, showCompleted)
  return showCompleted
}

export async function getLastTaskCategory(): Promise<string | null> {
  if (isTauriRuntime()) return invoke('get_user_last_task_category')
  try {
    return window.localStorage.getItem(`${DEMO_LAST_TASK_CATEGORY_KEY}:demo-user`)
  } catch {
    return null
  }
}

export async function saveLastTaskCategory(categoryId: string): Promise<string> {
  if (isTauriRuntime()) return invoke('save_user_last_task_category', { categoryId })
  try {
    window.localStorage.setItem(`${DEMO_LAST_TASK_CATEGORY_KEY}:demo-user`, categoryId)
    return categoryId
  } catch {
    throw new Error('无法保存最近使用分类')
  }
}

export async function getLastTaskPriority(): Promise<Priority | null> {
  if (isTauriRuntime()) return invoke('get_user_last_task_priority')
  try {
    const priority = window.localStorage.getItem(`${DEMO_LAST_TASK_PRIORITY_KEY}:demo-user`)
    return priority as Priority | null
  } catch {
    return null
  }
}

export async function saveLastTaskPriority(priority: Priority): Promise<Priority> {
  if (isTauriRuntime()) return invoke('save_user_last_task_priority', { priority })
  try {
    window.localStorage.setItem(`${DEMO_LAST_TASK_PRIORITY_KEY}:demo-user`, priority)
    return priority
  } catch {
    throw new Error('无法保存最近使用优先级')
  }
}

function loadDemoShowCompletedByView(): ShowCompletedByView {
  try {
    const legacy = window.localStorage.getItem(DEMO_SHOW_COMPLETED_KEY) === 'true'
    return {
      all: loadDemoShowCompleted('all', legacy),
      week: loadDemoShowCompleted('week', legacy),
      month: loadDemoShowCompleted('month', legacy)
    }
  } catch {
    return { all: false, week: false, month: false }
  }
}

function loadDemoShowCompleted(view: TaskView, fallback: boolean) {
  const value = window.localStorage.getItem(`${DEMO_SHOW_COMPLETED_KEY}:${view}`)
  return value === null ? fallback : value === 'true'
}

function saveDemoShowCompleted(view: TaskView, showCompleted: boolean) {
  try {
    window.localStorage.setItem(`${DEMO_SHOW_COMPLETED_KEY}:${view}`, String(showCompleted))
  } catch {
    throw new Error('无法保存显示偏好')
  }
}

export function getCachedHolidayCalendar(years: number[]): Record<string, HolidayDay> {
  const cache = readHolidayCache()
  return holidayDateMap(years.flatMap(year => cache[String(year)] || []))
}

export async function refreshHolidayCalendar(years: number[], force = true): Promise<Record<string, HolidayDay>> {
  const uniqueYears = [...new Set(years.filter(year => Number.isInteger(year) && year >= 2000 && year <= 2100))]
  const results = await Promise.all(uniqueYears.map(year => loadHolidayYear(year, force)))
  return holidayDateMap(results.flatMap(days => days || []))
}

function readHolidayCache(): HolidayCache {
  try {
    const raw = window.localStorage.getItem(HOLIDAY_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.entries(parsed).reduce<HolidayCache>((result, [year, days]) => {
      const normalized = normalizeHolidayDays(Number(year), days)
      if (normalized) result[year] = normalized
      return result
    }, {})
  } catch {
    return {}
  }
}

function saveHolidayYear(year: number, days: HolidayDay[]) {
  try {
    const cache = readHolidayCache()
    cache[String(year)] = days
    window.localStorage.setItem(HOLIDAY_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // 缓存不可用时不阻断月历展示。
  }
}

function loadHolidayYear(year: number, force: boolean): Promise<HolidayDay[] | null> {
  const cached = readHolidayCache()[String(year)] || null
  if (!force && cached) return Promise.resolve(cached)
  const existingRequest = holidayRequests.get(year)
  if (existingRequest) return existingRequest
  const request = fetchHolidayYear(year, cached)
  holidayRequests.set(year, request)
  void request.finally(() => holidayRequests.delete(year))
  return request
}

async function fetchHolidayYear(year: number, fallback: HolidayDay[] | null): Promise<HolidayDay[] | null> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = window.setTimeout(() => controller?.abort(), HOLIDAY_REQUEST_TIMEOUT)
  try {
    const response = await fetch(`${HOLIDAY_DATA_URL}/${year}.json`, { signal: controller?.signal })
    if (!response.ok) throw new Error(`节假日数据请求失败（${response.status}）`)
    const payload = await response.json() as HolidayPayload
    if (payload?.year !== year) throw new Error('节假日数据年份无效')
    const days = normalizeHolidayDays(year, payload?.days, payload?.year)
    if (!days) throw new Error('节假日数据格式无效')
    saveHolidayYear(year, days)
    return days
  } catch {
    return fallback
  } finally {
    window.clearTimeout(timeout)
  }
}

function normalizeHolidayDays(year: number, value: unknown, payloadYear?: unknown): HolidayDay[] | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Array.isArray(value)) return null
  if (payloadYear !== undefined && payloadYear !== year) return null
  const days = value.map(item => {
    if (!item || typeof item !== 'object') return null
    const candidate = item as { date?: unknown; name?: unknown; isOffDay?: unknown }
    if (typeof candidate.date !== 'string' || typeof candidate.name !== 'string' || typeof candidate.isOffDay !== 'boolean') return null
    if (!isHolidayDate(candidate.date, year) || !candidate.name.trim()) return null
    return { date: candidate.date, name: candidate.name.trim(), isOffDay: candidate.isOffDay }
  })
  if (days.some(item => !item)) return null
  const validDays = days as HolidayDay[]
  return [...new Map(validDays.map(item => [item.date, item])).values()]
}

function isHolidayDate(value: string, year: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) !== year) return false
  const date = new Date(`${value}T12:00:00`)
  return date.getFullYear() === year && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10))
}

function holidayDateMap(days: HolidayDay[]): Record<string, HolidayDay> {
  return days.reduce<Record<string, HolidayDay>>((result, day) => {
    result[day.date] = day
    return result
  }, {})
}

export async function listCategories(): Promise<Category[]> {
  if (isTauriRuntime()) return invoke('list_user_categories')
  return [...demoCategories]
}

export async function saveCategory(input: CategoryInput): Promise<Category> {
  if (isTauriRuntime()) return invoke('save_user_category', { input })
  const id = input.id || crypto.randomUUID()
  const category = { ...input, id }
  const index = demoCategories.findIndex(item => item.id === id)
  if (index >= 0) demoCategories.splice(index, 1, category)
  else demoCategories.push(category)
  return category
}

export async function removeCategory(categoryId: string) {
  if (isTauriRuntime()) return invoke<void>('remove_user_category', { categoryId })
  demoTasks = demoTasks.map(item => item.categoryId === categoryId ? { ...item, categoryId: null, categoryName: null, categoryColor: null, categoryIcon: null } : item)
  const index = demoCategories.findIndex(item => item.id === categoryId)
  if (index >= 0) demoCategories.splice(index, 1)
}

export async function listTasks(query: TaskQuery): Promise<Task[]> {
  if (isTauriRuntime()) return invoke('list_user_tasks', { query })
  return demoTasks.filter(item => {
    const search = query.search?.trim().toLowerCase()
    const matchesSearch = !search || item.title.toLowerCase().includes(search) || item.notes.toLowerCase().includes(search)
    const matchesStatus = query.includeCompleted || item.status === 'todo'
    const matchesStart = !query.startDate || Boolean(item.plannedDate && item.plannedDate >= query.startDate)
    const matchesEnd = !query.endDate || Boolean(item.plannedDate && item.plannedDate <= query.endDate)
    return matchesSearch && matchesStatus && matchesStart && matchesEnd
  })
}

export async function saveTask(input: TaskInput): Promise<Task> {
  if (isTauriRuntime()) return invoke('save_user_task', { input })
  const category = demoCategories.find(item => item.id === input.categoryId)
  const now = Date.now()
  const existing = input.id ? demoTasks.find(item => item.id === input.id) : undefined
  const occurrenceOverrides = preserveTerminalOverrideHistory(existing, input.occurrenceOverrides)
  const repeating = (() => {
    try { return JSON.parse(input.repeatRule).kind !== 'none' } catch { return false }
  })()
  const status: TaskStatus = repeating ? 'todo' : existing?.status || 'todo'
  const result: Task = { id: input.id || crypto.randomUUID(), title: input.title, categoryId: input.categoryId, categoryName: category?.name ?? null, categoryColor: category?.color ?? null, categoryIcon: category?.icon ?? null, plannedDate: input.plannedDate, plannedTime: input.plannedTime, plannedEndTime: input.plannedEndTime, scheduleKind: input.scheduleKind, priority: input.priority, repeatRule: input.repeatRule, occurrenceOverrides, reminderOffsets: input.reminderOffsets, sortOrder: existing?.sortOrder || 0, parentTaskId: input.parentTaskId, failureReason: status === 'failed' ? normalizeFailureReason(input.failureReason) : null, notes: input.notes, status, createdAt: existing?.createdAt || now, completedAt: repeating ? null : existing?.completedAt || null, updatedAt: now }
  if (existing) demoTasks = demoTasks.map(item => item.id === result.id ? result : item)
  else demoTasks.push(result)
  return result
}

function preserveTerminalOverrideHistory(existing: Task | undefined, value: string) {
  if (!existing) return value
  let parsed: Record<string, Partial<Task> & { deleted?: boolean }>
  try {
    parsed = JSON.parse(value || '{}')
  } catch {
    return value
  }
  const snapshot: Partial<Task> = {
    title: existing.title,
    categoryId: existing.categoryId,
    plannedTime: existing.plannedTime,
    plannedEndTime: existing.plannedEndTime,
    scheduleKind: existing.scheduleKind,
    priority: existing.priority,
    reminderOffsets: [...existing.reminderOffsets],
    notes: existing.notes,
    repeatRule: existing.repeatRule,
  }
  Object.values(parsed).forEach(override => {
    if (override.deleted || (override.status !== 'done' && override.status !== 'failed')) return
    Object.entries(snapshot).forEach(([key, field]) => {
      if (override[key as keyof Task] === undefined) (override as Record<string, unknown>)[key] = field
    })
  })
  return JSON.stringify(parsed)
}

export async function removeTask(taskId: string) {
  if (isTauriRuntime()) return invoke<void>('remove_user_task', { taskId })
  demoTasks = demoTasks.filter(item => item.id !== taskId)
}

export async function listTaskChildren(parentTaskId: string): Promise<Task[]> {
  if (isTauriRuntime()) return invoke('list_user_task_children', { parentTaskId })
  const parent = demoTasks.find(item => item.id === parentTaskId)
  if (!parent) throw new Error('事项不存在')
  return demoTasks.filter(item => item.parentTaskId === parentTaskId).sort((left, right) => left.sortOrder - right.sortOrder).map(item => ({ ...item }))
}

export async function syncTaskChildren(input: TaskChildrenInput): Promise<Task[]> {
  if (isTauriRuntime()) return invoke('sync_user_task_children', { input })
  const parent = demoTasks.find(item => item.id === input.parentTaskId)
  if (!parent) throw new Error('事项不存在')
  const children = demoTasks.filter(item => item.parentTaskId === input.parentTaskId)
  const deletedIds = new Set(input.deletedIds)
  if (deletedIds.size !== input.deletedIds.length || input.deletedIds.some(id => !children.some(item => item.id === id))) throw new Error('子事项不存在或无权修改')
  const seenIds = new Set<string>()
  for (const child of input.children) {
    const title = child.title.trim()
    if (!title || [...title].length > 120) throw new Error('子事项标题需为 1 至 120 个字符')
    if (child.status !== 'todo' && child.status !== 'done') throw new Error('子事项状态无效')
    if (child.id && (seenIds.has(child.id) || deletedIds.has(child.id))) throw new Error('子事项重复')
    if (child.id) seenIds.add(child.id)
  }
  const currentById = new Map(children.map(item => [item.id, item]))
  for (const child of input.children) {
    if (child.id && !currentById.has(child.id)) throw new Error('子事项不存在或无权修改')
  }
  const now = Date.now()
  let nextTasks = demoTasks.filter(item => !deletedIds.has(item.id))
  for (const child of input.children) {
    const existing = child.id ? currentById.get(child.id) : undefined
    if (existing) {
      nextTasks = nextTasks.map(item => item.id === existing.id ? { ...item, title: child.title.trim(), status: child.status, sortOrder: child.sortOrder, failureReason: null, completedAt: child.status === 'done' ? now : null, updatedAt: now } : item)
    } else {
      const created = task(child.title.trim(), null, null, null, '')
      nextTasks.push({ ...created, id: crypto.randomUUID(), parentTaskId: input.parentTaskId, sortOrder: child.sortOrder, status: child.status, completedAt: child.status === 'done' ? now : null, updatedAt: now })
    }
  }
  const nextChildren = nextTasks.filter(item => item.parentTaskId === input.parentTaskId)
  if (!parent.parentTaskId && parent.status !== 'failed' && isNonRepeatingTask(parent) && nextChildren.length) {
    const nextStatus: TaskStatus = nextChildren.every(item => item.status === 'done') ? 'done' : 'todo'
    if (parent.status !== nextStatus) {
      nextTasks = nextTasks.map(item => item.id === parent.id
        ? { ...item, status: nextStatus, failureReason: null, completedAt: nextStatus === 'done' ? now : null, updatedAt: now }
        : item)
    }
  }
  demoTasks = nextTasks
  return demoTasks.filter(item => item.parentTaskId === input.parentTaskId).sort((left, right) => left.sortOrder - right.sortOrder).map(item => ({ ...item }))
}

function isNonRepeatingTask(task: Task) {
  try {
    return (JSON.parse(task.repeatRule) as { kind?: unknown }).kind === 'none'
  } catch {
    return false
  }
}

export async function setTaskStatus(taskId: string, status: TaskStatus, failureReason: string | null = null): Promise<Task> {
  if (isTauriRuntime()) return invoke('set_user_task_status', { taskId, status, failureReason })
  const task = demoTasks.find(item => item.id === taskId)
  if (!task) throw new Error('事项不存在')
  if (status === 'failed' && task.parentTaskId) throw new Error('子事项不支持标记失败')
  const updated = { ...task, status, failureReason: status === 'failed' ? normalizeFailureReason(failureReason) : null, completedAt: status === 'done' ? Date.now() : null, updatedAt: Date.now() } as Task
  demoTasks = demoTasks.map(item => item.id === taskId ? updated : status === 'todo' && task.status === 'done' && item.parentTaskId === taskId ? { ...item, status: 'todo', failureReason: null, completedAt: null, updatedAt: updated.updatedAt } : item)
  return updated
}

function normalizeFailureReason(value: string | null) {
  const reason = value?.trim() || null
  if (reason && [...reason].length > 1000) throw new Error('失败理由不能超过 1000 个字符')
  return reason
}

export async function countUnfinishedTaskChildren(taskId: string): Promise<number> {
  if (isTauriRuntime()) return invoke('count_unfinished_user_task_children', { taskId })
  const task = demoTasks.find(item => item.id === taskId)
  if (!task) throw new Error('事项不存在')
  return demoTasks.filter(item => item.parentTaskId === taskId && item.status !== 'done').length
}

export async function completeTaskWithChildren(taskId: string): Promise<Task> {
  if (isTauriRuntime()) return invoke('complete_user_task_with_children', { taskId })
  const task = demoTasks.find(item => item.id === taskId)
  if (!task) throw new Error('事项不存在')
  if (task.status === 'done') return task
  const now = Date.now()
  demoTasks = demoTasks.map(item => {
    if (item.id !== taskId && (item.parentTaskId !== taskId || item.status === 'done')) return item
    return { ...item, status: 'done', failureReason: null, completedAt: now, updatedAt: now }
  })
  return demoTasks.find(item => item.id === taskId) as Task
}

export async function rescheduleTask(taskId: string, plannedDate: string | null): Promise<Task> {
  if (isTauriRuntime()) return invoke('reschedule_user_task', { taskId, plannedDate })
  const task = demoTasks.find(item => item.id === taskId)
  if (!task) throw new Error('事项不存在')
  const updated = { ...task, plannedDate, updatedAt: Date.now() }
  demoTasks = demoTasks.map(item => item.id === taskId ? updated : item)
  return updated
}

export async function currentVersion() {
  return isTauriRuntime() ? getVersion() : '0.6.0'
}

export interface UpdateCheckResult {
  currentVersion: string
  update?: Update
}

interface GitHubCompareResponse {
  commits?: Array<{
    sha?: string
    html_url?: string
    commit?: {
      message?: string
    }
  }>
}

export interface UpdateCommit {
  sha: string
  message: string
  url: string
}

export function formatUpdateError(error: unknown) {
  const text = String(error).replace(/^Error:\s*/, '')
  if (text.includes('error sending request') || text.includes('timed out') || text.includes('timeout')) {
    return '连接更新服务失败，请稍后重试或检查当前网络'
  }
  return text || '检查更新失败，请稍后重试'
}

export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  if (!isTauriRuntime()) return { currentVersion: await currentVersion() }
  const update = await check({ timeout: 15000 })
  return {
    currentVersion: update?.currentVersion || await currentVersion(),
    update: update || undefined
  }
}

export async function getUpdateCommits(currentVersion: string, latestVersion: string): Promise<UpdateCommit[]> {
  const currentTag = toReleaseTag(currentVersion)
  const latestTag = toReleaseTag(latestVersion)
  if (currentTag === latestTag) return []

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT)
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/compare/${encodeURIComponent(currentTag)}...${encodeURIComponent(latestTag)}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`GitHub 提交记录请求失败（${response.status}）`)
    const data = await response.json() as GitHubCompareResponse
    return (data.commits || []).flatMap(commit => {
      const sha = commit.sha?.trim()
      const message = commit.commit?.message?.trim()
      if (!sha || !message) return []
      return [{ sha, message, url: commit.html_url || `https://github.com/${GITHUB_REPOSITORY}/commit/${sha}` }]
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('GitHub 提交记录请求超时')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function toReleaseTag(version: string) {
  return `v${version.trim().replace(/^v/i, '')}`
}

export async function installAppUpdate(update: Update, onEvent: (event: DownloadEvent) => void) {
  await update.downloadAndInstall(onEvent, { timeout: 120000 })
  await relaunch()
}

export async function exportEncryptedBackup(password: string): Promise<string | null> {
  if (!isTauriRuntime()) throw new Error('备份功能仅在桌面客户端中可用')
  const backupPath = await save({
    defaultPath: `岁岁时光-${today()}.suitime-backup`,
    filters: [{ name: '岁岁时光加密备份', extensions: ['suitime-backup'] }]
  })
  if (!backupPath) return null
  return invoke<string>('backup_app_data_command', { backupPath, password })
}

export async function restoreEncryptedBackup(password: string): Promise<string | null> {
  if (!isTauriRuntime()) throw new Error('恢复功能仅在桌面客户端中可用')
  const backupPath = await open({
    multiple: false,
    filters: [{ name: '岁岁时光加密备份', extensions: ['suitime-backup'] }]
  })
  if (!backupPath || Array.isArray(backupPath)) return null
  return invoke<string>('restore_app_data_command', { backupPath, password })
}
