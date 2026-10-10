import { load, persist, reset, save as saveStorage } from './storage.js'
import { normalizeAnniversary, prepareAnniversaryRecord } from '../../../shared/anniversary.mjs'
import { occursOn, parseOccurrenceId, parseOverrides, resolveTasksForDate } from '../utils/occurrence.js'
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
  if (category.id) {
    const index = data.categories.findIndex((item) => item.id === category.id)
    if (index >= 0) data.categories[index] = { ...data.categories[index], ...category, updatedAt: now }
  } else {
    category.id = `c${now}`
    category.sortOrder = data.categories.length
    category.createdAt = now
    category.updatedAt = now
    data.categories.push({ ...category })
  }
  persist()
  return category
}

export function reorderCategories(ids) {
  const data = load()
  ids.forEach((id, index) => {
    const cat = data.categories.find((item) => item.id === id)
    if (cat) cat.sortOrder = index
  })
  data.categories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  persist()
}

export function removeCategory(id) {
  const data = load()
  data.categories = data.categories.filter((item) => item.id !== id)
  data.tasks.forEach((task) => { if (task.categoryId === id) task.categoryId = null })
  persist()
}

export function listTasks() {
  return load().tasks
}

export function findTask(id) {
  const occurrence = parseOccurrenceId(id)
  if (occurrence) return resolveTasksForDate(listTasks(), parseOverrides(findTask(occurrence.sourceId) || {})[occurrence.date]?.plannedDate || occurrence.date).find(task => task.id === id) || null
  return load().tasks.find((item) => item.id === id) || null
}

export function saveTask(input, children) {
  const data = load()
  const now = Date.now()
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
  if (children !== undefined) {
    const next = children.filter(child => child.title.trim()).map((child, index) => ({ plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day', reminderOffsets: [], priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', status: 'todo', createdAt: now, ...data.tasks.find(task => task.id === child.id && task.parentTaskId === id), id: child.id || `child-${now}-${index}`, title: child.title.trim(), parentTaskId: id, sortOrder: index, updatedAt: now }))
    tasks = tasks.filter(task => task.parentTaskId !== id).concat(next)
  }
  saveTaskData({ ...data, tasks })
  return occurrence ? findTask(input.id) : saved
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
  let updated = { ...source, status, completedAt: status === 'done' ? Date.now() : null, updatedAt: Date.now() }
  if (occurrence) {
    const item = findTask(id)
    if (!item) throw new Error('当次事项不存在')
    const { title, categoryId, plannedDate, plannedTime, plannedEndTime, scheduleKind, priority, reminderOffsets, notes } = item
    const overrides = parseOverrides(source)
    overrides[occurrence.date] = { title, categoryId, plannedDate, plannedTime, plannedEndTime, scheduleKind, priority, reminderOffsets, notes, ...overrides[occurrence.date], status }
    updated = { ...source, occurrenceOverrides: JSON.stringify(overrides), updatedAt: Date.now() }
  }
  const tasks = data.tasks.map(task => task === source ? updated : !occurrence && status === 'done' && task.parentTaskId === id ? { ...task, status: 'done' } : task)
  saveTaskData({ ...data, tasks })
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
  data.settings[key] = value
  persist()
}

export function toggleGroupCollapsed(label) {
  const data = load()
  const collapsed = [...(data.settings.collapsedGroups || [])]
  const index = collapsed.indexOf(label)
  if (index >= 0) collapsed.splice(index, 1)
  else collapsed.push(label)
  data.settings.collapsedGroups = collapsed
  persist()
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
  void syncTaskReminders(data.tasks)
}
