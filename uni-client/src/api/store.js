import { load, reset, save as saveStorage } from './storage.js'
import { normalizeAnniversary, prepareAnniversaryRecord } from '../../../shared/anniversary.mjs'
import { occursOn, parseOccurrenceId, parseOverrides, parseRepeatRule, resolveTasksForDate } from '../utils/occurrence.js'
import { addDays, todayString } from '../utils/date.js'
import { compareTasks, normalizeTask } from '../utils/task.js'
import { syncTaskReminders } from './reminders.js'
import { cloneData, sameData } from './sync-outbox.js'

const isActive = item => item.deletedAt == null
const tombstone = (item, now) => isActive(item) ? { ...item, deletedAt: now, updatedAt: now } : item

export function listAnniversaries() {
  return load().anniversaries.filter(isActive).map(({ photos, coverIndex, ...summary }) => summary)
}

export function listAnniversaryRecords({ anniversaryId, startDate, endDate } = {}) {
  if (anniversaryId) getAnniversary(anniversaryId)
  return load().anniversaryRecords.filter(record => isActive(record) && (!anniversaryId || record.anniversaryId === anniversaryId)
    && (!startDate || record.date >= startDate) && (!endDate || record.date <= endDate))
    .sort((a, b) => b.date.localeCompare(a.date)).map(record => ({ ...record }))
}

export function getAnniversaryRecordSnapshot(anniversaryId, date, displayedRecord) {
  if (displayedRecord) return cloneData(displayedRecord)
  // 界面不显示墓碑，但编辑期间仍需检测墓碑被替换或更新。
  const current = load().anniversaryRecords.find(record => record.anniversaryId === anniversaryId && record.date === date)
  return current && !isActive(current) ? cloneData(current) : null
}

export function saveAnniversaryRecord(input, options) {
  const data = load()
  const records = [...data.anniversaryRecords]
  const index = records.findIndex(record => record.anniversaryId === input.anniversaryId && record.date === input.date)
  if (options && Object.hasOwn(options, 'expectedSnapshot') && !sameData(index >= 0 ? records[index] : null, options.expectedSnapshot)) {
    throw new Error('纪念记录已在其他位置更改，请保留草稿并关闭后重新打开')
  }
  const item = data.anniversaries.find(item => isActive(item) && item.id === input.anniversaryId)
  if (!item) throw new Error('纪念日不存在')
  const result = { ...prepareAnniversaryRecord(item, input, index >= 0 && isActive(records[index]) ? records[index] : null), deletedAt: null }
  if (index >= 0) records[index] = result
  else records.push(result)
  saveStorage({ ...data, anniversaryRecords: records }, { strict: true })
  return cloneData(load().anniversaryRecords.find(record => record.anniversaryId === input.anniversaryId && record.date === input.date))
}

export function getAnniversary(id) {
  const item = load().anniversaries.find(item => isActive(item) && item.id === id)
  if (!item) throw new Error('纪念日不存在')
  return { ...item, photos: [...item.photos] }
}

export function saveAnniversary(input, options) {
  const normalized = normalizeAnniversary(input)
  const data = load()
  const items = [...data.anniversaries]
  const index = normalized.id ? items.findIndex(item => isActive(item) && item.id === normalized.id) : -1
  if (normalized.id && options && Object.hasOwn(options, 'expectedSnapshot') && !sameData(index >= 0 ? items[index] : null, options.expectedSnapshot)) {
    throw new Error('纪念日已在其他位置更改，请保留草稿并关闭后重新打开')
  }
  if (normalized.id && index < 0) throw new Error('纪念日不存在')
  const now = Date.now()
  const item = { ...normalized, photos: [...normalized.photos], id: normalized.id || `a${now}-${Math.random().toString(36).slice(2, 10)}`, createdAt: index >= 0 ? items[index].createdAt : now, updatedAt: now }
  if (index >= 0) items[index] = item
  else items.push(item)
  saveStorage({ ...data, anniversaries: items }, { strict: true })
  return cloneData(load().anniversaries.find(saved => saved.id === item.id))
}

export function removeAnniversary(id) {
  const data = load()
  if (!data.anniversaries.some(item => isActive(item) && item.id === id)) throw new Error('纪念日不存在')
  const now = Date.now()
  saveStorage({ ...data, anniversaries: data.anniversaries.map(item => item.id === id ? tombstone(item, now) : item), anniversaryRecords: data.anniversaryRecords.map(record => record.anniversaryId === id ? tombstone(record, now) : record) }, { strict: true })
}

export function pinAnniversary(id, pinned) {
  const data = load()
  if (!data.anniversaries.some(item => isActive(item) && item.id === id)) throw new Error('纪念日不存在')
  const items = data.anniversaries.map(item => isActive(item) && item.id === id ? { ...item, pinned, updatedAt: Date.now() } : item)
  saveStorage({ ...data, anniversaries: items }, { strict: true })
}

export function getCategories() {
  return load().categories.filter(isActive)
}

export function categoryById(id) {
  return getCategories().find((item) => item.id === id) || null
}

export function saveCategory(category) {
  const data = load()
  const now = Date.now()
  const categories = [...data.categories]
  const index = category.id ? categories.findIndex(item => isActive(item) && item.id === category.id) : -1
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
  const categories = data.categories.map(item => isActive(item) && orders.has(item.id) ? { ...item, sortOrder: orders.get(item.id) } : item)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  saveStorage({ ...data, categories }, { strict: true, message: '无法保存分类顺序，请重试' })
}

export function removeCategory(id) {
  const data = load()
  const now = Date.now()
  const categories = data.categories.map(item => item.id === id ? tombstone(item, now) : item)
  const tasks = data.tasks.map(task => isActive(task) && task.categoryId === id ? { ...task, categoryId: null } : task)
  saveStorage({ ...data, categories, tasks }, { strict: true, message: '无法删除分类，请重试' })
}

export function listTasks() {
  return load().tasks.filter(isActive)
}

function findTaskInData(data, id) {
  const occurrence = parseOccurrenceId(id)
  const tasks = data.tasks.filter(isActive)
  if (occurrence) {
    const source = tasks.find(task => task.id === occurrence.sourceId)
    if (!source) return null
    return resolveTasksForDate([source], parseOverrides(source)[occurrence.date]?.plannedDate || occurrence.date).find(task => task.id === id) || null
  }
  return tasks.find(item => item.id === id) || null
}

export function findTask(id) {
  return findTaskInData(load(), id)
}

function taskSnapshot(data, id) {
  const occurrence = parseOccurrenceId(id)
  const source = data.tasks.find(task => isActive(task) && task.id === (occurrence?.sourceId || id))
  if (!source) return null
  if (occurrence) {
    const overrides = parseOverrides(source)
    const date = overrides[occurrence.date]?.plannedDate || occurrence.date
    if (!resolveTasksForDate([source], date).some(task => task.id === id)) return null
    // 其他实例只改变 overrides 和记录元数据，不影响当次草稿。
    const { occurrenceOverrides, updatedAt, deviceId, ...base } = source
    return cloneData({ id, source: base, hasOverride: Object.hasOwn(overrides, occurrence.date), override: overrides[occurrence.date] ?? null })
  }
  const ids = new Set([id])
  let size
  do {
    size = ids.size
    for (const task of data.tasks) if (isActive(task) && ids.has(task.parentTaskId)) ids.add(task.id)
  } while (size !== ids.size)
  return cloneData({ id, source, children: data.tasks.filter(task => isActive(task) && task.id !== id && ids.has(task.id)).sort((a, b) => a.id.localeCompare(b.id)) })
}

export function getTaskSnapshot(id) {
  return taskSnapshot(load(), id)
}

function checkTaskSnapshot(data, id, options) {
  if (!Object.hasOwn(options, 'expectedSnapshot')) return
  const current = taskSnapshot(data, id)
  if (!current || !sameData(current, options.expectedSnapshot)) {
    const error = new Error('事项已在其他位置更改或删除，请保留草稿，放弃后关闭并重新打开')
    error.code = 'TASK_CONFLICT'
    throw error
  }
}

// 草稿、父子状态与新建默认值同次严格落盘；返回 reminderPromise 供 UI 等待排程。
export function saveTask(input, children, options = {}) {
  const data = load()
  const now = Date.now()
  if (options.status !== undefined && !['todo', 'done', 'failed'].includes(options.status)) throw new Error('事项状态无效')
  const occurrence = input.id ? parseOccurrenceId(input.id) : null
  if (input.id) checkTaskSnapshot(data, input.id, options)
  const sourceId = occurrence?.sourceId || input.id
  const existing = sourceId ? data.tasks.find(task => isActive(task) && task.id === sourceId) : null
  if (sourceId && !existing) throw new Error('事项不存在')
  const effective = occurrence ? findTask(input.id) : existing
  if (occurrence && !effective) throw new Error('当次事项不存在')
  const normalized = normalizeTask({ ...effective, ...input })
  if (normalized.categoryId != null && !data.categories.some(category => isActive(category) && category.id === normalized.categoryId)) throw new Error('分类不存在，请重新选择')
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
      const old = child.id ? data.tasks.find(task => isActive(task) && task.id === child.id) : null
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
    const childIds = new Set(next.map(child => child.id))
    tasks = tasks.map(task => task.parentTaskId === id && !childIds.has(task.id) ? tombstone(task, now) : task)
      .filter(task => !childIds.has(task.id)).concat(next)
    if (next.length && !saved.parentTaskId && saved.status !== 'failed' && parseRepeatRule(saved.repeatRule).kind === 'none') {
      const status = next.every(child => child.status === 'done') ? 'done' : saved.status === 'done' ? 'todo' : saved.status
      saved = { ...saved, ...taskStatusPatch(saved, status, now, true) }
      tasks = tasks.map(task => task.id === id ? saved : task)
    }
  }
  if (options.status !== undefined) tasks = applyTaskStatus(tasks, saved, occurrence, options.status, now)
  const defaults = { categoryId: normalized.categoryId ?? null, priority: normalized.priority }
  const previous = data.settings.newTaskDefaults
  const settings = options.rememberDefaults === true && !occurrence && !normalized.parentTaskId
    && (previous?.categoryId !== defaults.categoryId || previous?.priority !== defaults.priority)
    ? { ...data.settings, newTaskDefaults: { ...previous, ...defaults } } : data.settings
  const written = { ...data, tasks, settings }
  const reminderPromise = saveTaskData(written)
  const resultId = occurrence ? input.id : id
  const result = { ...(occurrence ? findTaskInData(written, resultId) : tasks.find(task => task.id === id)) }
  Object.defineProperty(result, 'taskSnapshot', { value: taskSnapshot(written, resultId) })
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
    : cascade && isActive(task) && task.parentTaskId === source.id ? { ...task, ...taskStatusPatch(task, status, now) } : task)
}

export function removeTask(id, options = {}) {
  const data = load()
  checkTaskSnapshot(data, id, options)
  const occurrence = parseOccurrenceId(id)
  if (occurrence) {
    const source = data.tasks.find(task => isActive(task) && task.id === occurrence.sourceId)
    if (!source) throw new Error('事项不存在')
    const overrides = parseOverrides(source)
    overrides[occurrence.date] = { ...overrides[occurrence.date], deleted: true }
    saveTaskData({ ...data, tasks: data.tasks.map(task => task === source ? { ...task, occurrenceOverrides: JSON.stringify(overrides) } : task) })
  } else {
    const now = Date.now()
    const removed = new Set([id])
    // 兼容历史数据中的多层子事项，整棵子树同次落盘。
    let size
    do {
      size = removed.size
      for (const item of data.tasks) if (removed.has(item.parentTaskId)) removed.add(item.id)
    } while (size !== removed.size)
    saveTaskData({ ...data, tasks: data.tasks.map(item => removed.has(item.id) ? tombstone(item, now) : item) })
  }
}

export function setTaskStatus(id, status) {
  const data = load()
  if (!['todo', 'done', 'failed'].includes(status)) throw new Error('事项状态无效')
  const occurrence = parseOccurrenceId(id)
  const source = data.tasks.find(task => isActive(task) && task.id === (occurrence?.sourceId || id))
  if (!source) throw new Error('事项不存在')
  if (occurrence && !findTask(id)) throw new Error('当次事项不存在')
  const tasks = applyTaskStatus(data.tasks, source, occurrence, status, Date.now())
  return saveTaskData({ ...data, tasks })
}

export function listChildren(parentId) {
  return listTasks().filter((item) => item.parentTaskId === (parseOccurrenceId(parentId)?.sourceId || parentId)).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
}

function isVisible(task, view) {
  return !getHideCompleted(view) || task.status === 'todo'
    || (view === 'tasks' && parseRepeatRule(task.repeatRule).kind !== 'none')
}

export function tasksForDate(date) {
  return resolveTasksForDate(listTasks(), date).filter(task => isVisible(task, 'month')).sort(compareTasks)
}

export function tasksGrouped() {
  const today = todayString()
  const weekEnd = addDays(today, 7)
  const todayItems = []
  const weekItems = []
  const laterItems = []
  listTasks().forEach((task) => {
    if (task.parentTaskId || !isVisible(task, 'tasks')) return
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

export function getHideCompleted(view) {
  if (!['tasks', 'month'].includes(view)) throw new Error('视图无效')
  const settings = getSettings()
  const value = settings.hideCompletedByView?.[view]
  return typeof value === 'boolean' ? value : typeof settings.hideCompleted === 'boolean' ? settings.hideCompleted : true
}

export function setHideCompleted(view, value) {
  if (!['tasks', 'month'].includes(view) || typeof value !== 'boolean') throw new Error('视图设置无效')
  setSetting('hideCompletedByView', { ...getSettings().hideCompletedByView, [view]: value })
}

export function getNewTaskDefaults() {
  const data = load()
  const defaults = data.settings.newTaskDefaults
  const categoryId = defaults?.categoryId === null ? null
    : data.categories.some(category => isActive(category) && category.id === defaults?.categoryId) ? defaults.categoryId : getCategories()[0]?.id ?? null
  const priority = ['urgent_important', 'important_not_urgent', 'urgent_not_important', 'not_urgent_not_important'].includes(defaults?.priority)
    ? defaults.priority : 'not_urgent_not_important'
  return { categoryId, priority }
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
  return syncTaskReminders(listTasks())
}
