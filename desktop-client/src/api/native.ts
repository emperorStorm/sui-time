import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import type { BootState, Tag, TagInput, Task, TaskInput, TaskQuery, UserSession } from '../types'

const demoTags: Tag[] = [
  { id: 'work', name: '工作', color: '#4D82D5', sortOrder: 1 },
  { id: 'growth', name: '成长', color: '#13A66A', sortOrder: 2 },
  { id: 'life', name: '生活', color: '#EE7B48', sortOrder: 3 }
]

let demoTasks: Task[] = [
  task('完成产品方案', 'work', today(), '10:00', '整理首版信息架构和界面细节。'),
  task('整理本周会议记录', 'work', addDays(today(), 1), null, ''),
  task('阅读半小时', 'growth', today(), '20:30', '保持输入，记录一个值得实践的想法。'),
  task('预订周末晚餐', 'life', addDays(today(), 3), '18:30', ''),
  task('写一封感谢信', null, null, null, '')
]

function task(title: string, tagId: string | null, plannedDate: string | null, plannedTime: string | null, notes: string): Task {
  const tag = demoTags.find(item => item.id === tagId)
  const now = Date.now()
  return { id: crypto.randomUUID(), title, tagId, tagName: tag?.name ?? null, tagColor: tag?.color ?? null, plannedDate, plannedTime, notes, status: 'todo', createdAt: now, completedAt: null, updatedAt: now }
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

function invoke<T>(command: string, args?: Record<string, unknown>) {
  return tauriInvoke<T>(command, args)
}

export async function getBootState(): Promise<BootState> {
  if (isTauriRuntime()) return invoke('get_boot_state')
  return { needsSetup: false, session: { id: 'demo-user', username: '时光记录者', displayName: '时光记录者' } }
}

export async function createAccount(input: { username: string; password: string }): Promise<UserSession> {
  if (isTauriRuntime()) return invoke('create_account', { input })
  return { id: 'demo-user', username: input.username, displayName: input.username }
}

export async function loginUser(input: { username: string; password: string }): Promise<UserSession> {
  if (isTauriRuntime()) return invoke('login_user', { input })
  return { id: 'demo-user', username: input.username, displayName: input.username }
}

export async function logoutUser() {
  if (isTauriRuntime()) await invoke('logout_user')
}

export async function listTags(): Promise<Tag[]> {
  if (isTauriRuntime()) return invoke('list_user_tags')
  return [...demoTags]
}

export async function saveTag(input: TagInput): Promise<Tag> {
  if (isTauriRuntime()) return invoke('save_user_tag', { input })
  const id = input.id || crypto.randomUUID()
  const tag = { ...input, id }
  const index = demoTags.findIndex(item => item.id === id)
  if (index >= 0) demoTags.splice(index, 1, tag)
  else demoTags.push(tag)
  return tag
}

export async function removeTag(tagId: string) {
  if (isTauriRuntime()) return invoke<void>('remove_user_tag', { tagId })
  demoTasks = demoTasks.map(item => item.tagId === tagId ? { ...item, tagId: null, tagName: null, tagColor: null } : item)
  const index = demoTags.findIndex(item => item.id === tagId)
  if (index >= 0) demoTags.splice(index, 1)
}

export async function listTasks(query: TaskQuery): Promise<Task[]> {
  if (isTauriRuntime()) return invoke('list_user_tasks', { query })
  return demoTasks.filter(item => {
    const search = query.search?.trim().toLowerCase()
    const matchesSearch = !search || item.title.toLowerCase().includes(search) || item.notes.toLowerCase().includes(search)
    const matchesStatus = query.includeCompleted || item.status !== 'done'
    const matchesStart = !query.startDate || Boolean(item.plannedDate && item.plannedDate >= query.startDate)
    const matchesEnd = !query.endDate || Boolean(item.plannedDate && item.plannedDate <= query.endDate)
    return matchesSearch && matchesStatus && matchesStart && matchesEnd
  })
}

export async function saveTask(input: TaskInput): Promise<Task> {
  if (isTauriRuntime()) return invoke('save_user_task', { input })
  const tag = demoTags.find(item => item.id === input.tagId)
  const now = Date.now()
  const existing = input.id ? demoTasks.find(item => item.id === input.id) : undefined
  const result: Task = { id: input.id || crypto.randomUUID(), title: input.title, tagId: input.tagId, tagName: tag?.name ?? null, tagColor: tag?.color ?? null, plannedDate: input.plannedDate, plannedTime: input.plannedTime, notes: input.notes, status: existing?.status || 'todo', createdAt: existing?.createdAt || now, completedAt: existing?.completedAt || null, updatedAt: now }
  if (existing) demoTasks = demoTasks.map(item => item.id === result.id ? result : item)
  else demoTasks.push(result)
  return result
}

export async function removeTask(taskId: string) {
  if (isTauriRuntime()) return invoke<void>('remove_user_task', { taskId })
  demoTasks = demoTasks.filter(item => item.id !== taskId)
}

export async function toggleTask(taskId: string): Promise<Task> {
  if (isTauriRuntime()) return invoke('toggle_user_task', { taskId })
  const task = demoTasks.find(item => item.id === taskId)
  if (!task) throw new Error('事项不存在')
  const status = task.status === 'done' ? 'todo' : 'done'
  const updated = { ...task, status, completedAt: status === 'done' ? Date.now() : null, updatedAt: Date.now() } as Task
  demoTasks = demoTasks.map(item => item.id === taskId ? updated : item)
  return updated
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
  return isTauriRuntime() ? getVersion() : '0.1.0-dev'
}

export async function checkAppUpdate(): Promise<Update | null> {
  if (!isTauriRuntime()) return null
  return check({ timeout: 15000 })
}

export async function installAppUpdate(update: Update, onEvent: (event: DownloadEvent) => void) {
  await update.downloadAndInstall(onEvent, { timeout: 120000 })
  await relaunch()
}
