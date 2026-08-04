import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { open, save } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import type { BootState, Category, CategoryInput, Task, TaskInput, TaskQuery, UserSession } from '../types'

const GITHUB_REPOSITORY = 'emperorStorm/sui-time'
const GITHUB_REQUEST_TIMEOUT = 8000

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

function task(title: string, categoryId: string | null, plannedDate: string | null, plannedTime: string | null, notes: string): Task {
  const category = demoCategories.find(item => item.id === categoryId)
  const now = Date.now()
  return { id: crypto.randomUUID(), title, categoryId, categoryName: category?.name ?? null, categoryColor: category?.color ?? null, categoryIcon: category?.icon ?? null, plannedDate, plannedTime, plannedEndTime: null, scheduleKind: plannedTime ? 'point' : 'all_day', priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', occurrenceOverrides: '{}', reminderOffsets: [], parentTaskId: null, notes, status: 'todo', createdAt: now, completedAt: null, updatedAt: now }
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
    const matchesStatus = query.includeCompleted || item.status !== 'done'
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
  const repeating = (() => {
    try { return JSON.parse(input.repeatRule).kind !== 'none' } catch { return false }
  })()
  const result: Task = { id: input.id || crypto.randomUUID(), title: input.title, categoryId: input.categoryId, categoryName: category?.name ?? null, categoryColor: category?.color ?? null, categoryIcon: category?.icon ?? null, plannedDate: input.plannedDate, plannedTime: input.plannedTime, plannedEndTime: input.plannedEndTime, scheduleKind: input.scheduleKind, priority: input.priority, repeatRule: input.repeatRule, occurrenceOverrides: input.occurrenceOverrides, reminderOffsets: input.reminderOffsets, parentTaskId: input.parentTaskId, notes: input.notes, status: repeating ? 'todo' : existing?.status || 'todo', createdAt: existing?.createdAt || now, completedAt: repeating ? null : existing?.completedAt || null, updatedAt: now }
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
  return isTauriRuntime() ? getVersion() : '0.1.3-dev'
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
