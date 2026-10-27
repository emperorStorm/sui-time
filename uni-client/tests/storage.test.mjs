import { test } from 'node:test'
import assert from 'node:assert/strict'

let revision = 0
const freshStorage = () => import(`../src/api/storage.js?test=${++revision}`)
const validData = (patch = {}) => ({ categories: [], tasks: [], ...patch })

test('只有首次空存储初始化，失败可重试且不提交缓存', async () => {
  for (const empty of [undefined, null, '']) {
    const storage = await freshStorage()
    let writes = 0
    let fail = true
    let disk = empty
    globalThis.uni = {
      getStorageSync: () => disk,
      setStorageSync: (_, value) => { writes++; if (fail) throw Error('写入失败'); disk = structuredClone(value) }
    }
    assert.throws(() => storage.load(), /无法初始化/)
    fail = false
    const data = storage.load()
    assert.equal(writes, 2)
    assert.ok(data.tasks.length > 0)
    assert.equal(storage.load(), data)
    assert.equal(writes, 2)
  }
})

test('读取异常和非空坏数据抛业务错误，不覆盖磁盘，也不缓存种子', async () => {
  for (const raw of [false, 0, '损坏', {}, [], { categories: [], tasks: {} }, validData({ settings: null }), validData({ tasks: [null] })]) {
    const storage = await freshStorage()
    let writes = 0
    globalThis.uni = { getStorageSync: () => raw, setStorageSync: () => { writes++ } }
    assert.throws(() => storage.load(), /数据已损坏/)
    assert.equal(writes, 0)
    globalThis.uni.getStorageSync = () => validData()
    assert.deepEqual(storage.load().tasks, [])
  }
  const storage = await freshStorage()
  let writes = 0
  globalThis.uni = { getStorageSync: () => { throw Error('读取失败') }, setStorageSync: () => { writes++ } }
  assert.throws(() => storage.load(), /无法读取/)
  assert.equal(writes, 0)
})

test('旧数据补设置默认值、保留未知及超长旧字段，兼容 H5 包装且不写盘', async () => {
  for (const wrapped of [false, true]) {
    const storage = await freshStorage()
    const raw = validData({ settings: { custom: 42, hideCompleted: false }, extra: { keep: true }, tasks: [{ id: 'old', title: '长'.repeat(121), notes: '旧'.repeat(1001) }] })
    const before = structuredClone(raw)
    globalThis.uni = { getStorageSync: () => wrapped ? { type: 'object', data: raw } : raw, setStorageSync: () => assert.fail('旧数据读取不应写盘') }
    const data = storage.load()
    assert.deepEqual(data.settings, { hideCompleted: false, collapsedGroups: [], custom: 42 })
    assert.deepEqual(data.extra, { keep: true })
    assert.equal(data.tasks[0].title.length, 121)
    assert.equal(data.tasks[0].notes.length, 1001)
    assert.deepEqual(raw, before)
  }
  const storage = await freshStorage()
  globalThis.uni = { getStorageSync: () => validData(), setStorageSync: () => {} }
  assert.deepEqual(storage.load().settings, { hideCompleted: true, collapsedGroups: [] })
})

test('H5 同步读取吞错返回空值时不将已有数据当作首次启动', async () => {
  const storage = await freshStorage()
  let writes = 0
  globalThis.uni = { getStorageSync: () => '', setStorageSync: () => { writes++ } }
  globalThis.window = { localStorage: { getItem: () => '{已有原始数据}' } }
  try {
    assert.throws(() => storage.load(), /无法读取/)
    assert.equal(writes, 0)
    globalThis.window.localStorage.getItem = () => { throw new Error('禁止读取') }
    assert.throws(() => storage.load(), /无法读取/)
    assert.equal(writes, 0)
    globalThis.window.localStorage.getItem = () => null
    assert.ok(storage.load().tasks.length > 0)
    assert.equal(writes, 1)
  } finally { delete globalThis.window }
})

test('严格写入成功才替换缓存，写入失败保留旧缓存', async () => {
  const storage = await freshStorage()
  let disk = validData()
  let fail = false
  globalThis.uni = { getStorageSync: () => disk, setStorageSync: (_, value) => { if (fail) throw Error('写入失败'); disk = structuredClone(value) } }
  const before = storage.load()
  fail = true
  assert.throws(() => storage.save({ ...before, tasks: [{ id: 'new' }] }, { strict: true, message: '严格保存失败' }), /严格保存失败/)
  assert.equal(storage.load(), before)
  assert.deepEqual(disk.tasks, [])
  fail = false
  const next = { ...before, settings: { ...before.settings, custom: true } }
  storage.save(next, { strict: true })
  assert.equal(storage.load(), next)
  assert.equal(disk.settings.custom, true)
})
