import { load, persist, reset } from './storage'
import { occursOn } from '../utils/occurrence'
import { addDays, todayString } from '../utils/date'

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
  return load().tasks.find((item) => item.id === id) || null
}

export function saveTask(task) {
  const data = load()
  const now = Date.now()
  if (task.id) {
    const index = data.tasks.findIndex((item) => item.id === task.id)
    if (index >= 0) data.tasks[index] = { ...data.tasks[index], ...task, updatedAt: now }
  } else {
    task.id = `t${now}`
    task.createdAt = now
    task.updatedAt = now
    data.tasks.unshift({ ...task })
  }
  persist()
  return task
}

export function removeTask(id) {
  const data = load()
  data.tasks = data.tasks.filter((item) => item.id !== id && item.parentTaskId !== id)
  persist()
}

export function setTaskStatus(id, status) {
  const data = load()
  const task = data.tasks.find((item) => item.id === id)
  if (task) {
    task.status = status
    task.completedAt = status === 'done' ? Date.now() : null
    task.updatedAt = Date.now()
    if (status === 'done') data.tasks.forEach((child) => { if (child.parentTaskId === id) child.status = 'done' })
    persist()
  }
}

export function listChildren(parentId) {
  return load().tasks.filter((item) => item.parentTaskId === parentId)
}

export function saveChildren(parentId, titles) {
  const data = load()
  const now = Date.now()
  const existing = data.tasks.filter((item) => item.parentTaskId === parentId)
  const next = titles.map((title, index) => {
    const match = existing[index]
    return match
      ? { ...match, title, sortOrder: index, updatedAt: now }
      : { id: `t${now}${index}`, title, categoryId: null, plannedDate: null, plannedTime: null, scheduleKind: 'all_day', priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', parentTaskId, status: 'todo', notes: '', sortOrder: index, createdAt: now, updatedAt: now }
  })
  data.tasks = data.tasks.filter((item) => item.parentTaskId !== parentId).concat(next)
  persist()
}

function isVisible(task) {
  return !load().settings.hideCompleted || task.status !== 'done'
}

export function tasksForDate(date) {
  return listTasks().filter((task) => isVisible(task) && occursOn(task, date))
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
}
