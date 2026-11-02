const pad = (number) => String(number).padStart(2, '0')

export function parseDate(value) {
  return new Date(`${value}T12:00:00`)
}

export function todayString() {
  const date = new Date()
  return iso(date)
}

export function iso(value) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

export function addDays(value, amount) {
  const date = parseDate(value)
  date.setDate(date.getDate() + amount)
  return iso(date)
}

export function shortDate(value) {
  const date = parseDate(value)
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

export function weekday(value) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseDate(value).getDay()]
}

export function monthTitle(value) {
  const date = parseDate(value)
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

// 返回以周一为起始的 42 格月历日期（对齐原型 monthDates）
export function monthDates(anchor) {
  const date = parseDate(anchor)
  date.setDate(1)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const result = new Date(date)
    result.setDate(result.getDate() + index)
    return iso(result)
  })
}

export function shiftMonth(anchor, amount) {
  const date = parseDate(anchor)
  date.setMonth(date.getMonth() + amount, 1)
  return iso(date)
}

// 返回以周一为起始的 7 天周日期，与月历的周起始保持一致
export function weekDates(anchor) {
  const date = parseDate(anchor)
  date.setDate(date.getDate() - (date.getDay() + 6) % 7)
  return Array.from({ length: 7 }, (_, index) => {
    const result = new Date(date)
    result.setDate(result.getDate() + index)
    return iso(result)
  })
}

export function weekTitle(dates) {
  const start = parseDate(dates[0])
  const end = parseDate(dates[6])
  const startYear = start.getFullYear()
  const endYear = end.getFullYear()
  const startMonth = start.getMonth() + 1
  const endMonth = end.getMonth() + 1
  if (startYear !== endYear) return `${startYear}年${startMonth}月${start.getDate()}日 – ${endYear}年${endMonth}月${end.getDate()}日`
  if (startMonth !== endMonth) return `${startYear}年${startMonth}月${start.getDate()}日 – ${endMonth}月${end.getDate()}日`
  return `${startYear}年${startMonth}月${start.getDate()}日 – ${end.getDate()}日`
}
