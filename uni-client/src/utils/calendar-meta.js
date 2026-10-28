import { Solar } from 'lunar-typescript'

const commonTraditionalFestivals = new Set(['中元节', '寒衣节', '下元节', '小年', '除夕', '寒食节'])
const majorSolarFestivals = new Set([
  '元旦节', '情人节', '妇女节', '植树节', '愚人节', '劳动节', '青年节', '母亲节', '儿童节',
  '父亲节', '建党节', '建军节', '教师节', '国庆节', '万圣节前夜', '万圣节', '感恩节', '平安夜', '圣诞节'
])

export function resolveCalendarMeta(date) {
  const empty = { lunarLabel: '', marker: null, lunarText: '', markers: [] }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return empty
  const parts = date.split('-').map(Number)
  const parsed = new Date(`${date}T12:00:00`)
  if (!Number.isFinite(parsed.getTime()) || parsed.getFullYear() !== parts[0] || parsed.getMonth() + 1 !== parts[1] || parsed.getDate() !== parts[2]) return empty
  const lunar = Solar.fromYmd(...parts).getLunar()
  const solar = lunar.getSolar()
  const markers = [...new Set([
    ...solar.getFestivals().filter(item => majorSolarFestivals.has(item)),
    ...lunar.getFestivals(),
    ...lunar.getOtherFestivals().filter(item => commonTraditionalFestivals.has(item)),
    lunar.getJieQi()
  ].filter(Boolean))]
  const month = `${lunar.getMonthInChinese()}月`
  return {
    lunarLabel: lunar.getDay() === 1 ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese(),
    marker: markers[0] || null,
    lunarText: `农历${lunar.getYearInChinese()}年${month}${lunar.getDayInChinese()}`,
    markers
  }
}
