import { load, reset, save as saveStorage } from './storage.js'
import { normalizeAnniversary, prepareAnniversaryRecord } from '../../../shared/anniversary.mjs'
import { occursOn, parseOccurrenceId, parseOverrides, parseRepeatRule, resolveTasksForDate } from '../utils/occurrence.js'
import { addDays, todayString } from '../utils/date.js'
import { compareTasks, normalizeTask } from '../utils/task.js'
import { syncTaskReminders } from './reminders.js'

export function listAnniversaries() {
  return load().anniversaries.map(({ photos, coverIndex, ...summary }) => summary)
}

export function listAnniversaryRecords({ anniversaryId, startDate, endDate } = {}) {
  if (anniversaryId) getAnniversary(anniversaryId)
  return load().anniversaryRecords.filter(record => (!anniversaryId || record.anniversaryId === anniversaryId)
    && (!startDate || record.date >= startDate) && (!endDate || record.date <= endDate))
    .sort((a, b) => b.date.localeCompare(a.date)).map(record => ({ ...record }))
}

export function saveAnniversaryRecord(input) {
  const data = load()
  const item = getAnniversary(input.anniversaryId)
  const records = [...data.anniversaryRecords]
  const index = records.findIndex(record => record.anniversaryId === input.anniversaryId && record.date === input.date)
  const result = prepareAnniversaryRecord(item, input, index >= 0 ? records[index] : null)
  if (index >= 0) records[index] = result
  else records.push(result)
  saveStorage({ ...data, anniversaryRecords: records }, { strict: true })
  return result
}

export function getAnniversary(id) {
  const item = load().anniversaries.find(item => item.id === id)
  if (!item) throw new Error('纪念日不存在')
  return { ...item, photos: [...item.photos] }
}

export function saveAnniversary(input) {
  const normalized = normalizeAnniversary(input)
  const data = load()
  const items = [...data.anniversaries]
  const index = normalized.id ? items.findIndex(item => item.id === normalized.id) : -1
  if (normalized.id && index < 0) throw new Error('纪念日不存在')
  const now = Date.now()
  const item = { ...normalized, photos: [...normalized.photos], id: normalized.id || `a${now}-${Math.random().toString(36).slice(2, 10)}`, createdAt: index >= 0 ? items[index].createdAt : now, updatedAt: now }
  if (index >= 0) items[index] = item
  else items.push(item)
  saveStorage({ ...data, anniversaries: items }, { strict: true })
  return item
}

export function removeAnniversary(id) {
  const data = load()
  if (!data.anniversaries.some(item => item.id === id)) throw new Error('纪念日不存在')
  saveStorage({ ...data, anniversaries: data.anniversaries.filter(item => item.id !== id), anniversaryRecords: data.anniversaryRecords.filter(record => record.anniversaryId !== id) }, { strict: true })
}

export function pinAnniversary(id, pinned) {
  const data = load()
  if (!data.anniversaries.some(item => item.id === id)) throw new Error('纪念日不存在')
  const items = data.anniversaries.map(item => item.id === id ? { ...item, pinned, updatedAt: Date.now() } : item)
  saveStorage({ ...data, anniversaries: items }, { strict: true })
}

export function getCategories() {
  return load().categories
}

export function categoryById(id) {
  return load().categories.find((item) => item.id === id) || null
}

export function saveCategory(category) {
  const data = load()
  const now = Date.now()
  const categories = [...data.categories]
  const index = category.id ? categories.findIndex(item => item.id === category.id) : -1
  if (category.id && index < 0) return category
  const saved = index >= 0
    ? { ...categories[index], ...category, updatedAt: now }
    : { ...category, id: `c${now}`, sortOrder: categories.length, createdAt: now, updatedAt: now }
  if (index >= 0) categories[index] = saved
  else categories.push(saved)
  saveStorage({ ...data, categories }, { strict: true, message: '无法保存分类，请检查本机存储空间后重试' })
  Object.assign(category, saved)
  return category
}

export function reorderCategories(ids) {
  const data = load()
  const orders = new Map(ids.map((id, index) => [id, index]))
  const categories = data.categories.map(item => orders.has(item.id) ? { ...item, sortOrder: orders.get(item.id) } : item)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  saveStorage({ ...data, categories }, { strict: true, message: '无法保存分类顺序，请重试' })
}

export function removeCategory(id) {
  const data = load()
  const categories = data.categories.filter(item => item.id !== id)
  const tasks = data.tasks.map(task => task.categoryId === id ? { ...task, categoryId: null } : task)
  saveStorage({ ...data, categories, tasks }, { strict: true, message: '无法删除分类，请重试' })
}

export function listTasks() {
  return load().tasks
}

export function findTask(id) {
  const occurrence = parseOccurrenceId(id)
  if (occurrence) return resolveTasksForDate(listTasks(), parseOverrides(findTask(occurrence.sourceId) || {})[occurrence.date]?.plannedDate || occurrence.date).find(task => task.id === id) || null
  return load().tasks.find((item) => item.id === id) || null
}

// options.status 与编辑草稿在同一次严格写入中提交；返回对象的 reminderPromise 可供 UI 等待排程。
export function saveTask(input, children, options = {}) {
  const data = load()
  const now = Date.now()
  if (options.status !== undefined && !['todo', 'done', 'failed'].includes(options.status)) throw new Error('事项状态无效')
  const occurrence = input.id ? parseOccurrenceId(input.id) : null
  const sourceId = occurrence?.sourceId || input.id
  const existing = sourceId ? data.tasks.find(task => task.id === sourceId) : null
  if (sourceId && !existing) throw new Error('事项不存在')
  const effective = occurrence ? findTask(input.id) : existing
  if (occurrence && !effective) throw new Error('当次事项不存在')
  const normalized = normalizeTask({ ...effective, ...input })
  if (occurrence && !normalized.plannedDate) throw new Error('重复事项的当次日期不能为空')
  const id = sourceId || `t${now}-${Math.random().toString(36).slice(2, 8)}`
  let saved = { status: 'todo', createdAt: now, ...existing, ...normalized, id, updatedAt: now }
  if (occurrence) {
    const overrides = parseOverrides(existing)
    const { title, categoryId, plannedDate, plannedTime, plannedEndTime, scheduleKind, priority, reminderOffsets, notes } = normalized
    overrides[occurrence.date] = { ...overrides[occurrence.date], title, categoryId, plannedDate, plannedTime, plannedEndTime, scheduleKind, priority, reminderOffsets, notes }
    saved = { ...existing, occurrenceOverrides: JSON.stringify(overrides), updatedAt: now }
  }
  let tasks = existing ? data.tasks.map(task => task.id === id ? saved : task) : [saved, ...data.tasks]
  // 实例编辑不能借用源 id 覆盖重复源的子事项。
  if (children !== undefined && !occurrence) {
    if (!Array.isArray(children)) throw new Error('子事项数据无效')
    const seen = new Set()
    const next = children.filter(child => {
      if (!child || typeof child.title !== 'string') throw new Error('请先填写事项名称')
      if (child.status !== undefined && !['todo', 'done'].includes(child.status)) throw new Error('子事项状态无效')
      return child.title.trim()
    }).map((child, index) => {
      const old = child.id ? data.tasks.find(task => task.id === child.id) : null
      if ((old && old.parentTaskId !== id) || (child.id && seen.has(child.id))) throw new Error('子事项数据无效')
      const childId = child.id || `child-${id}-${now}-${index}`
      seen.add(childId)
      const status = child.status ?? old?.status ?? 'todo'
      return {
        plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day', reminderOffsets: [],
        priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', createdAt: now, ...old,
        id: childId, title: normalizeTask({ title: child.title }).title, parentTaskId: id,
        status, completedAt: status === 'done' ? (old?.status === 'done' ? old.completedAt ?? now : now) : null,
        sortOrder: index, updatedAt: now
      }
    })
    tasks = tasks.filter(task => task.parentTaskId !== id).concat(next)
    if (next.length && !saved.parentTaskId && saved.status !== 'failed' && parseRepeatRule(saved.repeatRule).kind === 'none') {
      const status = next.every(child => child.status === 'done') ? 'done' : saved.status === 'done' ? 'todo' : saved.status
      saved = { ...saved, ...taskStatusPatch(saved, status, now, true) }
      tasks = tasks.map(task => task.id === id ? saved : task)
    }
  }
  if (options.status !== undefined) tasks = applyTaskStatus(tasks, saved, occurrence, options.status, now)
  const reminderPromise = saveTaskData({ ...data, tasks })
  const result = { ...(occurrence ? findTask(input.id) : tasks.find(task => task.id === id)) }
  Object.defineProperty(result, 'reminderPromise', { value: reminderPromise })
  return result
}

function taskStatusPatch(task, status, now, preserveCompleted = false) {
  return {
    status, completedAt: status === 'done' ? (preserveCompleted && task.status === 'done' ? task.completedAt ?? now : now) : null,
    failureReason: status === 'failed' ? task.failureReason || '' : '', updatedAt: now
  }
}

function applyTaskStatus(tasks, source, occurrence, status, now) {
  if (source.parentTaskId && status === 'failed') throw new Error('子事项状态无效')
  let updated = { ...source, ...taskStatusPatch(source, status, now) }
  if (occurrence) {
    const overrides = parseOverrides(source)
    const { title, categoryId, plannedDate, plannedTime, plannedEndTime, scheduleKind, priority, reminderOffsets, notes } = source
    const current = { title, categoryId, plannedDate: occurrence.date, plannedTime, plannedEndTime, scheduleKind, priority, reminderOffsets, notes, ...overrides[occurrence.date] }
    overrides[occurrence.date] = { ...current, ...taskStatusPatch(current, status, now) }
    updated = { ...source, occurrenceOverrides: JSON.stringify(overrides), updatedAt: now }
  }
  const cascade = !occurrence && !source.parentTaskId && parseRepeatRule(source.repeatRule).kind === 'none' && status !== 'failed'
  return tasks.map(task => task.id === source.id ? updated
    : cascade && task.parentTaskId === source.id ? { ...task, ...taskStatusPatch(task, status, now) } : task)
}

export function removeTask(id) {
  const data = load()
  const occurrence = parseOccurrenceId(id)
  if (occurrence) {
    const source = data.tasks.find(task => task.id === occurrence.sourceId)
    if (!source) throw new Error('事项不存在')
    const overrides = parseOverrides(source)
    overrides[occurrence.date] = { ...overrides[occurrence.date], deleted: true }
    saveTaskData({ ...data, tasks: data.tasks.map(task => task === source ? { ...task, occurrenceOverrides: JSON.stringify(overrides) } : task) })
  } else saveTaskData({ ...data, tasks: data.tasks.filter(item => item.id !== id && item.parentTaskId !== id) })
}

export function setTaskStatus(id, status) {
  const data = load()
  if (!['todo', 'done', 'failed'].includes(status)) throw new Error('事项状态无效')
  const occurrence = parseOccurrenceId(id)
  const source = data.tasks.find(task => task.id === (occurrence?.sourceId || id))
  if (!source) throw new Error('事项不存在')
  if (occurrence && !findTask(id)) throw new Error('当次事项不存在')
  const tasks = applyTaskStatus(data.tasks, source, occurrence, status, Date.now())
  return saveTaskData({ ...data, tasks })
}

export function listChildren(parentId) {
  return load().tasks.filter((item) => item.parentTaskId === (parseOccurrenceId(parentId)?.sourceId || parentId)).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
}

function isVisible(task) {
  return !load().settings.hideCompleted || task.status === 'todo'
}

export function tasksForDate(date) {
  return resolveTasksForDate(listTasks(), date).filter(isVisible).sort(compareTasks)
}

export function tasksGrouped() {
  const today = todayString()
  const weekEnd = addDays(today, 7)
  const todayItems = []
  const weekItems = []
  const laterItems = []
  listTasks().forEach((task) => {
    if (task.parentTaskId || !isVisible(task)) return
    if (occursOn(task, today)) todayItems.push(task)
    else if (task.plannedDate && task.plannedDate > today && task.plannedDate <= weekEnd) weekItems.push(task)
    else laterItems.push(task)
  })
  return [
    { label: '今天', items: todayItems },
    { label: '7天内', items: weekItems },
    { label: '稍后', items: laterItems }
  ].filter((group) => group.items.length)
}

export function getSettings() {
  return load().settings
}

export function setSetting(key, value) {
  const data = load()
  saveStorage({ ...data, settings: { ...data.settings, [key]: value } }, { strict: true, message: '无法保存设置，请重试' })
}

export function toggleGroupCollapsed(label) {
  const data = load()
  const collapsed = [...(data.settings.collapsedGroups || [])]
  const index = collapsed.indexOf(label)
  if (index >= 0) collapsed.splice(index, 1)
  else collapsed.push(label)
  saveStorage({ ...data, settings: { ...data.settings, collapsedGroups: collapsed } }, { strict: true, message: '无法保存设置，请重试' })
  return collapsed
}

export function getProfile() {
  return load().profile
}

export function restoreDemoData() {
  reset()
  void syncTaskReminders(listTasks())
}

function saveTaskData(data) {
  saveStorage(data, { strict: true, message: '无法保存事项，请检查本机存储空间后重试' })
  return syncTaskReminders(data.tasks)
}
