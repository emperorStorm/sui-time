import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTaskTime, normalizeTask, compareTasks, taskMark } from '../src/utils/task.js'
import { resolveTasksForDate } from '../src/utils/occurrence.js'
import * as store from '../src/api/store.js'
import { syncTaskReminders, reminderState } from '../src/api/reminders.js'
import { load, save as saveStorage } from '../src/api/storage.js'

let disk = null
let fail = false
let writes = 0
globalThis.uni = { getStorageSync: () => disk, setStorageSync: (_, value) => { writes++; if (fail) throw Error('存储失败'); disk = structuredClone(value) } }
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

test('标题及备注长度校验，不截断草稿', () => {
  const input = task({ title: `  ${'名'.repeat(120)}  `, notes: '备'.repeat(1000) })
  assert.equal(normalizeTask(input).title.length, 120)
  assert.equal(normalizeTask(input).notes.length, 1000)
  assert.throws(() => normalizeTask(task({ title: '名'.repeat(121) })), /120/)
  const old = task({ notes: '备'.repeat(1001) })
  assert.throws(() => normalizeTask(old), /1000/)
  assert.equal(old.notes.length, 1001)
  assert.throws(() => normalizeTask(task({ title: 123 })), /事项名称/)
})

test('分类与设置严格提交，所有失败操作不污染缓存、磁盘或新建输入', () => {
  store.setSetting('customSetting', { enabled: true })
  const category = { name: '独立分类', color: '#123456' }
  store.saveCategory(category)
  const parent = store.saveTask(task({ categoryId: category.id }))
  const before = structuredClone(load())
  const diskBefore = structuredClone(disk)
  const draft = { name: '未落盘分类' }
  fail = true
  try {
    for (const action of [
      () => store.saveCategory(draft),
      () => store.saveCategory({ id: category.id, name: '不会生效' }),
      () => store.reorderCategories(store.getCategories().map(item => item.id).reverse()),
      () => store.removeCategory(category.id),
      () => store.setSetting('hideCompleted', false),
      () => store.toggleGroupCollapsed('今天')
    ]) {
      assert.throws(action, /无法/)
      assert.deepEqual(load(), before)
      assert.deepEqual(disk, diskBefore)
    }
    assert.deepEqual(draft, { name: '未落盘分类' })
  } finally { fail = false }
  store.toggleGroupCollapsed('今天')
  assert.deepEqual(store.getSettings().customSetting, { enabled: true })
  store.removeCategory(category.id)
  assert.equal(store.findTask(parent.id).categoryId, null)
  assert.equal(disk.tasks.find(item => item.id === parent.id).categoryId, null)
})

test('子项状态原子保存与父项汇总，保留旧字段、完成时间与排序', async () => {
  const parent = store.saveTask(task(), [{ title: '甲' }, { title: '乙' }])
  const original = store.listChildren(parent.id)
  const enriched = { ...original[0], notes: '旧备注', custom: { keep: true }, createdAt: 7, status: 'done', completedAt: 123 }
  saveStorage({ ...load(), tasks: load().tasks.map(item => item.id === enriched.id ? enriched : item) }, { strict: true })
  const count = writes
  const result = store.saveTask({ id: parent.id, title: '修改父项' }, [
    { id: original[1].id, title: '乙', status: 'done' },
    { id: original[0].id, title: '甲改名', status: 'done' }
  ])
  assert.equal(writes, count + 1)
  assert.equal(result.status, 'done')
  const children = store.listChildren(parent.id)
  assert.deepEqual(children.map(item => item.sortOrder), [0, 1])
  assert.equal(children[1].completedAt, 123)
  assert.equal(children[1].createdAt, 7)
  assert.equal(children[1].notes, '旧备注')
  assert.deepEqual(children[1].custom, { keep: true })
  assert.equal(children[0].completedAt, result.completedAt)
  assert.ok(result.reminderPromise instanceof Promise)
  await result.reminderPromise
  assert.equal(Object.keys(result).includes('reminderPromise'), false)
  assert.equal('reminderPromise' in store.findTask(parent.id), false)
  const reopened = store.saveTask({ id: parent.id }, children.map(item => ({ id: item.id, title: item.title, status: item.id === children[1].id ? 'todo' : 'done' })))
  assert.equal(reopened.status, 'todo')
  assert.equal(reopened.completedAt, null)
  assert.equal(store.listChildren(parent.id)[1].completedAt, null)
  const before = structuredClone(load())
  assert.throws(() => store.saveTask({ id: parent.id }, [{ title: '子项', status: 'failed' }]), /子事项状态/)
  assert.throws(() => store.saveTask({ id: parent.id }, [{ title: '超'.repeat(121) }]), /120/)
  assert.deepEqual(load(), before)
})

test('零子项、失败、重复源和嵌套子项不汇总父状态', () => {
  const empty = store.saveTask(task({ status: 'done', completedAt: 17 }), [])
  assert.equal(empty.status, 'done')
  assert.equal(empty.completedAt, 17)
  for (const patch of [{ status: 'failed' }, { repeatRule: '{"kind":"daily"}' }, { parentTaskId: empty.id }]) {
    const parent = store.saveTask(task(patch), [{ title: '全部完成', status: 'done' }])
    assert.equal(parent.status, patch.status || 'todo')
  }
})

test('完成及恢复级联直属子项，失败不级联，完成和更新时间一致', async () => {
  const parent = store.saveTask(task(), [{ title: '直属甲' }, { title: '直属乙' }])
  const direct = store.listChildren(parent.id)
  const nested = store.saveTask(task({ parentTaskId: direct[0].id }))
  let count = writes
  await store.setTaskStatus(parent.id, 'done')
  assert.equal(writes, count + 1)
  const done = store.findTask(parent.id)
  for (const child of store.listChildren(parent.id)) {
    assert.equal(child.status, 'done')
    assert.equal(child.completedAt, done.completedAt)
    assert.equal(child.updatedAt, done.updatedAt)
  }
  assert.equal(store.findTask(nested.id).status, 'todo')
  const completedChildren = structuredClone(store.listChildren(parent.id))
  await store.setTaskStatus(parent.id, 'failed')
  assert.equal(store.findTask(parent.id).completedAt, null)
  assert.deepEqual(store.listChildren(parent.id), completedChildren)
  count = writes
  await store.setTaskStatus(parent.id, 'todo')
  assert.equal(writes, count + 1)
  const reopened = store.findTask(parent.id)
  for (const child of store.listChildren(parent.id)) {
    assert.equal(child.status, 'todo')
    assert.equal(child.completedAt, null)
    assert.equal(child.updatedAt, reopened.updatedAt)
  }
})

test('编辑加显式状态只写一次，显式完成及恢复覆盖子项汇总，失败不级联', async () => {
  const parent = store.saveTask(task(), [{ title: '子事项' }])
  const child = store.listChildren(parent.id)[0]
  let count = writes
  const saved = store.saveTask({ id: parent.id, title: '编辑并完成' }, [{ id: child.id, title: '编辑子项', status: 'todo' }], { status: 'done' })
  await saved.reminderPromise
  assert.equal(writes, count + 1)
  assert.equal(saved.title, '编辑并完成')
  assert.equal(saved.status, 'done')
  assert.equal(store.listChildren(parent.id)[0].completedAt, saved.completedAt)
  const reopened = store.saveTask({ id: parent.id }, [{ id: child.id, title: '编辑子项', status: 'done' }], { status: 'todo' })
  assert.equal(reopened.status, 'todo')
  assert.equal(store.listChildren(parent.id)[0].status, 'todo')
  count = writes
  store.saveTask({ id: parent.id }, [{ id: child.id, title: '已完成子项', status: 'done' }], { status: 'failed' })
  assert.equal(writes, count + 1)
  assert.equal(store.findTask(parent.id).status, 'failed')
  assert.equal(store.listChildren(parent.id)[0].status, 'done')
  const before = structuredClone(load())
  const diskBefore = structuredClone(disk)
  fail = true
  try {
    assert.throws(() => store.saveTask({ id: parent.id, title: '失败草稿' }, [], { status: 'done' }), /无法保存/)
    assert.throws(() => store.setTaskStatus(parent.id, 'todo'), /无法保存/)
    assert.deepEqual(load(), before)
    assert.deepEqual(disk, diskBefore)
  } finally { fail = false }
})

test('重复实例传子项不改源子项，编辑及状态只写当次覆盖并保存快照', async () => {
  const source = store.saveTask(task({ repeatRule: '{"kind":"daily"}' }), [{ title: '源子项' }])
  const children = structuredClone(store.listChildren(source.id))
  const id = `${source.id}@2026-10-11`
  const count = writes
  const instance = store.saveTask({ id, title: '当次草稿', plannedDate: '2026-10-12' }, [{ title: '不得写源', status: 'done' }], { status: 'done' })
  await instance.reminderPromise
  assert.equal(writes, count + 1)
  assert.equal(instance.status, 'done')
  assert.equal(instance.title, '当次草稿')
  assert.equal(instance.completedAt, instance.updatedAt)
  assert.equal(store.findTask(source.id).status, 'todo')
  assert.deepEqual(store.listChildren(source.id), children)
  assert.equal(store.findTask(`${source.id}@2026-10-12`).status, 'todo')
  await store.setTaskStatus(id, 'todo')
  assert.equal(store.findTask(id).completedAt, null)
  assert.equal(store.findTask(id).plannedDate, '2026-10-12')
  await store.setTaskStatus(id, 'failed')
  assert.equal(store.findTask(id).status, 'failed')
  assert.deepEqual(store.listChildren(source.id), children)
  await store.setTaskStatus(source.id, 'done')
  assert.deepEqual(store.listChildren(source.id), children)
})

test('从待办变完成不沿用旧的残留完成时间，连续保存完成态保留时间', () => {
  const parent = store.saveTask(task({ completedAt: 1 }), [{ title: '子事项' }])
  const child = store.listChildren(parent.id)[0]
  saveStorage({ ...load(), tasks: load().tasks.map(item => item.id === child.id ? { ...item, completedAt: 2 } : item) }, { strict: true })
  const saved = store.saveTask({ id: parent.id }, [{ id: child.id, title: child.title, status: 'done' }])
  assert.equal(saved.completedAt, saved.updatedAt)
  assert.equal(store.listChildren(parent.id)[0].completedAt, saved.completedAt)
  const again = store.saveTask({ id: parent.id }, [{ id: child.id, title: child.title, status: 'done' }])
  assert.equal(again.completedAt, saved.completedAt)
  assert.equal(store.listChildren(parent.id)[0].completedAt, saved.completedAt)
})

test('子项 id 不得覆盖其他事项，不接受重复 id', () => {
  const parent = store.saveTask(task(), [{ title: '所属子项' }])
  const other = store.saveTask(task())
  const child = store.listChildren(parent.id)[0]
  const before = structuredClone(load())
  assert.throws(() => store.saveTask({ id: parent.id }, [{ id: other.id, title: '抢占' }]), /子事项数据无效/)
  assert.throws(() => store.saveTask({ id: parent.id }, [{ id: child.id, title: '甲' }, { id: child.id, title: '乙' }]), /子事项数据无效/)
  assert.deepEqual(load(), before)
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
