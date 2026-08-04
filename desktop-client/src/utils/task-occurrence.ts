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

export function occursOn(item: Task, date: string) {
  if (!item.plannedDate || item.parentTaskId || date < item.plannedDate) return false
  const rule = parseRepeatRule(item.repeatRule)
  if (rule.kind === 'none') return item.plannedDate === date

  const start = parseDate(item.plannedDate)
  const target = parseDate(date)
  const days = Math.floor((target.getTime() - start.getTime()) / 86400000)
  if (rule.endMode === 'date' && rule.endDate && date > rule.endDate) return false

  const interval = Math.max(1, rule.interval || 1)
  let matched = rule.kind === 'daily' || rule.kind === 'every_days' || rule.kind === 'custom'
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
  if (rule.endMode === 'count' && rule.count) {
    const maxDays = rule.kind === 'memory' ? 29 : (rule.count - 1) * interval
    matched &&= days <= maxDays
  }
  return matched
}

export function tasksForDate(tasks: Task[], date: string) {
  return tasks.flatMap(item => {
    if (item.parentTaskId) return []
    const overrides = parseOverrides(item)
    const result: Task[] = []
    if (occursOn(item, date) && !overrides[date]?.deleted) {
      result.push({ ...item, ...overrides[date], id: item.plannedDate === date ? item.id : `${item.id}@${date}`, plannedDate: date })
    }
    Object.entries(overrides).forEach(([sourceDate, override]) => {
      if (override.plannedDate === date && sourceDate !== date && occursOn(item, sourceDate)) {
        result.push({ ...item, ...override, id: `${item.id}@${sourceDate}`, plannedDate: date })
      }
    })
    return result
  })
}

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`)
}
