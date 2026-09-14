import { parseDate } from './date'

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
  const days = Math.floor((target.getTime() - start.getTime()) / 86400000)
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
  return matched
}

export function repeatLabel(kind) {
  return ({ none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' })[kind] || '不重复'
}
