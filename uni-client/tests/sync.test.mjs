import test from 'node:test'
import assert from 'node:assert/strict'
import { createSyncEngine, pushBatches, initialBatches } from '../src/api/sync.js'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function authHarness(origin, response = { statusCode: 200, data: { token: 'token', user: { id: 'u1', username: 'alice' } } }) {
  const calls = []
  const context = vm.createContext({ uni: {
    getStorageSync: () => null,
    request(options) {
      calls.push(options)
      options.success(response)
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

test('认证用户名兼容不支持 Unicode 属性正则的运行环境', async () => {
  const { api, calls } = await authHarness('https://laoshi.chat')
  await api.authenticate('login', ' admin ', 'password', 'mobile')
  await api.authenticate('register', '中文账号', 'password', 'mobile')
  assert.equal(calls[0].data.username, 'admin')
  assert.equal(calls[1].data.username, '中文账号')
  await assert.rejects(api.authenticate('login', 'ab', 'password', 'mobile'), /用户名需为 3-32 位/)
  await assert.rejects(api.authenticate('register', 'a'.repeat(33), 'password', 'mobile'), /用户名需为 3-32 位/)
  assert.equal(calls.length, 2)
  const source = await readFile(new URL('../src/api/auth.js', import.meta.url), 'utf8')
  assert.equal(source.includes('\\p{'), false)
})

test('旧服务缺少初始化接口时提示升级，已支持服务的会话不存在错误保留', async () => {
  const old = await authHarness('http://127.0.0.1', { statusCode: 404, data: '404 page not found' })
  await assert.rejects(old.api.request('/api/v1/sui-time/sync/init/start'), /请先升级同步服务/)
  const current = await authHarness('http://127.0.0.1', { statusCode: 404, data: { error: { code: 'init_not_found', message: '初始化会话不存在' } } })
  await assert.rejects(current.api.request('/api/v1/sui-time/sync/init/status'), error => error.code === 'init_not_found' && error.message === '初始化会话不存在')
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
  return { engine, calls, saves, events, get data() { return data }, get auth() { return auth }, setAuth(value) { auth = value }, edit(fn) { fn(data) } }
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

test('手动同步上传再拉取，空队列仍拉取远端', async () => {
  const f = fixture()
  await f.engine.manualSync()
  assert.deepEqual(f.calls.map(call => call.path), ['/api/v1/sui-time/sync/push', '/api/v1/sui-time/sync/pull?cursor=2&limit=500'])
  assert.equal(f.calls[0].data.changes[0].id, 't1')
  f.calls.length = 0
  await f.engine.manualSync()
  assert.deepEqual(f.calls.map(call => call.path), ['/api/v1/sui-time/sync/pull?cursor=3&limit=500'])
})

test('手动同步等待普通同步后使用新快照，并拒绝重入和账号操作', async () => {
  let release, started
  const gate = new Promise(resolve => { release = resolve })
  const begun = new Promise(resolve => { started = resolve })
  let first = true
  const f = fixture({ request: async path => {
    if (path.includes('/push') && first) { first = false; started(); await gate }
    return path.includes('/push') ? { applied: [], superseded: [] } : { changes: [], nextCursor: 3, hasMore: false }
  } })
  const auto = f.engine.syncNow(); await begun
  f.edit(data => { data.tasks[0].title = '下拉之前的编辑'; data.tasks[0].updatedAt = 11; data.syncMeta.outbox.task.t1 = 11 })
  const manual = f.engine.manualSync()
  assert.equal(f.engine.syncNow(), manual)
  await assert.rejects(f.engine.manualSync(), /正在进行/)
  await assert.rejects(f.engine.unbind(), /正在进行/)
  release(); await auto; await manual
  assert.deepEqual(f.calls.map(call => call.path.split('?')[0]), ['/api/v1/sui-time/sync/push', '/api/v1/sui-time/sync/pull', '/api/v1/sui-time/sync/push', '/api/v1/sui-time/sync/pull'])
  assert.equal(f.calls[2].data.changes[0].data.title, '下拉之前的编辑')
  assert.deepEqual(f.data.syncMeta.outbox.task, {})
})

test('账号操作期间拒绝手动同步，未绑定及无凭证不得报成功', async () => {
  let release, started
  const gate = new Promise(resolve => { release = resolve })
  const begun = new Promise(resolve => { started = resolve })
  const f = fixture({ request: async () => { started(); await gate; return { changes: [], nextCursor: 3, hasMore: false } }, bound: false })
  const binding = f.engine.bind({ strategy: 'remote' }); await begun
  await assert.rejects(f.engine.manualSync(), /账号操作/)
  release(); await binding
  for (const operation of ['unbind', 'cancelInitialUpload']) {
    const active = fixture()
    const account = active.engine[operation]({})
    const settled = account.catch(() => {})
    await assert.rejects(active.engine.manualSync(), /账号操作/)
    await settled
  }
  const unbound = fixture({ bound: false })
  await assert.rejects(unbound.engine.manualSync(), /尚未绑定/)
  assert.equal(unbound.calls.length, 0)
  const missing = fixture(); missing.setAuth(null)
  await assert.rejects(missing.engine.manualSync(), /登录凭证/)
  assert.equal(missing.calls.length, 0)
})

test('手动同步失败保留队列；普通同步失败后仍执行手动新一轮', async () => {
  let release, started, attempts = 0
  const gate = new Promise(resolve => { release = resolve })
  const begun = new Promise(resolve => { started = resolve })
  const f = fixture({ request: async path => {
    if (path.includes('/push') && ++attempts === 1) { started(); await gate; throw new Error('离线') }
    return path.includes('/push') ? { applied: [], superseded: [] } : { changes: [], nextCursor: 3, hasMore: false }
  } })
  const auto = f.engine.syncNow(); const failed = assert.rejects(auto, /离线/); await begun
  const manual = f.engine.manualSync(); release(); await failed; await manual
  assert.equal(attempts, 2); assert.deepEqual(f.data.syncMeta.outbox.task, {})
  const broken = fixture({ request: async () => { throw new Error('断网') } })
  const before = clone(broken.data)
  await assert.rejects(broken.engine.manualSync(), /断网/)
  assert.deepEqual(broken.data, before)
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

test('merge 仍使用普通 push 分批', async () => {
  const f = fixture({ bound: false })
  f.edit(data => { data.tasks = Array.from({ length: 205 }, (_, index) => task(`t${index}`)) })
  await f.engine.bind({ strategy: 'merge' })
  const pushes = f.calls.filter(call => call.path.includes('/push'))
  assert.equal(pushes.length, 2)
  assert.ok(pushes.every(call => call.data.requireEmpty === false))
  assert.equal(f.data.syncMeta.remoteUserId, 'u1')
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

let initialRevision = 0
async function initialHarness({ tasks = [task()], failAt = '', beforeResponse = () => {}, beforeStart = () => {} } = {}) {
  let disk = { version: 2, categories: [], tasks, anniversaries: [], anniversaryRecords: [], settings: {}, profile: { name: '本机' },
    syncMeta: { deviceId: 'mobile', cursor: 0, remoteUserId: null, outbox: {}, dataOrigin: 'user' } }
  let failSave = false; let auth = null; let userId = 'u1'; let server = null; let lost = failAt
  const calls = []; const pushed = new Map()
  globalThis.uni = { getStorageSync: () => clone(disk), setStorageSync: (_, value) => { if (failSave) throw Error('quota'); disk = clone(value) }, $emit() {} }
  let storage = await import(`../src/api/storage.js?init-test=${++initialRevision}`)
  const status = () => ({ sessionId: server.sessionId, status: server.status, batchCount: server.batchCount, received: [...server.received].sort((a, b) => a - b) })
  const request = async (path, options = {}) => {
    calls.push({ path, ...clone(options) })
    let result; let stage
    if (path.includes('/init/status')) {
      stage = 'status'
      if (!server) throw Object.assign(new Error('尚未创建'), { status: 404 })
      result = status()
    } else if (path.endsWith('/init/start')) {
      stage = 'start'
      beforeStart({ server, options })
      if (!server) server = { ...options.data, status: 'active', received: new Set(), batches: new Map() }
      else if (server.sessionId !== options.data.sessionId || server.batchCount !== options.data.batchCount) throw new Error('会话不匹配')
      result = status()
    } else if (path.endsWith('/init/cancel')) {
      stage = 'cancel'
      if (server.status === 'completed') throw Object.assign(new Error('已完成'), { code: 'init_completed' })
      server.status = 'cancelled'; result = status()
    } else if (path.endsWith('/init/batch')) {
      stage = 'batch'
      const { index, changes } = options.data
      const previous = server.batches.get(index)
      if (previous !== undefined && previous !== JSON.stringify(changes)) throw new Error('批次摘要不一致')
      if (server.status === 'completed' && previous === undefined) throw new Error('已完成会话缺少批次')
      server.batches.set(index, JSON.stringify(changes))
      server.received.add(index); result = status()
    } else if (path.endsWith('/init/complete')) {
      stage = 'complete'; assert.equal(server.received.size, server.batchCount)
      server.status = 'completed'; result = status()
    } else if (path.endsWith('/push')) {
      stage = 'push'
      for (const item of options.data.changes) pushed.set(JSON.stringify([item.entity, item.id]), clone(item))
      result = { applied: [], superseded: [] }
    } else if (path.includes('/pull')) {
      stage = 'pull'; result = { changes: [change()], nextCursor: 5, hasMore: false }
    } else throw new Error(`意外请求 ${path}`)
    beforeResponse(stage, { storage, server, result, options })
    if (lost === stage) { lost = ''; throw Error('响应丢失') }
    return result
  }
  const create = () => createSyncEngine({ load: storage.load, save: storage.save, request,
    readAuth: () => auth, writeAuth: value => { auth = value }, authenticate: async () => ({ token: `token-${userId}`, user: { id: userId, username: userId === 'u1' ? 'alice' : 'bob' } }), revokeAuth: async () => {} })
  let engine = create()
  return { get engine() { return engine }, get storage() { return storage }, get disk() { return clone(disk) }, get server() { return server }, calls, pushed,
    failSave(value) { failSave = value }, setUser(value) { userId = value }, clearAuth() { auth = null },
    setAuth(value) { auth = value }, setLost(value) { lost = value }, edit(fn) { const data = clone(storage.load()); fn(data); storage.save(data, { remote: true, strict: true }) },
    async restart() { storage = await import(`../src/api/storage.js?init-test=${++initialRevision}`); engine = create() } }
}

test('手动同步先恢复首次上传或合并，再执行普通同步', async () => {
  for (const strategy of ['upload', 'merge']) {
    const h = await initialHarness({ failAt: strategy === 'upload' ? 'complete' : 'pull' })
    await assert.rejects(h.engine.bind({ strategy }), /响应丢失/)
    h.edit(data => { data.tasks[0].title = '恢复前编辑'; data.tasks[0].updatedAt = 20; data.syncMeta.outbox.task.t1 = 20 })
    const start = h.calls.length
    await h.engine.manualSync()
    const paths = h.calls.slice(start).map(call => call.path.split('?')[0])
    assert.equal(paths.at(-1), '/api/v1/sui-time/sync/pull')
    if (strategy === 'upload') assert.ok(paths.indexOf('/api/v1/sui-time/sync/init/start') < paths.indexOf('/api/v1/sui-time/sync/push'))
    else assert.equal(paths.filter(path => path.endsWith('/pull')).length, 2)
    assert.equal(h.disk.syncMeta.remoteUserId, 'u1')
    assert.equal(h.disk.syncMeta.outbox.task.t1, undefined)
  }
})

test('手动恢复初始化期间的新编辑在后续普通同步中上传', async () => {
  let duringManual = false, edited = false
  const h = await initialHarness({ failAt: 'start', beforeResponse(stage, { storage }) {
    if (!duringManual || stage !== 'batch' || edited) return
    edited = true
    const data = storage.load(); data.tasks[0].title = '恢复期间编辑'
    storage.save(data, { strict: true })
  } })
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
  duringManual = true
  await h.engine.manualSync()
  assert.equal(h.pushed.get(JSON.stringify(['task', 't1'])).data.title, '恢复期间编辑')
  assert.equal(h.disk.syncMeta.outbox.task.t1, undefined)
})

test('首次合并部分上传失败后持久化待恢复状态，重启及原账号重登才能完成', async () => {
  let pushes = 0
  const h = await initialHarness({ tasks: Array.from({ length: 205 }, (_, i) => task(`t${i}`)), beforeResponse(stage) {
    if (stage === 'push' && ++pushes === 2) throw new Error('第二批断网')
  } })
  await assert.rejects(h.engine.bind({ strategy: 'merge' }), /第二批断网/)
  assert.equal(h.disk.syncMeta.remoteUserId, null)
  assert.deepEqual(h.disk.syncMeta.initialMerge, { userId: 'u1', username: 'alice', deviceId: 'mobile' })
  assert.equal(h.disk.tasks.length, 205)
  assert.ok(Object.keys(h.disk.syncMeta.outbox.task).length >= 205)
  assert.ok(h.pushed.size >= 205)
  await h.restart(); h.clearAuth(); h.setUser('u2')
  await assert.rejects(h.engine.bind({ strategy: 'remote' }), /原账号/)
  await assert.rejects(h.engine.unbind(), /尚未完成/)
  assert.equal(h.disk.syncMeta.remoteUserId, null)
  h.setUser('u1'); await h.engine.bind({ strategy: 'remote' })
  assert.equal(h.disk.syncMeta.initialMerge, null)
  assert.equal(h.disk.syncMeta.remoteUserId, 'u1')
  assert.equal(h.disk.tasks.length, 205)
  assert.equal(h.disk.syncMeta.cursor, 5)
})

test('首次合并拉取或最终保存失败保留待恢复状态，重试保护并发编辑', async () => {
  for (const fail of ['pull', 'save']) {
    let h; let injected = false
    h = await initialHarness({ beforeResponse(stage, { storage }) {
      if (stage !== 'pull' || injected) return
      injected = true
      const data = storage.load(); data.tasks[0].title = '合并期间编辑'
      data.tasks.push(task('new', '新增', 20)); storage.save(data, { strict: true })
      if (fail === 'pull') throw new Error('拉取中断')
      h.failSave(true)
    } })
    await assert.rejects(h.engine.bind({ strategy: 'merge' }), fail === 'pull' ? /拉取中断/ : /无法保存/)
    assert.equal(h.disk.syncMeta.remoteUserId, null)
    assert.ok(h.disk.syncMeta.initialMerge)
    assert.equal(h.disk.tasks[0].title, '合并期间编辑')
    h.failSave(false); await h.restart(); await h.engine.syncNow()
    assert.equal(h.disk.syncMeta.remoteUserId, 'u1')
    assert.equal(h.disk.syncMeta.initialMerge, null)
    assert.equal(h.pushed.get(JSON.stringify(['task', 't1'])).data.title, '合并期间编辑')
    assert.ok(h.pushed.has(JSON.stringify(['task', 'new'])))
  }
})

test('首次合并开始落盘失败不上传；401 后重新登录原账号恢复', async () => {
  const failed = await initialHarness(); failed.storage.load(); failed.failSave(true)
  await assert.rejects(failed.engine.bind({ strategy: 'merge' }), /无法保存/)
  assert.equal(failed.calls.length, 0); assert.equal(failed.disk.syncMeta.remoteUserId, null)
  assert.equal(failed.disk.syncMeta.initialMerge, undefined)
  let expired = false
  const h = await initialHarness({ beforeResponse(stage) {
    if (stage === 'push' && !expired) { expired = true; throw Object.assign(new Error('登录过期'), { status: 401 }) }
  } })
  await assert.rejects(h.engine.bind({ strategy: 'merge' }), /登录过期/)
  assert.equal(h.engine.getState().status, 'needsReauth')
  assert.equal(h.disk.syncMeta.remoteUserId, null); assert.ok(h.disk.syncMeta.initialMerge)
  h.clearAuth(); await h.restart(); await h.engine.bind({ strategy: 'upload' })
  assert.equal(h.disk.syncMeta.remoteUserId, 'u1'); assert.equal(h.disk.syncMeta.initialMerge, null)
  assert.equal(h.calls.some(call => call.path.includes('/init/')), false)
})

test('首次合并网络中并发修改不被远端覆盖或误出队', async () => {
  let edited = false
  const h = await initialHarness({ beforeResponse(stage, { storage }) {
    if (stage !== 'push' || edited) return
    edited = true
    const data = storage.load(); data.tasks[0].title = '并发编辑'; data.tasks.push(task('new', '新增', 20))
    storage.save(data, { strict: true })
  } })
  await h.engine.bind({ strategy: 'merge' })
  assert.equal(h.disk.tasks.find(item => item.id === 't1').title, '并发编辑')
  assert.equal(h.disk.tasks.find(item => item.id === 'new').title, '新增')
  assert.ok(h.disk.syncMeta.outbox.task.t1); assert.ok(h.disk.syncMeta.outbox.task.new)
  assert.equal(h.disk.syncMeta.remoteUserId, 'u1')
})

test('首次上传按完整 UTF-8 请求大小和索引确定性分批，空快照可发送', () => {
  const sessionId = 's'.repeat(40); const deviceId = '设备'; const changes = Array.from({ length: 401 }, (_, i) => change(`t${i}`))
  const batches = initialBatches(changes, sessionId, deviceId)
  assert.deepEqual(batches.map(batch => batch.length), [200, 200, 1])
  assert.deepEqual(initialBatches([], sessionId, deviceId), [[]])
  const large = change('large', '中'.repeat(1500000))
  for (const [index, batch] of initialBatches([large, large], sessionId, deviceId).entries()) {
    assert.ok(Buffer.byteLength(JSON.stringify({ sessionId, deviceId, index, changes: batch })) <= 8 * 1024 * 1024)
  }
  assert.throws(() => initialBatches([change('huge', '中'.repeat(3000000))], sessionId, deviceId), /8MB/)
})

test('首次上传快照不得超过 1000 批或 256 MiB', () => {
  const small = change('same')
  assert.equal(initialBatches(Array(200000).fill(small), 'session', 'mobile').length, 1000)
  assert.throws(() => initialBatches(Array(200001).fill(small), 'session', 'mobile'), /1000 批/)
  const large = change('large', 'x'.repeat(1024 * 1024))
  assert.throws(() => initialBatches(Array(256).fill(large), 'session', 'mobile'), /256 MiB/)
})

test('首次上传超出单条上限时不落盘快照或发送请求', async () => {
  const h = await initialHarness({ tasks: [task('large', 'x'.repeat(8 * 1024 * 1024))] })
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /8MB/)
  assert.equal(h.calls.length, 0); assert.equal(h.disk.syncMeta.initialUpload, undefined)
})

test('空业务数据首次上传也携带设置并可恢复', async () => {
  const h = await initialHarness({ tasks: [], failAt: 'complete' })
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
  const session = h.disk.syncMeta.initialUpload
  assert.equal(session.batches.length, 1)
  assert.ok(session.batches[0].every(item => item.entity === 'setting'))
  await h.restart(); await h.engine.syncNow()
  assert.equal(h.disk.syncMeta.remoteUserId, 'u1')
})

test('首次上传先严格落盘，失败时无网络请求和绑定', async () => {
  const h = await initialHarness(); h.storage.load(); h.failSave(true)
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /无法保存/)
  assert.equal(h.calls.length, 0); assert.equal(h.disk.syncMeta.remoteUserId, null)
  assert.equal(h.disk.syncMeta.initialUpload, undefined)
})

test('首次上传响应丢失、重启与拉取失败均从原会话恢复', async () => {
  for (const failAt of ['start', 'batch', 'complete', 'pull']) {
    const h = await initialHarness({ tasks: Array.from({ length: 205 }, (_, i) => task(`t${i}`)), failAt })
    await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
    const session = clone(h.disk.syncMeta.initialUpload)
    assert.ok(session.sessionId); assert.equal(h.disk.syncMeta.remoteUserId, null)
    assert.equal(h.calls.some(call => call.path.endsWith('/push')), false)
    await h.restart(); await h.engine.syncNow()
    assert.equal(h.disk.syncMeta.remoteUserId, 'u1'); assert.equal(h.disk.syncMeta.initialUpload, null)
    assert.equal(h.disk.syncMeta.cursor, 5)
    assert.equal(h.calls.filter(call => call.path.endsWith('/init/start')).length, 2)
    assert.ok(h.calls.filter(call => call.path.endsWith('/init/batch')).every(call => call.data.sessionId === session.sessionId))
    if (failAt === 'complete' || failAt === 'pull') assert.equal(h.calls.filter(call => call.path.endsWith('/init/complete')).length, 1)
  }
})

test('首次上传重发已接收及已完成批次，快照或分批改变时拒绝绑定', async () => {
  for (const status of ['active', 'completed']) for (const mutation of ['content', 'partition']) {
    const h = await initialHarness({ tasks: Array.from({ length: 205 }, (_, i) => task(`t${i}`)), failAt: status === 'active' ? 'batch' : 'complete' })
    await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
    h.edit(data => {
      const batches = data.syncMeta.initialUpload.batches
      if (mutation === 'content') batches[0][0].data.title = '快照损坏'
      else [batches[0][0], batches[1][0]] = [batches[1][0], batches[0][0]]
    })
    const before = h.disk; const calls = h.calls.length
    await h.restart(); await assert.rejects(h.engine.syncNow(), /摘要不一致/)
    assert.deepEqual(h.disk, before)
    assert.equal(h.disk.syncMeta.remoteUserId, null)
    assert.equal(h.calls.slice(calls).some(call => call.path.endsWith('/pull') || call.path.endsWith('/init/complete')), false)
    assert.equal(h.calls[calls + 1].data.index, 0)
  }
})

test('首次上传批次响应状态或已确认索引异常时不完成也不拉取', async () => {
  for (const mode of ['status', 'received', 'regression']) {
    let inject = false
    const h = await initialHarness({ tasks: Array.from({ length: 205 }, (_, i) => task(`t${i}`)), failAt: 'batch', beforeResponse(stage, { result, options }) {
      if (!inject || stage !== 'batch') return
      if (mode === 'status') result.status = 'completed'
      if (mode === 'received') result.received = []
      if (mode === 'regression' && options.data.index === 1) result.received = [1]
    } })
    await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
    inject = true
    const before = h.disk; const calls = h.calls.length
    await assert.rejects(h.engine.syncNow(), /无效/)
    assert.deepEqual(h.disk, before)
    assert.equal(h.calls.slice(calls).some(call => call.path.endsWith('/pull') || call.path.endsWith('/init/complete')), false)
  }
})

test('首次上传期间编辑同版本和新增实体不会被拉取覆盖或误出队', async () => {
  let edited = false
  const h = await initialHarness({ beforeResponse(stage, { storage }) {
    if (stage !== 'batch' || edited) return
    edited = true
    const data = storage.load(); data.tasks[0].title = '期间编辑'
    data.tasks.push(task('new', '新增', 20)); storage.save(data, { strict: true })
  } })
  await h.engine.bind({ strategy: 'upload' })
  assert.equal(h.disk.tasks.find(item => item.id === 't1').title, '期间编辑')
  assert.equal(h.disk.tasks.find(item => item.id === 'new').title, '新增')
  assert.ok(h.disk.syncMeta.outbox.task.t1); assert.ok(h.disk.syncMeta.outbox.task.new)
  assert.deepEqual(h.disk.syncMeta.outbox.setting, {})
})

test('同版本内容变化和新队列在首次上传拉取后仍被保护', async () => {
  let edited = false
  const h = await initialHarness({ beforeResponse(stage, { storage }) {
    if (stage !== 'batch' || edited) return
    edited = true
    const data = storage.load()
    data.tasks[0].title = '相同版本的新内容'
    storage.save(data, { remote: true, strict: true })
  } })
  await h.engine.bind({ strategy: 'upload' })
  assert.equal(h.disk.tasks[0].title, '相同版本的新内容')
  assert.equal(h.disk.syncMeta.outbox.task.t1, 10)
})

test('不支持首次上传协议或云端非空时保留会话且绝不降级', async () => {
  for (const error of [Object.assign(new Error('接口不可用'), { status: 501 }), Object.assign(new Error('云端已有数据'), { code: 'remote_not_empty' })]) {
    const h = await initialHarness({ beforeResponse(stage) { if (stage === 'start') throw error } })
    await assert.rejects(h.engine.bind({ strategy: 'upload' }), new RegExp(error.message))
    assert.ok(h.disk.syncMeta.initialUpload); assert.equal(h.disk.syncMeta.remoteUserId, null)
    assert.equal(h.calls.some(call => call.path.endsWith('/push')), false)
  }
})

test('完成后本地落盘失败仍保留会话，重启重新验证并安全提交', async () => {
  let h; let failed = false
  h = await initialHarness({ beforeResponse(stage) { if (stage === 'pull' && !failed) { failed = true; h.failSave(true) } } })
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /无法保存/)
  assert.equal(h.disk.syncMeta.remoteUserId, null); assert.ok(h.disk.syncMeta.initialUpload)
  h.failSave(false); await h.restart(); await h.engine.syncNow()
  assert.equal(h.server.status, 'completed'); assert.equal(h.disk.syncMeta.initialUpload, null)
  assert.equal(h.disk.syncMeta.remoteUserId, 'u1')
  assert.equal(h.calls.filter(call => call.path.endsWith('/init/complete')).length, 1)
})

test('首次上传 401 后重新登录原账号可继续原会话', async () => {
  let expired = false
  const h = await initialHarness({ beforeResponse(stage) {
    if (stage === 'batch' && !expired) { expired = true; throw Object.assign(new Error('登录过期'), { status: 401 }) }
  } })
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /登录过期/)
  assert.equal(h.engine.getState().status, 'needsReauth')
  const sessionId = h.disk.syncMeta.initialUpload.sessionId
  h.clearAuth(); await h.restart(); await h.engine.bind({ strategy: 'merge' })
  assert.equal(h.disk.syncMeta.remoteUserId, 'u1')
  assert.ok(h.calls.filter(call => call.path.endsWith('/init/batch')).every(call => call.data.sessionId === sessionId))
})

test('未完成会话阻止换账号和解绑，续期忽略新策略并恢复原会话', async () => {
  const h = await initialHarness({ failAt: 'start' })
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
  const session = clone(h.disk.syncMeta.initialUpload); h.clearAuth(); h.setUser('u2')
  await assert.rejects(h.engine.bind({ strategy: 'remote' }), /原账号/)
  await assert.rejects(h.engine.unbind(), /尚未完成/)
  assert.deepEqual(h.disk.syncMeta.initialUpload, session)
  h.setUser('u1'); await h.engine.bind({ strategy: 'remote' })
  assert.equal(h.disk.syncMeta.remoteUserId, 'u1'); assert.equal(h.disk.syncMeta.initialUpload, null)
  assert.equal(h.calls.some(call => call.path.endsWith('/push')), false)
})

const expectedSession = h => ({ sessionId: h.disk.syncMeta.initialUpload.sessionId, userId: h.disk.syncMeta.initialUpload.userId })

test('远端尚未创建会话时先创建再取消', async () => {
  let offline = true
  const h = await initialHarness({ beforeStart() { if (offline) throw new Error('离线') } })
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /离线/)
  assert.equal(h.server, null)
  offline = false; await h.engine.cancelInitialUpload(expectedSession(h))
  assert.equal(h.server.status, 'cancelled'); assert.equal(h.disk.syncMeta.initialUpload, null)
  assert.equal(h.calls.filter(call => call.path.endsWith('/init/cancel')).length, 1)
})

test('取消 active、expired 和 cancelled 会话并保留本机数据与 outbox', async () => {
  for (const status of ['active', 'expired', 'cancelled']) {
    const h = await initialHarness({ failAt: 'start' })
    await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
    h.server.status = status
    const before = h.disk; const expected = expectedSession(h)
    await h.engine.cancelInitialUpload(expected)
    assert.equal(h.server.status, 'cancelled')
    assert.equal(h.disk.syncMeta.initialUpload, null)
    assert.deepEqual(h.disk.tasks, before.tasks)
    assert.deepEqual(h.disk.syncMeta.outbox, before.syncMeta.outbox)
    assert.equal(h.disk.syncMeta.remoteUserId, null)
    const calls = h.calls.length; await h.engine.syncNow(); assert.equal(h.calls.length, calls)
  }
})

test('会话过期可退出，已完成必须继续完成绑定', async () => {
  for (const status of ['expired', 'cancelled']) {
    const h = await initialHarness({ failAt: 'start' })
    await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
    h.server.status = status
    await assert.rejects(h.engine.syncNow(), /过期或取消/)
    await h.engine.cancelInitialUpload(expectedSession(h))
    assert.equal(h.disk.syncMeta.initialUpload, null)
  }
  const h = await initialHarness({ failAt: 'complete' })
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
  await assert.rejects(h.engine.cancelInitialUpload(expectedSession(h)), /继续首次上传/)
  assert.ok(h.disk.syncMeta.initialUpload)
  await h.engine.syncNow(); assert.equal(h.disk.syncMeta.remoteUserId, 'u1')
})

test('start 返回确定未创建会话的错误可退出，其余错误不能清除快照', async () => {
  for (const code of ['remote_not_empty', 'init_in_progress', 'init_not_found', 'other', null]) {
    let inject = false
    const h = await initialHarness({ beforeStart() {
      if (inject) throw Object.assign(new Error('服务返回错误'), { code, status: 404 })
      throw new Error('离线')
    } })
    await assert.rejects(h.engine.bind({ strategy: 'upload' }), /离线/)
    assert.equal(h.server, null); inject = true
    const before = h.disk
    if (['remote_not_empty', 'init_in_progress'].includes(code)) {
      await h.engine.cancelInitialUpload(expectedSession(h))
      assert.equal(h.disk.syncMeta.initialUpload, null)
      assert.deepEqual(h.disk.syncMeta.outbox, before.syncMeta.outbox)
      assert.equal(h.calls.filter(call => call.path.endsWith('/init/cancel')).length, 0)
    } else {
      await assert.rejects(h.engine.cancelInitialUpload(expectedSession(h)), /服务返回错误/)
      assert.deepEqual(h.disk, before)
    }
  }
})

test('取消请求丢失可幂等重试；completed 竞争、协议异常及离线均保留快照', async () => {
  const h = await initialHarness({ failAt: 'start' })
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
  const session = expectedSession(h); h.setLost('cancel')
  await assert.rejects(h.engine.cancelInitialUpload(session), /响应丢失/)
  assert.equal(h.server.status, 'cancelled'); assert.ok(h.disk.syncMeta.initialUpload)
  await h.restart(); await h.engine.cancelInitialUpload(session)
  assert.equal(h.disk.syncMeta.initialUpload, null)
  for (const mode of ['sessionId', 'batchCount', 'status', 'cancelSession', 'cancelCount', 'cancelStatus', 'completed', 'offline']) {
    let inject = false
    const x = await initialHarness({ failAt: 'start', beforeResponse(stage, { result }) {
      if (!inject) return
      if (stage === 'start' && mode === 'offline') throw new Error('离线')
      if (stage === 'start' && mode === 'sessionId') result.sessionId = 'other'
      if (stage === 'start' && mode === 'batchCount') result.batchCount++
      if (stage === 'start' && mode === 'status') result.status = 'uploading'
      if (stage === 'cancel' && mode === 'cancelSession') result.sessionId = 'other'
      if (stage === 'cancel' && mode === 'cancelCount') result.batchCount++
      if (stage === 'cancel' && mode === 'cancelStatus') result.status = 'active'
      if (stage === 'cancel' && mode === 'completed') throw Object.assign(new Error('已完成'), { code: 'init_completed' })
    } })
    await assert.rejects(x.engine.bind({ strategy: 'upload' }), /响应丢失/)
    inject = true; const before = x.disk
    await assert.rejects(x.engine.cancelInitialUpload(expectedSession(x)))
    assert.deepEqual(x.disk, before, mode)
  }
})

test('取消期间账号、设备或会话改变以及保存失败均不得清除快照', async () => {
  for (const mode of ['auth', 'device', 'session', 'save']) {
    let inject = false; let h
    h = await initialHarness({ failAt: 'start', beforeResponse(stage) {
      if (!inject || stage !== 'cancel') return
      if (mode === 'auth') h.setAuth({ token: 'other', user: { id: 'u2' } })
      if (mode === 'device') h.edit(data => { data.syncMeta.deviceId = 'other'; data.syncMeta.initialUpload.deviceId = 'other' })
      if (mode === 'session') h.edit(data => { data.syncMeta.initialUpload.sessionId = 'other' })
      if (mode === 'save') h.failSave(true)
    } })
    await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
    inject = true
    await assert.rejects(h.engine.cancelInitialUpload(expectedSession(h)))
    assert.ok(h.disk.syncMeta.initialUpload, mode)
  }
})

test('取消前缺少原账号、会话变化或设备不匹配不发送请求', async () => {
  const h = await initialHarness({ failAt: 'start' })
  await assert.rejects(h.engine.bind({ strategy: 'upload' }), /响应丢失/)
  const expected = expectedSession(h); const count = h.calls.length
  await assert.rejects(h.engine.cancelInitialUpload({ ...expected, sessionId: 'other' }), /已改变/)
  h.clearAuth(); await assert.rejects(h.engine.cancelInitialUpload(expected), /登录原账号/)
  h.setAuth({ token: 'token', user: { id: 'u1' } }); h.edit(data => { data.syncMeta.initialUpload.sessionId = 'other' })
  await assert.rejects(h.engine.cancelInitialUpload(expected), /已改变/)
  assert.equal(h.calls.length, count); assert.ok(h.disk.syncMeta.initialUpload)
})

async function autoSyncHarness() {
  let now = 0; let nextId = 0; let offline = false; let gate = null
  const timers = new Map(); const listeners = new Map(); const calls = []
  let data = { categories: [], tasks: [task()], anniversaries: [], anniversaryRecords: [], settings: {}, profile: {},
    syncMeta: { deviceId: 'mobile', cursor: 0, remoteUserId: 'u1', outbox: {} } }
  const auth = { token: 'token', user: { id: 'u1' } }
  const addTimer = (fn, delay, repeat) => { const id = ++nextId; timers.set(id, { fn, at: now + delay, repeat }); return id }
  const uni = {
    $on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn) },
    $off(event, fn) { listeners.get(event)?.delete(fn) },
    $emit(event) { for (const fn of listeners.get(event) || []) fn() }
  }
  const context = vm.createContext({ uni, setTimeout: (fn, delay) => addTimer(fn, delay, 0), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => addTimer(fn, delay, delay), clearInterval: id => timers.delete(id) })
  const dependencies = {
    './storage.js': { load: () => clone(data), save: value => { data = clone(value) } },
    './sync-outbox.js': { syncSettings: () => ({}), applySyncSetting: () => {} },
    './auth.js': { readAuth: () => auth, writeAuth: () => {}, authenticate: () => {}, revokeAuth: () => {},
      request: async path => {
        calls.push(path)
        if (gate) await gate
        if (offline) throw new Error('离线')
        return path.includes('/push') ? { applied: [], superseded: [] } : { changes: [], nextCursor: data.syncMeta.cursor + 1, hasMore: false }
      } },
    '../utils/sync-config.js': { LOCAL_WRITE_EVENT: 'local-write', SYNC_APPLIED_EVENT: 'sync-applied', MAX_PUSH_BYTES: 8 * 1024 * 1024, MAX_PUSH_CHANGES: 200 }
  }
  const module = new vm.SourceTextModule(await readFile(new URL('../src/api/sync.js', import.meta.url), 'utf8'), { context })
  await module.link(specifier => {
    const values = dependencies[specifier]
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
  return { api: module.namespace, calls, uni, listeners, timers, get data() { return data },
    edit() { data.syncMeta.outbox.task = { t1: 10 }; uni.$emit('local-write') },
    setOffline(value) { offline = value }, setGate(value) { gate = value }, setUnbound() { data.syncMeta.remoteUserId = null }, flush,
    async advance(ms) {
      const end = now + ms
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [id, timer] = next; now = timer.at
        if (timer.repeat) timer.at += timer.repeat; else timers.delete(id)
        timer.fn(); await flush()
      }
      now = end; await flush()
    } }
}

test('前台每分钟轮询拉取、本地写入防抖，并在停止后清除定时器与事件', async () => {
  const h = await autoSyncHarness(); let applied = 0
  const stop = h.api.startAutoSync(() => { applied++ })
  await h.advance(59999); assert.equal(h.calls.length, 0)
  await h.advance(1); assert.equal(h.calls.filter(path => path.includes('/pull')).length, 1)
  assert.equal(applied, 1)
  h.edit(); await h.advance(400); h.edit(); await h.advance(799)
  assert.equal(h.calls.filter(path => path.includes('/push')).length, 0)
  await h.advance(1); assert.equal(h.calls.filter(path => path.includes('/push')).length, 1)
  h.edit(); stop(); await h.advance(120000)
  assert.equal(h.calls.length, 3)
  assert.equal(h.timers.size, 0)
  assert.equal(h.listeners.get('local-write').size, 0)
  assert.equal(h.listeners.get('sync-applied').size, 0)
})

test('取消后未绑定且 outbox 非空时不循环重试', async () => {
  const h = await autoSyncHarness(); h.setUnbound()
  const stop = h.api.startAutoSync()
  h.edit(); await h.advance(5000)
  assert.equal(h.calls.length, 0); assert.equal(h.data.syncMeta.outbox.task.t1, 10)
  assert.equal(h.timers.size, 1); stop()
})

test('离线时保留 outbox、不加速重试，恢复后轮询补传', async () => {
  const h = await autoSyncHarness(); h.setOffline(true)
  const stop = h.api.startAutoSync()
  h.edit(); await h.advance(800)
  assert.equal(h.calls.length, 1); assert.equal(h.data.syncMeta.outbox.task.t1, 10)
  await h.advance(59199); assert.equal(h.calls.length, 1)
  await h.advance(1); assert.equal(h.calls.length, 2)
  assert.equal(h.data.syncMeta.outbox.task.t1, 10)
  h.setOffline(false); await h.advance(60000)
  assert.equal(h.calls.length, 4); assert.equal(h.data.syncMeta.outbox.task.t1, undefined)
  stop()
})

test('轮询期间写入会在请求完成后补传，重启前台只保留一组定时器', async () => {
  const h = await autoSyncHarness(); let release
  h.setGate(new Promise(resolve => { release = resolve }))
  let stop = h.api.startAutoSync()
  await h.advance(60000); h.edit(); await h.advance(800)
  assert.equal(h.calls.length, 1)
  h.setGate(null); release(); await h.flush(); await h.advance(800)
  assert.equal(h.calls.length, 3); assert.equal(h.data.syncMeta.outbox.task.t1, undefined)
  stop(); stop = h.api.startAutoSync(); assert.equal(h.timers.size, 1)
  await h.advance(60000); assert.equal(h.calls.length, 4)
  stop(); assert.equal(h.timers.size, 0)
})

test('轮询与写入重叠时不重入，失败后不因期间写入快速循环', async () => {
  const h = await autoSyncHarness(); let release
  h.setGate(new Promise(resolve => { release = resolve })); h.setOffline(true)
  const stop = h.api.startAutoSync()
  await h.advance(60000); assert.equal(h.calls.length, 1)
  h.edit(); await h.advance(120000); assert.equal(h.calls.length, 1)
  release(); await h.flush(); await h.advance(1000)
  assert.equal(h.calls.length, 1); assert.equal(h.data.syncMeta.outbox.task.t1, 10)
  h.setGate(null); h.setOffline(false); await h.advance(59000)
  assert.equal(h.calls.length, 3); assert.equal(h.data.syncMeta.outbox.task.t1, undefined)
  stop()
})

test('下拉控件防重入、反馈失败并在页面隐藏或重入后不跨页提示', async () => {
  let show, hide, unload, unmount, resolve, reject, calls = 0, reloads = 0, readable = true
  const messages = []
  const context = vm.createContext({ uni: { showModal: options => messages.push(`${options.title}：${options.content}`) } })
  const dependencies = {
    vue: { ref: value => ({ value }), nextTick: () => Promise.resolve(), onBeforeUnmount: fn => { unmount = fn } },
    '@dcloudio/uni-app': { onShow: fn => { show = fn }, onHide: fn => { hide = fn }, onUnload: fn => { unload = fn } },
    '../api/sync.js': { manualSync: () => { calls++; return new Promise((yes, no) => { resolve = yes; reject = no }) } },
    './platform.js': { toast: message => messages.push(message) }
  }
  const module = new vm.SourceTextModule(await readFile(new URL('../src/utils/pull-sync.js', import.meta.url), 'utf8'), { context })
  await module.link(specifier => {
    const values = dependencies[specifier]
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const { refresh, refreshing } = module.namespace.usePullSync(() => { reloads++; return readable })
  show(); const first = refresh(); assert.equal(refreshing.value, true)
  await refresh(); assert.equal(calls, 1)
  resolve(); await first; assert.equal(refreshing.value, false); assert.deepEqual(messages, ['同步完成']); assert.equal(reloads, 1)
  const waitCall = async count => { while (calls < count) await Promise.resolve() }
  const second = refresh(); await waitCall(2); reject(new Error('断网')); await second
  assert.match(messages.at(-1), /同步未完成：断网/); assert.equal(refreshing.value, false); assert.equal(reloads, 2)
  const third = refresh(); await waitCall(3); hide(); show(); resolve(); await third
  assert.equal(messages.length, 2); assert.equal(reloads, 2)
  const fourth = refresh(); await waitCall(4); unload(); reject(new Error('离线')); await fourth
  assert.equal(messages.length, 2); assert.equal(refreshing.value, false)
  show(); readable = false
  const fifth = refresh(); await waitCall(5); resolve(); await fifth
  assert.match(messages.at(-1), /同步已完成，但本机数据读取失败/); assert.equal(refreshing.value, false)
  unmount()
})

test('恢复演示数据依据账号状态提示影响范围并在确认时复核', async () => {
  const modals = [], messages = []
  let back
  const meta = { deviceId: 'd1', remoteUserId: null }
  let restores = 0
  const context = vm.createContext({ uni: { showModal: options => modals.push(options) } })
  const dependencies = {
    vue: { ref: value => ({ value }), onBeforeUnmount() {} },
    '@dcloudio/uni-app': { onShow: fn => fn(), onUnload() {}, onBackPress: fn => { back = fn } },
    '../../components/UpdateSheet.vue': { default: {} },
    '../../api/store': { getProfile: () => ({}), getSettings: () => ({}), setHideCompleted() {}, restoreDemoData: () => { restores++ }, listTasks: () => [] },
    '../../api/update': { checkUpdate() {}, downloadUpdate() {}, cancelDownload() {}, installDownloaded() {}, installedVersion: () => ({ version: '1.0.0' }), subscribeUpdate: () => () => {}, openUpdateInBrowser() {} },
    '../../api/reminders': { reminderState: () => ({}), reminderSummary() {}, subscribeReminderState: () => () => {}, syncTaskReminders() {} },
    '../../api/android': { androidSettings() {} },
    '../../utils/occurrence': { repeatLabel() {} },
    '../../utils/platform': { toast: message => messages.push(message) },
    '../../api/storage.js': { load: () => ({ syncMeta: meta }) }
  }
  const source = await readFile(new URL('../src/pages/profile/index.vue', import.meta.url), 'utf8')
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  const module = new vm.SourceTextModule(`${script}\nexport { restore, updateVisible, updateState }`, { context })
  await module.link(specifier => {
    const values = dependencies[specifier]
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  assert.equal(back(), false)
  module.namespace.updateVisible.value = true
  module.namespace.updateState.value = { status: 'downloading' }
  assert.equal(back(), true); assert.equal(module.namespace.updateVisible.value, true)
  module.namespace.updateState.value = { status: 'ready' }
  assert.equal(back(), true); assert.equal(module.namespace.updateVisible.value, false)
  module.namespace.restore(); module.namespace.restore()
  assert.equal(modals.length, 1); assert.match(modals[0].content, /以后绑定同步时.*可能上传到云端/)
  meta.remoteUserId = 'u1'; modals[0].success({ confirm: true }); modals[0].complete()
  assert.equal(restores, 0); assert.match(messages.at(-1), /账号状态已改变/)
  module.namespace.restore(); assert.match(modals[1].content, /云端及其他设备.*可能被删除/)
  modals[1].success({ confirm: false }); modals[1].complete(); assert.equal(restores, 0)
  module.namespace.restore(); modals[2].success({ confirm: true }); modals[2].complete()
  assert.equal(restores, 1); assert.equal(messages.at(-1), '已恢复')
})

async function accountHarness(origin = 'user', boundId = null, initialUpload = null) {
  const modals = []; const binds = []; const cancels = []; const syncCalls = []; const unbinds = []
  let syncFailure = null
  const context = vm.createContext({ uni: { showModal: options => modals.push(options), navigateBack() {}, switchTab() {} } })
  const meta = { dataOrigin: origin, remoteUserId: boundId, remoteUsername: 'alice', initialUpload, outbox: {} }
  const dependencies = {
    vue: { ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), onBeforeUnmount() {} },
    '@dcloudio/uni-app': { onShow: fn => fn(), onUnload() {} },
    '../../api/storage.js': { load: () => ({ syncMeta: meta }) },
    '../../utils/sync-config.js': { SYNC_BASE_URL: 'https://example.com' },
    '../../api/auth.js': { readAuth: () => ({ token: 'token' }) },
    '../../api/sync.js': { bindAccount: async options => { binds.push(options) }, manualSync: async () => { syncCalls.push(true); if (syncFailure) throw syncFailure }, unbindAccount: async () => { unbinds.push(true) }, cancelInitialUpload: async options => { cancels.push(options) },
      syncEngine: { getState: () => ({ status: 'idle' }), subscribe: fn => { fn({ status: 'idle' }); return () => {} } } }
  }
  const source = await readFile(new URL('../src/pages/account/index.vue', import.meta.url), 'utf8')
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  const module = new vm.SourceTextModule(`${script}\nexport { submit, cancelUpload, disconnect, manualSync, refresh, strategy, busy, error, syncNotice }`, { context })
  await module.link(specifier => {
    const values = dependencies[specifier]
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  return { api: module.namespace, modals, binds, cancels, syncCalls, unbinds, meta, source, failSync: error => { syncFailure = error } }
}

test('首次上传或合并前可取消，并按来源告知上传内容', async () => {
  for (const origin of ['seed', 'user', null]) for (const strategy of ['upload', 'merge']) {
    const h = await accountHarness(origin); h.api.strategy.value = strategy
    const pending = h.api.submit(); assert.equal(h.api.busy.value, true)
    await h.api.submit(); assert.equal(h.modals.length, 1)
    assert.match(h.modals[0].content, /上传本机事项、分类、纪念日和设置/)
    assert.equal(h.modals[0].content.includes('演示事项也会上传'), origin === 'seed')
    h.modals[0].success({ confirm: false }); await pending; assert.equal(h.binds.length, 0)
    const accepted = h.api.submit(); h.modals[1].success({ confirm: true }); await accepted
    assert.equal(h.binds.length, 1); assert.equal(h.binds[0].strategy, strategy)
  }
})

test('取消首次上传须二次确认并锁定原账号会话', async () => {
  const h = await accountHarness('user', null, { sessionId: 'session-1', userId: 'u1', username: 'alice' })
  assert.match(h.source, /取消首次上传，保留本机数据/)
  const first = h.api.cancelUpload(); assert.equal(h.api.busy.value, true)
  await h.api.cancelUpload(); assert.equal(h.modals.length, 1)
  assert.match(h.modals[0].content, /待同步记录都会保留/)
  h.modals[0].success({ confirm: false }); await first; assert.equal(h.cancels.length, 0)
  const next = h.api.cancelUpload()
  h.meta.initialUpload = { sessionId: 'other', userId: 'u2', username: 'bob' }
  h.modals[1].success({ confirm: true }); await next
  assert.deepEqual({ ...h.cancels[0] }, { sessionId: 'session-1', userId: 'u1' })
})

test('首次合并待恢复时页面锁定原账号并跳过首次选择确认', async () => {
  const h = await accountHarness()
  h.meta.initialMerge = { userId: 'u1', username: 'alice', deviceId: 'mobile' }
  h.api.strategy.value = 'remote'
  await h.api.submit()
  assert.equal(h.modals.length, 0)
  assert.equal(h.binds.length, 1)
  assert.equal(h.binds[0].mode, 'login')
  assert.match(h.source, /继续首次合并/)
  assert.match(h.source, /部分数据可能已上传/)
})

test('账号页手动同步展示失败和成功，也支持继续初始化', async () => {
  for (const initial of [null, { sessionId: 's1', userId: 'u1', username: 'alice' }]) {
    const h = await accountHarness('user', initial ? null : 'u1', initial)
    h.failSync(new Error('缺少登录凭证，请登录原账号后重试'))
    await h.api.manualSync()
    assert.match(h.api.error.value, /缺少登录凭证/)
    assert.equal(h.api.syncNotice.value, '')
    h.failSync(null); await h.api.manualSync()
    assert.equal(h.syncCalls.length, 2)
    assert.equal(h.api.error.value, '')
    assert.equal(h.api.syncNotice.value, '同步完成')
  }
})

test('解绑确认期间防重入，账号改变后不执行解绑', async () => {
  const h = await accountHarness('user', 'u1')
  const first = h.api.disconnect(); assert.equal(h.api.busy.value, true)
  await h.api.disconnect(); assert.equal(h.modals.length, 1)
  h.modals[0].success({ confirm: false }); await first; assert.equal(h.unbinds.length, 0)
  const second = h.api.disconnect(); h.meta.remoteUserId = 'u2'
  h.modals[1].success({ confirm: true }); await second
  assert.equal(h.unbinds.length, 0); assert.match(h.api.error.value, /账号状态已改变/)
  const third = h.api.disconnect(); h.modals[2].success({ confirm: true }); await third
  assert.equal(h.unbinds.length, 1)
})

test('远端替换仍需确认，已绑定重新登录不显示首次上传提示', async () => {
  const remote = await accountHarness('seed'); const pending = remote.api.submit()
  assert.match(remote.modals[0].content, /替换本机/)
  remote.modals[0].success({ confirm: false }); await pending; assert.equal(remote.binds.length, 0)
  const reauth = await accountHarness('user', 'u1'); reauth.api.strategy.value = 'merge'
  await reauth.api.submit(); assert.equal(reauth.modals.length, 0); assert.equal(reauth.binds.length, 1)
})
