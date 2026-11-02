import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as store from '../src/api/store.js'
import * as businessStorage from '../src/api/storage.js'

let revision = 0
const fresh = () => import(`../src/api/storage.js?sync-test=${++revision}`)
const pendingCount = data => Object.values(data.syncMeta.outbox).reduce((sum, entries) => sum + Object.keys(entries).length, 0)
function diskStorage(initial) {
  let disk = initial
  let fail = false
  const events = []
  globalThis.uni = {
    getStorageSync: () => structuredClone(disk),
    setStorageSync: (_, value) => { if (fail) throw Error('quota'); disk = structuredClone(value) },
    $emit: event => events.push(event)
  }
  return { read: () => structuredClone(disk), fail: value => { fail = value }, events }
}

test('v1 升级一次落盘，重启保留设备和未知字段，迁移失败可重试', async () => {
  const disk = diskStorage({ categories: [{ id: 'c' }], tasks: [{ id: 't', title: '旧事项', extra: 7 }], extra: 23 })
  let storage = await fresh()
  disk.fail(true)
  assert.throws(() => storage.load(), /无法升级/)
  assert.equal(disk.read().version, undefined)
  disk.fail(false)
  const first = storage.load()
  assert.equal(first.version, 2)
  assert.equal(first.tasks[0].deletedAt, null)
  assert.equal(first.tasks[0].deviceId, first.syncMeta.deviceId)
  assert.equal(first.tasks[0].extra, 7)
  assert.equal(first.extra, 23)
  assert.equal(first.syncMeta.dataOrigin, 'user')
  assert.deepEqual(first.syncMeta.outbox, {})
  assert.deepEqual(disk.events, [])
  storage = await fresh()
  assert.deepEqual(storage.load(), first)
})

test('seed 保持到真实写入，diff 捕获原地修改，队列合并且不重复 emit', async () => {
  const disk = diskStorage(null)
  const storage = await fresh()
  const data = storage.load()
  assert.equal(data.syncMeta.dataOrigin, 'seed')
  storage.persist()
  storage.save({ ...data, syncMeta: { ...data.syncMeta, cursor: 3 } }, { remote: true, strict: true })
  assert.equal(storage.load().syncMeta.dataOrigin, 'seed')
  assert.deepEqual(disk.events, [])
  const live = storage.load()
  const id = live.tasks[0].id
  live.tasks[0].title = '实际修改'
  storage.persist()
  assert.equal(storage.load().syncMeta.dataOrigin, 'user')
  assert.equal(pendingCount(storage.load()), 1)
  const firstVersion = storage.load().syncMeta.outbox.task[id]
  assert.equal(firstVersion, storage.load().tasks[0].updatedAt)
  assert.equal(storage.load().tasks[0].deviceId, live.syncMeta.deviceId)
  storage.load().tasks[0].title = '再修改'
  storage.persist()
  assert.equal(pendingCount(storage.load()), 1)
  assert.ok(storage.load().syncMeta.outbox.task[id] > firstVersion)
  assert.equal(storage.load().tasks[0].title, '再修改')
  storage.persist()
  assert.deepEqual(disk.events, ['local-write', 'local-write'])
})

test('物理删除生成墓碑，既有墓碑保留；远端清队列和应用数据不产生写事件', async () => {
  const disk = diskStorage({ categories: [], tasks: [{ id: 't', title: '保留' }], anniversaryRecords: [{ anniversaryId: 'a', date: '2026-01-01' }] })
  const storage = await fresh()
  const data = storage.load()
  storage.save({ ...data, tasks: [], anniversaryRecords: [] }, { strict: true })
  const deleted = structuredClone(storage.load())
  assert.ok(deleted.tasks[0].deletedAt)
  assert.equal(pendingCount(deleted), 2)
  assert.ok(deleted.syncMeta.outbox.anniversary_record['a@2026-01-01'])
  storage.save({ ...deleted, tasks: [], anniversaryRecords: [] }, { strict: true })
  assert.deepEqual(storage.load(), deleted)
  const incoming = { ...deleted, tasks: [{ id: 'remote', title: '远端', updatedAt: 12, deviceId: 'other', deletedAt: null }],
    syncMeta: { ...deleted.syncMeta, cursor: 7, lastSyncAt: 123, remoteUserId: 'u1', remoteUsername: '小明', outbox: {}, token: '不允许保存' }, token: '不允许保存' }
  storage.save(incoming, { remote: true, strict: true })
  assert.equal(storage.load().tasks[0].deviceId, 'other')
  assert.equal(storage.load().syncMeta.cursor, 7)
  assert.equal(storage.load().syncMeta.remoteUserId, 'u1')
  assert.deepEqual(storage.load().syncMeta.outbox, {})
  assert.equal(disk.read().token, undefined)
  assert.equal(storage.load().token, undefined)
  assert.equal(disk.read().syncMeta.token, undefined)
  assert.deepEqual(disk.events, ['local-write'])
})

test('原地修改后写盘失败回滚实体、outbox 和来源，重试只提交一次', async () => {
  const disk = diskStorage(null)
  const storage = await fresh()
  const before = structuredClone(storage.load())
  storage.load().tasks[0].title = '失败修改'
  disk.fail(true)
  assert.throws(() => storage.save(storage.load(), { strict: true }), /无法保存/)
  assert.deepEqual(storage.load(), before)
  assert.deepEqual(disk.read(), before)
  assert.deepEqual(disk.events, [])
  disk.fail(false)
  storage.load().tasks[0].title = '成功修改'
  assert.equal(storage.persist(), true)
  assert.equal(pendingCount(storage.load()), 1)
  assert.deepEqual(disk.events, ['local-write'])
})

test('settings/profile 变化入队，元数据不产生用户写入，旧快照不能清掉新队列', async () => {
  const disk = diskStorage(null)
  const storage = await fresh()
  const data = storage.load()
  const stale = structuredClone(data)
  storage.save({ ...data, settings: { ...data.settings, hideCompletedByView: { tasks: false, month: true } } }, { strict: true })
  assert.ok(storage.load().syncMeta.outbox.setting['show_completed.tasks'])
  storage.save({ ...storage.load(), profile: { name: '用户' }, syncMeta: stale.syncMeta }, { strict: true })
  assert.ok(storage.load().syncMeta.outbox.setting['show_completed.tasks'])
  assert.ok(storage.load().syncMeta.outbox.setting['mobile.profile'])
  assert.equal(pendingCount(storage.load()), 2)
  assert.equal(disk.events.length, 2)
})

test('业务删除分类、事项子树和纪念日级联墓碑，所有查询隐藏墓碑且拒绝编辑', async () => {
  diskStorage({ categories: [{ id: 'c', name: '分类' }], tasks: [
    { id: 'p', title: '父事项', categoryId: 'c', repeatRule: '{"kind":"none"}' },
    { id: 'child', title: '子事项', parentTaskId: 'p' }, { id: 'leaf', title: '孙事项', parentTaskId: 'child' }
  ], anniversaries: [{ id: 'a', title: '纪念日', photos: [] }], anniversaryRecords: [{ anniversaryId: 'a', date: '2026-01-01' }] })
  store.removeCategory('c')
  assert.deepEqual(store.getCategories(), [])
  assert.equal(store.categoryById('c'), null)
  assert.equal(store.findTask('p').categoryId, null)
  assert.equal(store.getNewTaskDefaults().categoryId, null)
  await store.removeTask('p')
  assert.deepEqual(store.listTasks(), [])
  assert.deepEqual(store.listChildren('p'), [])
  assert.equal(store.findTask('p'), null)
  assert.deepEqual(store.tasksForDate('2026-01-01'), [])
  assert.deepEqual(store.tasksGrouped(), [])
  assert.throws(() => store.saveTask({ id: 'p', title: '复活' }), /事项不存在/)
  assert.throws(() => store.setTaskStatus('p', 'done'), /事项不存在/)
  store.removeAnniversary('a')
  assert.deepEqual(store.listAnniversaries(), [])
  assert.deepEqual(store.listAnniversaryRecords(), [])
  assert.throws(() => store.getAnniversary('a'), /纪念日不存在/)
  assert.throws(() => store.pinAnniversary('a', true), /纪念日不存在/)
  const raw = businessStorage.load()
  assert.ok(raw.categories.every(item => item.deletedAt))
  assert.ok(raw.tasks.every(item => item.deletedAt))
  assert.ok(raw.anniversaries.every(item => item.deletedAt))
  assert.ok(raw.anniversaryRecords.every(item => item.deletedAt))
  assert.equal(pendingCount(raw), 6)
})

test('reset 保留设备与绑定，将旧用户实体转墓碑并作为真实写入', async () => {
  const disk = diskStorage({ categories: [], tasks: [{ id: 'custom', title: '用户事项' }] })
  const storage = await fresh()
  const first = storage.load()
  storage.save({ ...first, syncMeta: { ...first.syncMeta, remoteUserId: 'u', cursor: 9 } }, { remote: true, strict: true })
  storage.reset()
  assert.equal(storage.load().syncMeta.deviceId, first.syncMeta.deviceId)
  assert.equal(storage.load().syncMeta.remoteUserId, 'u')
  assert.equal(storage.load().syncMeta.cursor, 9)
  assert.equal(storage.load().syncMeta.dataOrigin, 'user')
  assert.ok(storage.load().tasks.find(item => item.id === 'custom').deletedAt)
  assert.ok(storage.load().syncMeta.outbox.task.custom)
  assert.deepEqual(disk.events, ['local-write'])
})
