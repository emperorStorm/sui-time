import { Solar } from 'lunar-typescript'

export interface CalendarMeta {
  lunarLabel: string
  marker: string | null
}

const commonTraditionalFestivals = new Set(['中元节', '寒衣节', '下元节', '小年', '除夕', '寒食节'])
const majorSolarFestivals = new Set([
  '元旦节', '情人节', '妇女节', '植树节', '愚人节', '劳动节', '青年节', '母亲节', '儿童节',
  '父亲节', '建党节', '建军节', '教师节', '国庆节', '万圣节前夜', '万圣节', '感恩节', '平安夜', '圣诞节',
])

export function resolveCalendarMeta(date: string): CalendarMeta {
  const parts = date.split('-').map(Number)
  if (parts.length !== 3 || parts.some(value => !Number.isInteger(value))) return { lunarLabel: '', marker: null }

  const solar = Solar.fromYmd(parts[0], parts[1], parts[2])
  const lunar = solar.getLunar()
  const lunarLabel = lunar.getDay() === 1 ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese()
  const marker = solar.getFestivals().find(item => majorSolarFestivals.has(item))
    || lunar.getFestivals()[0]
    || lunar.getOtherFestivals().find(item => commonTraditionalFestivals.has(item))
    || lunar.getJieQi()
    || null
  return { lunarLabel, marker }
}
