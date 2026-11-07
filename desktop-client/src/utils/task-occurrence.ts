import type { RepeatRule, Task } from '../types'

export function parseRepeatRule(value: string): RepeatRule {
  try {
    const rule = JSON.parse(value) as RepeatRule
    return rule?.kind ? { interval: 1, endMode: 'never', ...rule } : { kind: 'none' }
  } catch {
    return { kind: 'none' }
  }
}

export function parseOverrides(item: Task): Record<string, Partial<Task> & { deleted?: boolean }> {
  try {
    return JSON.parse(item.occurrenceOverrides || '{}')
  } catch {
    return {}
  }
}

export function isRepeatingTask(item: Task) {
  return parseRepeatRule(item.repeatRule).kind !== 'none'
}

export function occurrenceId(sourceId: string, date: string) {
  return `${sourceId}@${date}`
}

export function parseOccurrenceId(value: string) {
  const separator = value.indexOf('@')
  if (separator < 1 || separator === value.length - 1) return null
  return { sourceId: value.slice(0, separator), date: value.slice(separator + 1) }
}

export function occursOn(item: Task, date: string) {
  if (!item.plannedDate || item.parentTaskId || date < item.plannedDate) return false
  const rule = parseRepeatRule(item.repeatRule)
  if (rule.kind === 'none') return item.plannedDate === date

  const start = parseDate(item.plannedDate)
  const target = parseDate(date)
  const days = (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000
  if (rule.endMode === 'date' && rule.endDate && date > rule.endDate) return false

  const interval = Math.max(1, rule.interval || 1)
  const matched = rule.kind === 'daily' || rule.kind === 'every_days' || rule.kind === 'custom'
    ? days % interval === 0
    : rule.kind === 'weekly'
      ? target.getDay() === start.getDay()
      : rule.kind === 'workdays'
        ? target.getDay() >= 1 && target.getDay() <= 5
        : rule.kind === 'monthly'
          ? target.getDate() === start.getDate()
          : rule.kind === 'yearly'
            ? target.getMonth() === start.getMonth() && target.getDate() === start.getDate()
            : rule.kind === 'memory'
              ? [1, 3, 7, 14, 29].includes(days)
              : rule.kind === 'weekly_slots'
                ? (rule.weekdays || [start.getDay()]).includes(target.getDay())
                : rule.kind === 'monthly_slots'
                  ? (rule.monthDays || [start.getDate()]).includes(target.getDate())
                  : false
  if (!matched) return false
  if (rule.endMode !== 'count' || !(Number(rule.count) > 0)) return true
  return occurrenceCount(rule, start, target, days, interval) <= Number(rule.count)
}

// 按源日期计数；周期统计最多遍历一年，不随日期跨度增长。
function occurrenceCount(rule: RepeatRule, start: Date, target: Date, days: number, interval: number) {
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

function leapYearsThrough(year: number) {
  return Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400)
}

function monthlyCountThrough(date: Date, monthDays: number[]) {
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

export function tasksForDate(tasks: Task[], date: string) {
  return tasks.flatMap(item => {
    if (item.parentTaskId) return []
    const overrides = parseOverrides(item)
    const repeating = isRepeatingTask(item)
    const result: Task[] = []
    const directOverride = overrides[date]
    if ((occursOn(item, date) || isTerminalOverride(directOverride)) && !directOverride?.deleted && (directOverride?.plannedDate === undefined || directOverride.plannedDate === date)) {
      result.push({
        ...item,
        ...directOverride,
        id: repeating ? occurrenceId(item.id, date) : item.id,
        status: repeating ? (directOverride?.status || 'todo') : (directOverride?.status || item.status),
        plannedDate: date,
      })
    }
    if (result.length) return result
    Object.entries(overrides).forEach(([sourceDate, override]) => {
      if (result.length) return
      if (sourceDate === date || override.plannedDate !== date) return
      if (!isTerminalOverride(override) && !occursOn(item, sourceDate)) return
      result.push({ ...item, ...override, id: occurrenceId(item.id, sourceDate), status: override.status || 'todo', plannedDate: date })
    })
    return result
  })
}

function isTerminalOverride(override: Partial<Task> & { deleted?: boolean } | undefined) {
  return override?.status === 'done' || override?.status === 'failed'
}

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`)
}
