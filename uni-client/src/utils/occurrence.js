import { parseDate } from './date.js'

export function parseRepeatRule(value) {
  try {
    const rule = JSON.parse(value || '{}')
    return rule && rule.kind ? { interval: 1, endMode: 'never', ...rule } : { kind: 'none' }
  } catch {
    return { kind: 'none' }
  }
}

// 首版支持 none/daily/weekly/monthly/yearly，其余 kind 视为仅起始日发生
export function occursOn(task, date) {
  if (!task.plannedDate || task.parentTaskId || date < task.plannedDate) return false
  const rule = parseRepeatRule(task.repeatRule)
  if (rule.kind === 'none') return task.plannedDate === date

  const start = parseDate(task.plannedDate)
  const target = parseDate(date)
  const days = (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000
  if (rule.endMode === 'date' && rule.endDate && date > rule.endDate) return false
  const interval = Math.max(1, rule.interval || 1)

  let matched = false
  if (rule.kind === 'daily' || rule.kind === 'every_days' || rule.kind === 'custom') {
    matched = days % interval === 0
  } else if (rule.kind === 'weekly') {
    matched = target.getDay() === start.getDay()
  } else if (rule.kind === 'workdays') {
    matched = target.getDay() >= 1 && target.getDay() <= 5
  } else if (rule.kind === 'monthly') {
    matched = target.getDate() === start.getDate()
  } else if (rule.kind === 'yearly') {
    matched = target.getMonth() === start.getMonth() && target.getDate() === start.getDate()
  } else if (rule.kind === 'memory') {
    matched = [1, 3, 7, 14, 29].includes(days)
  } else if (rule.kind === 'weekly_slots') {
    matched = (rule.weekdays || [start.getDay()]).includes(target.getDay())
  } else if (rule.kind === 'monthly_slots') {
    matched = (rule.monthDays || [start.getDate()]).includes(target.getDate())
  }
  if (rule.endMode === 'count' && rule.count) matched = matched && days <= (rule.kind === 'memory' ? 29 : (rule.count - 1) * interval)
  return matched
}

export function parseOccurrenceId(id) {
  const index = typeof id === 'string' ? id.indexOf('@') : -1
  return index > 0 ? { sourceId: id.slice(0, index), date: id.slice(index + 1) } : null
}

export function parseOverrides(task) {
  try { const value = JSON.parse(task.occurrenceOverrides || '{}'); return value && !Array.isArray(value) && typeof value === 'object' ? value : {} } catch { return {} }
}

export function resolveTasksForDate(tasks, date) {
  return tasks.flatMap(task => {
    if (task.parentTaskId) return []
    const repeating = parseRepeatRule(task.repeatRule).kind !== 'none'
    const overrides = parseOverrides(task)
    const direct = overrides[date]
    const terminal = value => value?.status === 'done' || value?.status === 'failed'
    const items = []
    if ((occursOn(task, date) || terminal(direct)) && !direct?.deleted && (direct?.plannedDate === undefined || direct.plannedDate === date)) {
      items.push({ ...task, ...direct, id: repeating ? `${task.id}@${date}` : task.id, status: repeating ? direct?.status || 'todo' : direct?.status || task.status, plannedDate: date })
    }
    for (const [sourceDate, override] of Object.entries(overrides)) {
      if (!override || typeof override !== 'object' || sourceDate === date || override.deleted || override.plannedDate !== date || (!terminal(override) && !occursOn(task, sourceDate))) continue
      items.push({ ...task, ...override, id: `${task.id}@${sourceDate}`, status: override.status || 'todo', plannedDate: date })
    }
    return items
  })
}

export function repeatLabel(kind) {
  return ({ none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' })[kind] || '不重复'
}
