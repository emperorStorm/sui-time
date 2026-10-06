import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anniversaryState, dateOrdinal, normalizeAnniversary, orderedAnniversaries, anniversaryOccurrences, prepareAnniversaryRecord, anniversaryRecordOccurrence } from './anniversary.mjs'
import { Solar as DesktopSolar } from '../desktop-client/node_modules/lunar-typescript/dist/index.mjs'
import { Solar as MobileSolar } from '../uni-client/node_modules/lunar-typescript/dist/index.mjs'

test('固定日期：当天、过去、未来与跨年', () => {
  const fixed = date => anniversaryState({ kind: 'countdown', date }, '2026-12-31')
  assert.equal(fixed('2026-12-31').label, '就是今天')
  assert.equal(fixed('2027-01-01').days, 1)
  assert.equal(fixed('2026-12-30').label, '已经')
  assert.equal(fixed('2026-12-30').days, 1)
})

test('周年原始日期、当天命中与跨年推进', () => {
  const item = { kind: 'anniversary', date: '2017-02-01' }
  const result = anniversaryState(item, '2026-10-06')
  assert.equal(result.nextDate, '2027-02-01')
  assert.equal(result.elapsedText, '9年 8个月 5天')
  assert.equal(result.days, 118)
  assert.equal(anniversaryState(item, '2027-02-01').days, 0)
  assert.equal(anniversaryState(item, '2027-02-02').nextDate, '2028-02-01')
  assert.equal(anniversaryState({ ...item, date: '2027-02-01' }, '2026-10-06').elapsedDays, 0)
})

test('闰日每年按月末纪念，周岁以调整日期计算', () => {
  const item = { kind: 'birthday', date: '2024-02-29' }
  assert.equal(anniversaryState(item, '2025-02-27').age, 0)
  const result = anniversaryState(item, '2025-02-28')
  assert.equal(result.age, 1)
  assert.equal(result.nextDate, '2025-02-28')
  assert.equal(result.adjusted, true)
  assert.equal(anniversaryState(item, '2028-02-28').nextDate, '2028-02-29')
  assert.equal(anniversaryState(item, '2028-02-28').adjusted, false)
})

test('月底的完整年月日不溢出，出生日期使用真实周岁', () => {
  assert.equal(anniversaryState({ kind: 'anniversary', date: '2024-01-31' }, '2024-02-29').elapsedText, '0年 1个月 0天')
  assert.equal(anniversaryState({ kind: 'anniversary', date: '2024-01-31' }, '2024-03-30').elapsedText, '0年 1个月 30天')
  const birthday = anniversaryState({ kind: 'birthday', date: '2023-12-13' }, '2026-10-06')
  assert.equal(birthday.age, 2)
  assert.equal(birthday.nextAge, 3)
})

test('两端农历、出生年生肖与星座一致', () => {
  for (const Solar of [DesktopSolar, MobileSolar]) {
    const original = Solar.fromYmd(2023, 12, 13)
    const upcoming = Solar.fromYmd(2026, 12, 13)
    assert.equal(original.getLunar().getYearShengXiao(), '兔')
    assert.equal(original.getXingZuo(), '射手')
    assert.equal(upcoming.getLunar().getMonthInChinese(), '冬')
    assert.equal(upcoming.getLunar().getDayInChinese(), '初五')
    assert.equal(Solar.fromYmd(2017, 2, 1).getLunar().getDayInChinese(), '初五')
  }
})

test('自然日不受夏令时影响', () => {
  const originalTimezone = process.env.TZ
  try {
    for (const timezone of ['Asia/Shanghai', 'America/New_York']) {
      process.env.TZ = timezone
      assert.equal(dateOrdinal('2026-03-09') - dateOrdinal('2026-03-08'), 1)
      assert.equal(dateOrdinal('2026-11-02') - dateOrdinal('2026-11-01'), 1)
    }
  } finally { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone }
})

test('置顶优先、固定倒计时过期置后，节日按公历每年重复', () => {
  const items = ['2026-01-01', '2026-12-25', '2026-10-07'].map((date, index) => ({ id: `${index}`, kind: 'countdown', date, createdAt: index, pinned: index === 1 }))
  assert.deepEqual(orderedAnniversaries(items, '2026-10-06').map(item => item.id), ['1', '2', '0'])
  assert.equal(anniversaryState({ kind: 'holiday', date: '2000-01-01' }, '2026-10-06').nextDate, '2027-01-01')
  assert.equal(anniversaryState({ kind: 'holiday', date: '2099-01-01' }, '2100-10-06').nextDate, '2101-01-01')
})

test('严格校验日期、类型、出生日期和封面索引', () => {
  const valid = { kind: 'birthday', title: ' 生日 ', date: '2023-12-13', notes: '', pinned: false, theme: 'sky', photos: [], coverIndex: 0 }
  assert.equal(normalizeAnniversary(valid, '2026-10-06').title, '生日')
  for (const patch of [{ date: '2025-02-29' }, { date: '2023-2-1' }, { date: '1899-01-01' }, { date: '2101-01-01' }, { date: '2027-01-01' }, { kind: 'task' }, { theme: 'other' }, { title: ' ' }, { coverIndex: 1 }, { photos: Array(5).fill('') }, { photos: ['data:image/jpeg;base64,/9j/2Q=='] }]) {
    assert.throws(() => normalizeAnniversary({ ...valid, ...patch }, '2026-10-06'))
  }
})

test('月历按浏览日期展开四类，覆盖历史、未来、跨年与填充日', () => {
  const items = [
    { id: 'birthday', kind: 'birthday', title: '小明', date: '2023-12-13', pinned: false, createdAt: 0 },
    { id: 'anniversary', kind: 'anniversary', title: '结婚', date: '2017-12-13', pinned: true, createdAt: 1 },
    { id: 'holiday', kind: 'holiday', title: '元旦', date: '2000-01-01', createdAt: 2 },
    { id: 'fixed', kind: 'countdown', title: '旅行', date: '2026-12-31', createdAt: 3 }
  ]
  const result = anniversaryOccurrences(items, '2026-11-30', '2027-01-03')
  assert.deepEqual(result.map(item => [item.date, item.label]), [
    ['2026-12-13', '结婚 · 9周年'], ['2026-12-13', '小明 · 3岁生日'], ['2027-01-01', '元旦'], ['2026-12-31', '旅行']
  ])
  assert.equal(anniversaryOccurrences(items, '2022-12-01', '2022-12-31').some(item => item.anniversaryId === 'birthday'), false)
  assert.equal(anniversaryOccurrences(items, '2023-12-13', '2023-12-13').find(item => item.anniversaryId === 'birthday').label, '小明 · 出生纪念')
  assert.equal(anniversaryOccurrences(items, '2017-12-13', '2017-12-13')[0].label, '结婚 · 纪念日')
  assert.equal(anniversaryOccurrences(items, '2027-12-01', '2027-12-31').some(item => item.anniversaryId === 'fixed'), false)
})

test('月历闰日调整和周年年龄以发生日计算', () => {
  const leap = { id: 'leap', kind: 'birthday', title: '闰日', date: '2024-02-29', createdAt: 0 }
  const result = anniversaryOccurrences([leap], '2025-02-01', '2028-03-01')
  assert.deepEqual(result.map(item => [item.date, item.years, item.adjusted]), [['2025-02-28', 1, true], ['2026-02-28', 2, true], ['2027-02-28', 3, true], ['2028-02-29', 4, false]])
})

test('独立年度记录、快照保留、撤销确认以及非法日期限制', () => {
  const item = { id: 'a', kind: 'anniversary', title: '原名称', date: '2017-02-01', notes: '原备注', createdAt: 0 }
  const input = { anniversaryId: 'a', date: '2020-02-01', notes: ' 一起吃蛋糕 ', confirmed: true }
  const first = prepareAnniversaryRecord(item, input, null, '2026-10-06')
  const next = prepareAnniversaryRecord(item, { ...input, date: '2021-02-01', notes: '旅行' }, null, '2026-10-06')
  const changed = { ...item, kind: 'holiday', title: '新名称', date: '2018-03-01' }
  const reopened = prepareAnniversaryRecord(changed, { ...input, confirmed: false }, first, '2026-10-06')
  assert.equal(reopened.title, '原名称')
  assert.equal(reopened.kind, 'anniversary')
  assert.equal(reopened.originalDate, '2017-02-01')
  assert.equal(reopened.confirmedAt, null)
  assert.equal(reopened.notes, '一起吃蛋糕')
  assert.equal(anniversaryRecordOccurrence(reopened).label, '原名称 · 3周年')
  assert.equal(anniversaryOccurrences([item], input.date, input.date, [first, next])[0].record.notes, '一起吃蛋糕')
  for (const patch of [{ date: '2027-02-01' }, { date: '2020-02-02' }, { date: '2016-02-01' }, { notes: '字'.repeat(2001) }]) assert.throws(() => prepareAnniversaryRecord(item, { ...input, ...patch }, null, '2026-10-06'))
  assert.equal(item.notes, '原备注')
})
