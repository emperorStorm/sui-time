import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTaskTime, normalizeTask, compareTasks, taskMark } from '../src/utils/task.js'
import { resolveTasksForDate } from '../src/utils/occurrence.js'
import * as store from '../src/api/store.js'
import { syncTaskReminders, reminderState } from '../src/api/reminders.js'

let disk = null
let fail = false
globalThis.uni = { getStorageSync: () => disk, setStorageSync: (_, value) => { if (fail) throw Error('存储失败'); disk = structuredClone(value) } }
const task = (patch = {}) => ({ title: '测试事项', plannedDate: '2026-10-10', scheduleKind: 'all_day', status: 'todo', priority: 'not_urgent_not_important', ...patch })

test('首次设时间、关闭后编辑、全天与重新设置时间', () => {
  const draft = task()
  applyTaskTime(draft, { scheduleKind: 'point', plannedTime: '09:00' })
  assert.deepEqual(draft.reminderOffsets, [0])
  draft.reminderOffsets = []
  applyTaskTime(draft, { plannedTime: '10:00' })
  assert.deepEqual(draft.reminderOffsets, [])
  draft.reminderOffsets = [0, 15, 30]
  applyTaskTime(draft, { scheduleKind: 'range', plannedEndTime: '11:00' })
  assert.deepEqual(draft.reminderOffsets, [0, 15, 30])
  applyTaskTime(draft, { scheduleKind: 'all_day' })
  assert.equal(draft.plannedTime, null)
  assert.deepEqual(draft.reminderOffsets, [])
  applyTaskTime(draft, { scheduleKind: 'point', plannedTime: '08:00' })
  assert.deepEqual(draft.reminderOffsets, [0])
})

test('旧数据不启用提醒，并拒绝无效时间段、日期和提醒规则', () => {
  assert.deepEqual(normalizeTask(task()).reminderOffsets, [])
  assert.throws(() => normalizeTask(task({ plannedDate: '2026-02-30' })), /有效日期/)
  assert.throws(() => normalizeTask(task({ scheduleKind: 'range', plannedTime: '10:00', plannedEndTime: '09:00' })), /结束时间/)
  assert.throws(() => normalizeTask(task({ scheduleKind: 'point', plannedTime: '09:00', reminderOffsets: [0, 5, 15, 30] })), /最多/)
})

test('有时间优先、时间先于优先级、完成失败置底及轻量标记', () => {
  const data = [task({ id: 'c', priority: 'urgent_important' }), task({ id: 'b', scheduleKind: 'point', plannedTime: '10:00', priority: 'urgent_important' }), task({ id: 'a', scheduleKind: 'point', plannedTime: '09:00' }), task({ id: 'd', status: 'failed', scheduleKind: 'point', plannedTime: '08:00' })]
  assert.deepEqual(data.sort(compareTasks).map(item => item.id), ['a', 'b', 'c', 'd'])
  assert.equal(taskMark(data[0]), 'IV')
  assert.equal(taskMark(data[3]), '×')
  assert.equal(taskMark(task({ status: 'done' })), '✓')
})

test('多个改期实例与原实例在同一天全部显示', () => {
  const source = task({ id: 'repeat', repeatRule: '{"kind":"daily"}', occurrenceOverrides: JSON.stringify({ '2026-10-09': null, '2026-10-10': { plannedDate: '2026-10-12' }, '2026-10-11': { plannedDate: '2026-10-12' } }) })
  assert.equal(resolveTasksForDate([source], '2026-10-12').length, 3)
  assert.equal(resolveTasksForDate([source], '2026-10-10').length, 0)
})

test('父子原子保存、全部子项删除、存储失败不污染缓存、不排程', async () => {
  const calls = []
  globalThis.plus = { os: { name: 'Android' }, android: { runtimeMainActivity: () => ({}), invoke: (_, method, context, snapshot) => { calls.push(snapshot); return '{"supported":true}' } } }
  const parent = store.saveTask(task(), [{ id: 'child-a', title: '子事项' }])
  await syncTaskReminders(store.listTasks())
  assert.equal(store.listChildren(parent.id).length, 1)
  store.saveTask({ ...parent, title: '修改标题' }, [])
  await syncTaskReminders(store.listTasks())
  assert.equal(store.listChildren(parent.id).length, 0)
  const before = structuredClone(store.listTasks())
  const count = calls.length
  fail = true
  assert.throws(() => store.saveTask({ ...parent, title: '不会落盘' }), /无法保存/)
  assert.throws(() => store.restoreDemoData(), /无法恢复/)
  assert.deepEqual(store.listTasks(), before)
  assert.equal(calls.length, count)
  fail = false
  delete globalThis.plus
})

test('当次时间编辑与完成不更改源，已完成实例保留快照', () => {
  const parent = store.saveTask(task({ repeatRule: '{"kind":"daily"}', scheduleKind: 'point', plannedTime: '09:00', reminderOffsets: [15] }))
  const id = `${parent.id}@2026-10-11`
  store.saveTask({ id, title: '当次修改', plannedTime: '10:00' })
  assert.equal(store.findTask(id).plannedTime, '10:00')
  assert.equal(store.findTask(parent.id).plannedTime, '09:00')
  assert.deepEqual(store.findTask(id).reminderOffsets, [15])
  store.setTaskStatus(id, 'done')
  assert.equal(store.findTask(parent.id).status, 'todo')
  store.saveTask({ id: parent.id, title: '新源名称' })
  assert.equal(store.findTask(id).title, '当次修改')
  assert.equal(store.findTask(`${parent.id}@2026-10-12`).status, 'todo')
  store.removeTask(id)
  assert.equal(store.findTask(id), null)
})

test('同步进行中提交新快照，最后一轮读取最新内容', async () => {
  const calls = []
  globalThis.plus = { os: { name: 'Android' }, android: { runtimeMainActivity: () => ({}), invoke: (_, method, context, snapshot) => {
    calls.push(JSON.parse(snapshot))
    if (calls.length === 1) syncTaskReminders([{ id: 'latest' }])
    return '{"supported":true}'
  } } }
  await syncTaskReminders([{ id: 'first' }])
  assert.equal(calls.at(-1)[0].id, 'latest')
  await syncTaskReminders([])
  assert.deepEqual(calls.at(-1), [])
  delete globalThis.plus
})

test('返回权限设置后读取新权限，不被上轮排程结果覆盖', async () => {
  let allowed = false
  globalThis.plus = { os: { name: 'Android' }, android: { runtimeMainActivity: () => ({}), invoke: (_, method) => JSON.stringify(method === 'state' ? { supported: true, notifications: allowed, exactAlarm: allowed } : { supported: true, notifications: false, exactAlarm: false, scheduled: 0 }) } }
  await syncTaskReminders([])
  allowed = true
  assert.equal(reminderState().notifications, true)
  assert.equal(reminderState().exactAlarm, true)
  delete globalThis.plus
})
