export const anniversaryTypes = [
  { value: 'countdown', label: '倒计时', mark: '◷' },
  { value: 'anniversary', label: '纪念日', mark: '♡' },
  { value: 'birthday', label: '生日', mark: '🎂' },
  { value: 'holiday', label: '节日', mark: '◇' }
]
export const anniversaryThemes = [
  { value: 'sky', label: '晴空' }, { value: 'warm', label: '暖色' }, { value: 'night', label: '星夜' }
]
export const MAX_PHOTO_BYTES = 300 * 1024

export function localToday() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dateOrdinal(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效的公历日期')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new Error('请选择有效的公历日期')
  return date.getTime() / 86400000
}

function dateInYear(value, year) {
  const [, month, day] = value.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

export function anniversaryOccurrence(item, date, record = null) {
  const years = Number(date.slice(0, 4)) - Number(item.date.slice(0, 4))
  const suffix = item.kind === 'birthday' ? (years ? `${years}岁生日` : '出生纪念')
    : item.kind === 'anniversary' ? (years ? `${years}周年` : '纪念日') : ''
  return { anniversaryId: item.id, date, title: item.title, kind: item.kind, originalDate: item.date,
    notes: item.notes, label: suffix ? `${item.title} · ${suffix}` : item.title,
    years, adjusted: item.kind !== 'countdown' && date.slice(5) !== item.date.slice(5), record }
}

export function anniversaryOccurrences(items, startDate, endDate, records = []) {
  dateOrdinal(startDate)
  dateOrdinal(endDate)
  if (startDate > endDate) throw new Error('日期范围无效')
  const recordMap = new Map(records.map(record => [`${record.anniversaryId}:${record.date}`, record]))
  const result = []
  const sorted = [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  for (const item of sorted) {
    dateOrdinal(item.date)
    const firstYear = Number(startDate.slice(0, 4))
    const lastYear = Number(endDate.slice(0, 4))
    for (let year = firstYear; year <= lastYear; year++) {
      const date = item.kind === 'countdown' ? item.date : dateInYear(item.date, year)
      if (date >= startDate && date <= endDate && date >= item.date) {
        result.push(anniversaryOccurrence(item, date, recordMap.get(`${item.id}:${date}`) || null))
      }
      if (item.kind === 'countdown') break
    }
  }
  return result
}

export function anniversaryRecordOccurrence(record, notes = '') {
  return anniversaryOccurrence({ id: record.anniversaryId, title: record.title, kind: record.kind, date: record.originalDate, notes }, record.date, record)
}

export function prepareAnniversaryRecord(item, input, previous = null, today = localToday()) {
  dateOrdinal(input.date)
  if (input.date > '2100-12-31') throw new Error('日期范围为 1900 至 2100 年')
  const notes = String(input.notes || '').trim()
  if ([...notes].length > 2000) throw new Error('本次备注不能超过 2000 个字')
  if (input.date > today) throw new Error('只能记录当天或过去的纪念日')
  if (!previous && !anniversaryOccurrences([item], input.date, input.date).length) throw new Error('日期与纪念日规则不匹配')
  const now = Date.now()
  return { anniversaryId: item.id, date: input.date, notes,
    confirmedAt: input.confirmed ? previous?.confirmedAt ?? now : null,
    title: previous?.title ?? item.title, kind: previous?.kind ?? item.kind,
    originalDate: previous?.originalDate ?? item.date,
    createdAt: previous?.createdAt ?? now, updatedAt: now }
}

export function anniversaryState(item, today = localToday()) {
  const original = dateOrdinal(item.date)
  const current = dateOrdinal(today)
  let nextDate = item.date
  if (item.kind !== 'countdown' && original <= current) {
    const year = Number(today.slice(0, 4))
    nextDate = dateInYear(item.date, year)
    if (dateOrdinal(nextDate) < current) nextDate = dateInYear(item.date, year + 1)
  }
  const difference = dateOrdinal(nextDate) - current
  const elapsedDays = Math.max(0, current - original)
  const [startYear, startMonth, startDay] = item.date.split('-').map(Number)
  const [endYear, endMonth] = today.split('-').map(Number)
  let months = Math.max(0, (endYear - startYear) * 12 + endMonth - startMonth)
  const monthAnchor = (count) => {
    const monthStart = new Date(Date.UTC(startYear, startMonth - 1 + count, 1))
    const year = monthStart.getUTCFullYear()
    const month = monthStart.getUTCMonth()
    return Date.UTC(year, month, Math.min(startDay, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())) / 86400000
  }
  if (months && monthAnchor(months) > current) months--
  const years = Math.floor(months / 12)
  const remainingDays = original > current ? 0 : current - monthAnchor(months)
  let age = Math.max(0, endYear - startYear)
  if (today < dateInYear(item.date, endYear)) age = Math.max(0, age - 1)
  return {
    nextDate, days: Math.abs(difference), label: difference === 0 ? '就是今天' : difference > 0 ? '还有' : '已经',
    past: item.kind === 'countdown' && difference < 0, elapsedDays,
    elapsedText: `${years}年 ${months % 12}个月 ${remainingDays}天`,
    age, nextAge: Number(nextDate.slice(0, 4)) - startYear,
    adjusted: item.kind !== 'countdown' && nextDate.slice(5) !== item.date.slice(5)
  }
}

export function orderedAnniversaries(items, today = localToday()) {
  return items.map(item => ({ ...item, state: anniversaryState(item, today) })).sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || Number(a.state.past) - Number(b.state.past)
    || a.state.nextDate.localeCompare(b.state.nextDate) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export function normalizeAnniversary(input, today = localToday()) {
  const title = String(input.title || '').trim()
  const notes = String(input.notes || '').trim()
  if (!title || [...title].length > 120) throw new Error('名称需为 1 至 120 个字')
  if ([...notes].length > 2000) throw new Error('备注不能超过 2000 个字')
  if (!anniversaryTypes.some(item => item.value === input.kind)) throw new Error('请选择有效的类型')
  if (!anniversaryThemes.some(item => item.value === input.theme)) throw new Error('请选择有效的背景')
  dateOrdinal(input.date)
  if (input.date > '2100-12-31') throw new Error('日期范围为 1900 至 2100 年')
  if (input.kind === 'birthday' && input.date > today) throw new Error('出生日期不能晚于今天')
  const photos = input.photos || []
  if (!Array.isArray(photos) || photos.length > 4) throw new Error('每条最多添加 4 张照片')
  for (const photo of photos) {
    if (typeof photo !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) throw new Error('照片必须为 JPEG 图片')
    const encoded = photo.slice(23)
    const bytes = encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
    if (bytes < 32) throw new Error('照片数据无效')
    if (bytes > MAX_PHOTO_BYTES) throw new Error('单张照片不能超过 300KiB')
    // 安卓 JS 运行时未必提供 atob，只解码末尾两个字节确认 JPEG 结束标记。
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const tail = []
    let bits = 0
    let buffer = 0
    for (const character of encoded.slice(-8).replace(/=+$/, '')) {
      buffer = (buffer << 6) | alphabet.indexOf(character)
      bits += 6
      if (bits >= 8) { bits -= 8; tail.push((buffer >> bits) & 255) }
    }
    if (encoded.length % 4 || !encoded.startsWith('/9j/') || tail[tail.length - 2] !== 255 || tail[tail.length - 1] !== 217) throw new Error('照片数据无效')
  }
  const coverIndex = photos.length ? input.coverIndex ?? 0 : 0
  if (!Number.isInteger(coverIndex) || coverIndex < 0 || (!photos.length && input.coverIndex !== 0) || (photos.length && coverIndex >= photos.length)) throw new Error('请选择有效的封面')
  return { id: input.id || undefined, kind: input.kind, title, date: input.date, notes, pinned: Boolean(input.pinned), theme: input.theme, photos, coverIndex }
}
