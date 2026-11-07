import { parseDate } from './date.js'

export function parseRepeatRule(value) {
  try {
    const rule = JSON.parse(value || '{}')
    return rule && rule.kind ? { interval: 1, endMode: 'never', ...rule } : { kind: 'none' }
  } catch {
    return { kind: 'none' }
  }
}

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
  if (!matched) return false
  if (rule.endMode !== 'count' || !(Number(rule.count) > 0)) return true
  return occurrenceCount(rule, start, target, days, interval) <= Number(rule.count)
}

// 按源日期计数；周期统计最多遍历一年，不随日期跨度增长。
function occurrenceCount(rule, start, target, days, interval) {
  if (rule.kind === 'daily' || rule.kind === 'every_days' || rule.kind === 'custom') return days / interval + 1
  if (rule.kind === 'weekly') return days / 7 + 1
  if (rule.kind === 'memory') return [1, 3, 7, 14, 29].indexOf(days) + 1
  if (rule.kind === 'workdays' || rule.kind === 'weekly_slots') {
    const weekdays = rule.kind === 'workdays' ? [1, 2, 3, 4, 5] : (rule.weekdays || [start.getDay()])
    const selected = Array.from({ length: 7 }, (_, day) => weekdays.includes(day))
    let count = Math.floor((days + 1) / 7) * selected.filter(Boolean).length
    for (let offset = 0; offset < (days + 1) % 7; offset++) {
      if (selected[(start.getDay() + offset) % 7]) count++
    }
    return count
  }
  if (rule.kind === 'monthly' || rule.kind === 'monthly_slots') {
    const monthDays = rule.kind === 'monthly' ? [start.getDate()] : (rule.monthDays || [start.getDate()])
    return monthlyCountThrough(target, monthDays) - monthlyCountThrough(start, monthDays) + (monthDays.includes(start.getDate()) ? 1 : 0)
  }
  if (rule.kind === 'yearly') {
    if (start.getMonth() === 1 && start.getDate() === 29) return leapYearsThrough(target.getFullYear()) - leapYearsThrough(start.getFullYear() - 1)
    return target.getFullYear() - start.getFullYear() + 1
  }
  return 0
}

function leapYearsThrough(year) {
  return Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400)
}

function monthlyCountThrough(date, monthDays) {
  const year = date.getFullYear()
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const validDays = Array.from({ length: 31 }, (_, index) => index + 1).filter(day => monthDays.includes(day))
  const regularYearCount = lengths.reduce((sum, length) => sum + validDays.filter(day => day <= length).length, 0)
  let count = (year - 1) * regularYearCount + (monthDays.includes(29) ? leapYearsThrough(year - 1) : 0)
  if (leapYearsThrough(year) !== leapYearsThrough(year - 1)) lengths[1] = 29
  for (let month = 0; month <= date.getMonth(); month++) {
    const limit = month === date.getMonth() ? date.getDate() : lengths[month]
    count += validDays.filter(day => day <= limit).length
  }
  return count
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
