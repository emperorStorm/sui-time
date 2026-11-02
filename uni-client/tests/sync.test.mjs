import test from 'node:test'
import assert from 'node:assert/strict'
import { createSyncEngine, pushBatches } from '../src/api/sync.js'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function authHarness(origin) {
  const calls = []
  const context = vm.createContext({ uni: {
    getStorageSync: () => null,
    request(options) {
      calls.push(options)
      options.success({ statusCode: 200, data: { token: 'token', user: { id: 'u1', username: 'alice' } } })
    }
  } })
  const config = new vm.SourceTextModule(await readFile(new URL('../src/utils/sync-config.js', import.meta.url), 'utf8'), {
    context, initializeImportMeta(meta) { meta.env = { VITE_SUI_TIME_SYNC_BASE_URL: origin } }
  })
  const module = new vm.SourceTextModule(await readFile(new URL('../src/api/auth.js', import.meta.url), 'utf8'), { context })
  await module.link(() => config)
  await module.evaluate()
  return { api: module.namespace, calls }
}

test('共享认证使用 origin 与 /api/v1/auth，保留本地覆盖和空配置错误', async () => {
  for (const origin of ['https://laoshi.chat', 'http://127.0.0.1:8080/']) {
    const { api, calls } = await authHarness(origin)
    await api.authenticate('register', 'alice', 'password', 'mobile')
    await api.authenticate('login', 'alice', 'password', 'mobile')
    await api.revokeAuth({ token: 'token' })
    assert.deepEqual(calls.map(call => call.url), ['register', 'login', 'logout'].map(action => `${origin.replace(/\/+$/, '')}/api/v1/auth/${action}`))
    assert.equal(calls[0].header.Authorization, undefined)
    assert.equal(calls[2].header.Authorization, 'Bearer token')
  }
  for (const origin of [undefined, '', '  ']) {
    const { api, calls } = await authHarness(origin)
    await assert.rejects(api.authenticate('login', 'alice', 'password', 'mobile'), /未配置同步服务地址/)
    assert.equal(calls.length, 0)
  }
})

const clone = value => JSON.parse(JSON.stringify(value))
const task = (id = 't1', title = '本机', updatedAt = 10) => ({ id, title, status: 'todo', updatedAt, createdAt: 1 })
const change = (id = 't1', title = '远端', updatedAt = 10) => ({ entity: 'task', id, updatedAt, deletedAt: null, deviceId: 'remote', data: task(id, title, updatedAt) })
function fixture({ bound = true, request, data: patch = {} } = {}) {
  let data = { categories: [], tasks: [task()], anniversaries: [], anniversaryRecords: [], settings: { hideCompleted: true }, profile: { name: '本机' },
    syncMeta: { deviceId: 'mobile', cursor: 2, remoteUserId: bound ? 'u1' : null, remoteUsername: bound ? 'alice' : null,
      lastSyncAt: null, dataOrigin: 'user', outbox: { task: { t1: 10 } } }, ...patch }
  let auth = bound ? { token: 'token', user: { id: 'u1', username: 'alice' } } : null
  const calls = []; const saves = []; const events = []
  const engine = createSyncEngine({
    load: () => clone(data), save(value, options) { assert.equal(options.remote, true); assert.equal(options.strict, true); saves.push(clone(value)); data = clone(value) },
    readAuth: () => auth, writeAuth: value => { auth = value },
    authenticate: async () => ({ token: 'new-token', user: { id: 'u1', username: 'alice' } }), revokeAuth: async () => {},
    request: async (path, options) => {
      calls.push({ path, ...clone(options || {}) })
      if (request) return request(path, options)
      if (path.includes('/push')) return { applied: [], superseded: [] }
      if (path.includes('/state')) return { remoteEmpty: true }
      return { changes: [], nextCursor: 3, hasMore: false }
    }, emit: event => events.push(event)
  })
  return { engine, calls, saves, events, get data() { return data }, get auth() { return auth }, edit(fn) { fn(data) } }
}

test('同步单飞，完整拉取后远端应用和游标同次保存', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture({ request: async path => {
    if (path.includes('/push')) { await gate; return { applied: [], superseded: [] } }
    return { changes: [change()], nextCursor: 8, hasMore: false }
  } })
  const first = f.engine.syncNow()
  assert.equal(first, f.engine.syncNow())
  release(); await first
  assert.equal(f.calls.filter(call => call.path.includes('/push')).length, 1)
  assert.deepEqual(f.calls.map(call => call.path), [
    '/api/v1/sui-time/sync/push', '/api/v1/sui-time/sync/pull?cursor=2&limit=500'
  ])
  assert.equal(f.data.tasks[0].title, '远端')
  assert.equal(f.data.syncMeta.cursor, 8)
  assert.deepEqual(f.data.syncMeta.outbox.task, {})
  assert.equal(f.saves.length, 1)
  assert.deepEqual(f.events, ['sync-applied'])
})

test('上传期间编辑同一事项，保留新内容与新队列版本', async () => {
  const f = fixture({ request: async path => {
    if (path.includes('/push')) {
      f.edit(data => { data.tasks[0].title = '期间编辑'; data.tasks[0].updatedAt = 11; data.syncMeta.outbox.task.t1 = 11 })
      return { applied: [], superseded: [] }
    }
    return { changes: [change()], nextCursor: 4, hasMore: false }
  } })
  await f.engine.syncNow()
  assert.equal(f.data.tasks[0].title, '期间编辑')
  assert.equal(f.data.syncMeta.outbox.task.t1, 11)
})

test('同毫秒内容改变也不会误出队，网络期间删除也不复活', async () => {
  for (const remove of [false, true]) {
    const f = fixture({ request: async path => {
      if (path.includes('/push')) {
        f.edit(data => { if (remove) data.tasks = []; else data.tasks[0].title = '同毫秒编辑' })
        return { applied: [], superseded: [] }
      }
      return { changes: [change()], nextCursor: 4, hasMore: false }
    } })
    await f.engine.syncNow()
    assert.equal(f.data.syncMeta.outbox.task.t1, 10)
    assert.equal(f.data.tasks.length, remove ? 0 : 1)
    if (!remove) assert.equal(f.data.tasks[0].title, '同毫秒编辑')
  }
})

test('拉取第二页失败时所有本地数据、队列和游标保持原值，重试可成功', async () => {
  let fail = true
  const f = fixture({ request: async path => {
    if (path.includes('/push')) return { applied: [], superseded: [] }
    if (path.includes('cursor=2')) return { changes: [change()], nextCursor: 5, hasMore: true }
    if (fail) throw new Error('断网')
    return { changes: [change('t2', '第二页')], nextCursor: 9, hasMore: false }
  } })
  const before = clone(f.data)
  await assert.rejects(f.engine.syncNow(), /断网/)
  assert.deepEqual(f.data, before)
  assert.equal(f.saves.length, 0)
  fail = false; await f.engine.syncNow()
  assert.equal(f.data.tasks.length, 2)
  assert.equal(f.data.syncMeta.cursor, 9)
})

test('401 标记 needsReauth，保留全部数据和待上传项', async () => {
  const f = fixture({ request: async () => { throw Object.assign(new Error('会话过期'), { status: 401 }) } })
  const before = clone(f.data)
  await assert.rejects(f.engine.syncNow(), /会话过期/)
  assert.equal(f.engine.getState().status, 'needsReauth')
  assert.deepEqual(f.data, before)
})

test('拒绝不前进分页与非法变更，游标不落盘', async () => {
  for (const page of [{ changes: [], nextCursor: 2, hasMore: true }, { changes: [{}], nextCursor: 3, hasMore: false }]) {
    const f = fixture({ request: async path => path.includes('/push') ? { applied: [], superseded: [] } : page })
    await assert.rejects(f.engine.syncNow(), /无效/)
    assert.equal(f.saves.length, 0)
  }
})

test('push 按 200 条及完整请求 UTF-8 8MB 分批', () => {
  const many = Array.from({ length: 401 }, (_, index) => change(`t${index}`))
  assert.deepEqual(pushBatches(many, 'mobile').map(batch => batch.length), [200, 200, 1])
  const large = change('large', '中'.repeat(1500000))
  const batches = pushBatches([large, large], 'mobile', true)
  assert.equal(batches.length, 2)
  for (const batch of batches) assert.ok(Buffer.byteLength(JSON.stringify({ deviceId: 'mobile', requireEmpty: true, changes: batch })) <= 8 * 1024 * 1024)
  assert.throws(() => pushBatches([change('huge', '中'.repeat(3000000))], 'mobile'), /8MB/)
})

test('全部五类实体、设置、资料与复合记录 ID 映射', async () => {
  const f = fixture({ data: {
    categories: [{ id: 'c1', name: '分类', color: '#ffffff' }], anniversaries: [{ id: 'a1', title: '纪念', kind: 'anniversary', date: '2020-01-01' }],
    anniversaryRecords: [{ anniversaryId: 'a1', date: '2026-01-01', title: '纪念', kind: 'anniversary', originalDate: '2020-01-01' }],
    syncMeta: { deviceId: 'mobile', cursor: 0, remoteUserId: 'u1', outbox: { category: { c1: 10 }, task: { t1: 10, removed: 11 }, anniversary: { a1: 10 }, anniversary_record: { 'a1@2026-01-01': 10 }, setting: { 'show_completed.tasks': 10, 'mobile.profile': 10 } } }
  } })
  await f.engine.syncNow()
  const changes = f.calls.find(call => call.path.includes('/push')).data.changes
  assert.equal(changes.length, 7)
  assert.equal(changes.find(item => item.id === 'removed').deletedAt, 11)
  assert.equal(changes.find(item => item.entity === 'anniversary_record').id, 'a1@2026-01-01')
  assert.deepEqual(changes.find(item => item.id === 'mobile.profile').data.value, { name: '本机' })
})

test('superseded 应用服务端版本，删除与 setting 正确落盘', async () => {
  const f = fixture({ request: async path => path.includes('/push')
    ? { applied: [], superseded: [{ entity: 'task', id: 't1', server: change('t1', '服务端胜出', 20) }] }
    : { changes: [{ entity: 'setting', id: 'mobile.profile', updatedAt: 20, data: { value: { name: '云端资料' } } }, { ...change('t2'), deletedAt: 10 }], nextCursor: 4, hasMore: false } })
  await f.engine.syncNow()
  assert.equal(f.data.tasks[0].title, '服务端胜出')
  assert.equal(f.data.profile.name, '云端资料')
})

test('远端替换先拉完网络，失败保留数据且不保存凭证', async () => {
  const f = fixture({ bound: false, request: async () => { throw new Error('离线') } })
  const before = clone(f.data)
  await assert.rejects(f.engine.bind({ username: 'alice', password: 'password', strategy: 'remote' }), /离线/)
  assert.deepEqual(f.data, before)
  assert.equal(f.auth, null)
})

test('远端替换期间编辑本机，拒绝覆盖并保留编辑', async () => {
  const f = fixture({ bound: false, request: async () => {
    f.edit(data => { data.tasks[0].title = '正在编辑' })
    return { changes: [change()], nextCursor: 5, hasMore: false }
  } })
  await assert.rejects(f.engine.bind({ strategy: 'remote' }), /本机数据已修改/)
  assert.equal(f.data.tasks[0].title, '正在编辑')
  assert.equal(f.auth, null)
})

test('seed 默认远端替换，云端为空清除演示数据；解绑保留业务数据', async () => {
  const f = fixture({ bound: false })
  f.edit(data => { data.syncMeta.dataOrigin = 'seed' })
  await f.engine.bind({ username: 'alice', password: 'password' })
  assert.equal(f.calls.some(call => call.path.includes('/push')), false)
  assert.deepEqual(f.data.tasks, [])
  assert.equal(f.data.syncMeta.remoteUserId, 'u1')
  assert.equal(f.auth.token, 'new-token')
  const before = clone(f.data.profile)
  await f.engine.unbind()
  assert.equal(f.auth, null)
  assert.equal(f.data.syncMeta.remoteUserId, null)
  assert.deepEqual(f.data.profile, before)
})

test('upload 对首批要求 requireEmpty；merge 不要求云端为空', async () => {
  for (const strategy of ['upload', 'merge']) {
    const f = fixture({ bound: false })
    f.edit(data => { data.tasks = Array.from({ length: 205 }, (_, index) => task(`t${index}`)) })
    await f.engine.bind({ strategy })
    assert.deepEqual(f.calls.filter(call => call.path.endsWith('/state')).map(call => call.path),
      strategy === 'upload' ? ['/api/v1/sui-time/sync/state'] : [])
    const pushes = f.calls.filter(call => call.path.includes('/push'))
    assert.equal(pushes.length, 2)
    assert.equal(pushes[0].data.requireEmpty, strategy === 'upload')
    assert.equal(pushes[1].data.requireEmpty, false)
    assert.equal(f.data.syncMeta.remoteUserId, 'u1')
  }
})

test('upload 云端非空时拒绝绑定，不动本机业务与凭证', async () => {
  const f = fixture({ bound: false, request: async () => ({ remoteEmpty: false }) })
  const before = clone(f.data)
  await assert.rejects(f.engine.bind({ strategy: 'upload' }), /云端已有数据/)
  assert.deepEqual(f.data, before)
  assert.equal(f.auth, null)
})

test('持久化失败不声明成功，游标、队列保留', async () => {
  let persisted = { categories: [], tasks: [task()], anniversaries: [], anniversaryRecords: [], settings: {}, profile: {},
    syncMeta: { deviceId: 'mobile', cursor: 0, remoteUserId: 'u1', outbox: { task: { t1: 10 } } } }
  const before = clone(persisted)
  const engine = createSyncEngine({ load: () => clone(persisted), save() { throw new Error('存储已满') },
    readAuth: () => ({ token: 'token', user: { id: 'u1' } }), request: async path => path.includes('/push') ? { applied: [], superseded: [] } : { changes: [], nextCursor: 8, hasMore: false } })
  await assert.rejects(engine.syncNow(), /存储已满/)
  assert.deepEqual(persisted, before)
})
