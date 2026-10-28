import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesTaskFilter, validateTaskDateRange } from '../src/utils/task.js'
import { resolveCalendarMeta } from '../src/utils/calendar-meta.js'
import { Solar } from 'lunar-typescript'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const task = { id: 'a', title: '项目 Alpha', notes: 'Review 备注', plannedDate: '2026-10-10', status: 'todo', categoryId: 'work' }

test('搜索标题备注忽略大小写和空白，空备注及中文安全匹配', () => {
  for (const query of [' alpha ', 'REVIEW', '备注', '项目', '   ']) assert.equal(matchesTaskFilter(task, { query }), true)
  assert.equal(matchesTaskFilter({ ...task, notes: null }, { query: 'review' }), false)
  assert.equal(matchesTaskFilter({ ...task, notes: undefined }, { query: '' }), true)
})

test('日期闭区间、同日、单边、无日期及逆序，重复源只按起始日期', () => {
  for (const range of [{ startDate: '2026-10-10' }, { endDate: '2026-10-10' }, { startDate: '2026-10-10', endDate: '2026-10-10' }]) {
    assert.equal(matchesTaskFilter(task, range), true)
    assert.equal(matchesTaskFilter({ ...task, plannedDate: null }, range), false)
  }
  assert.equal(matchesTaskFilter(task, { startDate: '2026-10-11' }), false)
  assert.equal(matchesTaskFilter(task, { endDate: '2026-10-09' }), false)
  assert.throws(() => validateTaskDateRange('2026-10-11', '2026-10-10'), /结束日期/)
  assert.doesNotThrow(() => validateTaskDateRange('', '2026-10-10'))
  assert.doesNotThrow(() => validateTaskDateRange('2026-10-10', '2026-10-10'))
  const repeat = { ...task, repeatRule: '{"kind":"daily"}', status: 'done' }
  assert.equal(matchesTaskFilter(repeat, { startDate: '2026-10-11', hideCompleted: true }), false)
  assert.equal(matchesTaskFilter(repeat, { endDate: '2026-10-10', hideCompleted: true }), true)
})

test('搜索、日期、分类、终态取交集，子项始终不独立展示', () => {
  const options = { query: 'review', startDate: '2026-10-10', endDate: '2026-10-12', categoryId: 'work', hideCompleted: true }
  assert.equal(matchesTaskFilter(task, options), true)
  for (const patch of [{ categoryId: 'life' }, { status: 'done' }, { status: 'failed' }, { parentTaskId: 'parent' }, { plannedDate: null }]) assert.equal(matchesTaskFilter({ ...task, ...patch }, options), false)
  assert.equal(matchesTaskFilter({ ...task, status: 'failed' }, { ...options, hideCompleted: false }), true)
})

test('历法初一、农历跨年、闰月、春节、元旦及清明', () => {
  assert.equal(resolveCalendarMeta('2026-02-17').lunarLabel, '正月')
  assert.equal(resolveCalendarMeta('2026-02-17').marker, '春节')
  assert.match(resolveCalendarMeta('2026-02-16').lunarText, /二〇二五年腊月廿九/)
  assert.equal(resolveCalendarMeta('2026-02-16').marker, '除夕')
  assert.equal(resolveCalendarMeta('2025-07-25').lunarLabel, '闰六月')
  assert.match(resolveCalendarMeta('2025-07-25').lunarText, /年闰六月初一/)
  assert.equal(resolveCalendarMeta('2026-01-01').marker, '元旦节')
  assert.equal(resolveCalendarMeta('2026-04-05').marker, '清明')
  for (const date of ['', null, '2026-02-30', '2026-13-01']) assert.equal(resolveCalendarMeta(date).marker, null)
})

test('历法公历优先于农历，详情保留并存标记，并与桌面全年对应输出一致', async () => {
  assert.equal(resolveCalendarMeta('2020-10-01').marker, '国庆节')
  assert.ok(resolveCalendarMeta('2020-10-01').markers.includes('中秋节'))
  const desktop = (await readFile(new URL('../../desktop-client/src/utils/calendar-meta.ts', import.meta.url), 'utf8'))
    .replace("import { Solar } from 'lunar-typescript'", '')
    .replace(/export interface CalendarMeta \{[\s\S]*?\}/, '')
    .replace('export function resolveCalendarMeta(date: string): CalendarMeta', 'function resolveCalendarMeta(date)')
  const context = vm.createContext({ Solar })
  vm.runInContext(desktop, context)
  for (let offset = 0; offset < 365; offset++) {
    const date = new Date(2026, 0, offset + 1, 12)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const actual = resolveCalendarMeta(key)
    const expected = context.resolveCalendarMeta(key)
    assert.equal(actual.marker, expected.marker, key)
    assert.equal(actual.lunarLabel, expected.lunarLabel, key)
  }
})
