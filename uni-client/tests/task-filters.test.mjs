import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TASK_FILTER_TYPES,
  defaultTaskFilters,
  normalizeTaskFilters,
  isTaskFilters,
  taskTypes,
  matchesTaskTypeFilter,
  timeRangeFor,
  occurrenceDateInRange
} from '../src/utils/task.js'
import { syncSettings, applySyncSetting } from '../src/api/sync-outbox.js'

const allTypes = [...TASK_FILTER_TYPES]
const weekly = { plannedDate: '2026-11-02', repeatRule: '{"kind":"weekly"}', parentTaskId: null }
const daily = { plannedDate: '2026-11-01', repeatRule: '{"kind":"daily"}', parentTaskId: null }
const range = { startDate: '2026-11-16', endDate: '2026-11-22' }
const today = '2026-11-18'

test('筛选配置归一与严格校验', () => {
  assert.deepEqual(defaultTaskFilters(), { time: 'week', types: allTypes })
  assert.deepEqual(normalizeTaskFilters(undefined), { time: 'week', types: allTypes })
  assert.deepEqual(normalizeTaskFilters({ time: 'bad', types: [] }), { time: 'week', types: allTypes })
  assert.deepEqual(normalizeTaskFilters({ time: 'month', types: ['repeat', 'unknown', 'schedule', 'schedule'] }), { time: 'month', types: ['schedule', 'repeat'] })
  assert.equal(isTaskFilters({ time: 'week', types: ['schedule'] }), true)
  for (const value of [null, [], 'week', { time: 'year', types: ['schedule'] }, { time: 'week', types: [] }, { time: 'week', types: allTypes.concat('repeat') }, { time: 'week', types: ['unknown'] }, { time: 'week', types: ['schedule', 'schedule'] }]) {
    assert.equal(isTaskFilters(value), false)
  }
})

test('类型可重叠并集：日期、清单与重复', () => {
  assert.deepEqual(taskTypes({ plannedDate: '2026-11-18', repeatRule: '{"kind":"none"}' }), ['schedule'])
  assert.deepEqual(taskTypes({ plannedDate: null, repeatRule: '{"kind":"none"}' }), ['list'])
  assert.deepEqual(taskTypes(weekly), ['schedule', 'repeat'])
  assert.equal(matchesTaskTypeFilter(weekly, allTypes), true)
  assert.equal(matchesTaskTypeFilter(weekly, ['schedule']), true)
  assert.equal(matchesTaskTypeFilter(weekly, ['repeat']), true)
  assert.equal(matchesTaskTypeFilter(weekly, ['list']), false)
  assert.equal(matchesTaskTypeFilter({ plannedDate: null, repeatRule: '{"kind":"none"}' }, ['list']), true)
  assert.equal(matchesTaskTypeFilter({ plannedDate: null, repeatRule: '{"kind":"none"}' }, ['schedule', 'repeat']), false)
})

test('自然周/月时间范围与跨月跨年', () => {
  assert.equal(timeRangeFor('all', today), null)
  assert.deepEqual(timeRangeFor('today', today), { startDate: today, endDate: today })
  assert.deepEqual(timeRangeFor('tomorrow', today), { startDate: '2026-11-19', endDate: '2026-11-19' })
  assert.deepEqual(timeRangeFor('three_days', today), { startDate: '2026-11-18', endDate: '2026-11-20' })
  assert.deepEqual(timeRangeFor('week', today), range)
  assert.deepEqual(timeRangeFor('week', '2026-12-31'), { startDate: '2026-12-28', endDate: '2027-01-03' })
  assert.deepEqual(timeRangeFor('month', '2026-11-18'), { startDate: '2026-11-01', endDate: '2026-11-30' })
  assert.deepEqual(timeRangeFor('month', '2028-02-10'), { startDate: '2028-02-01', endDate: '2028-02-29' })
  assert.deepEqual(timeRangeFor('month', '2027-02-10'), { startDate: '2027-02-01', endDate: '2027-02-28' })
})

test('发生日归档：普通事项、未来优先与过去回退', () => {
  assert.equal(occurrenceDateInRange({ plannedDate: '2026-11-20', repeatRule: '{"kind":"none"}', parentTaskId: null }, range.startDate, range.endDate, today), '2026-11-20')
  assert.equal(occurrenceDateInRange({ plannedDate: '2026-11-25', repeatRule: '{"kind":"none"}', parentTaskId: null }, range.startDate, range.endDate, today), null)
  assert.equal(occurrenceDateInRange(daily, range.startDate, range.endDate, today), '2026-11-18')
  assert.equal(occurrenceDateInRange(weekly, range.startDate, range.endDate, today), '2026-11-16')
  assert.equal(occurrenceDateInRange({ ...weekly, repeatRule: '{"kind":"weekly_slots","weekdays":[3]}' }, range.startDate, range.endDate, today), '2026-11-18')
  assert.equal(occurrenceDateInRange({ ...daily, repeatRule: '{"kind":"daily","endMode":"date","endDate":"2026-11-17"}' }, range.startDate, range.endDate, today), '2026-11-17')
  assert.equal(occurrenceDateInRange({ ...daily, repeatRule: '{"kind":"daily","endMode":"count","count":1}' }, range.startDate, range.endDate, today), null)
  assert.equal(occurrenceDateInRange({ ...daily, parentTaskId: 'parent' }, range.startDate, range.endDate, today), null)
})

test('同步设置往返、墓碑回落与非法值拦截', () => {
  assert.deepEqual(syncSettings({ settings: {}, profile: {} })['mobile.task_filters'], { time: 'week', types: allTypes })
  assert.deepEqual(syncSettings({ settings: { taskFilters: { time: 'month' } }, profile: {} })['mobile.task_filters'], { time: 'month', types: allTypes })
  const data = { settings: {}, profile: {} }
  applySyncSetting(data, 'mobile.task_filters', { time: 'month', types: ['list'] }, false)
  assert.deepEqual(data.settings.taskFilters, { time: 'month', types: ['list'] })
  applySyncSetting(data, 'mobile.task_filters', null, true)
  assert.deepEqual(data.settings.taskFilters, { time: 'week', types: allTypes })
  assert.throws(() => applySyncSetting(data, 'mobile.task_filters', { time: 'month', types: [] }, false), /筛选偏好/)
  assert.throws(() => applySyncSetting(data, 'mobile.task_filters', { time: 'year', types: ['schedule'] }, false), /筛选偏好/)
})
