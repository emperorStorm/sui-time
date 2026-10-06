import { test } from 'node:test'
import assert from 'node:assert/strict'

test('旧存储升级保留原数据，存储失败不会更改缓存或误报成功', async () => {
  const original = { profile: { name: '原用户' }, categories: [{ id: 'work' }], tasks: [{ id: 'task' }], settings: { hideCompleted: true } }
  let stored = structuredClone(original)
  let failWrites = false
  globalThis.uni = {
    getStorageSync: () => structuredClone(stored),
    setStorageSync: (_key, value) => { if (failWrites) throw new Error('quota'); stored = structuredClone(value) }
  }
  const { load, save } = await import('./storage.js')
  assert.deepEqual(load().anniversaries, [])
  assert.deepEqual(load().anniversaryRecords, [])
  assert.deepEqual(load().tasks, original.tasks)
  const candidate = { ...load(), anniversaries: [{ id: 'new' }] }
  failWrites = true
  assert.throws(() => save(candidate, { strict: true }), /无法保存/)
  assert.deepEqual(load().anniversaries, [])
  assert.equal(stored.anniversaries, undefined)
  failWrites = false
  save(candidate, { strict: true })
  assert.equal(load().anniversaries[0].id, 'new')
  assert.deepEqual(stored.profile, original.profile)
  assert.deepEqual(stored.tasks, original.tasks)
  assert.deepEqual(stored.categories, original.categories)
  const recordsCandidate = { ...load(), anniversaryRecords: [{ anniversaryId: 'new', date: '2020-01-01', notes: '回忆' }] }
  failWrites = true
  assert.throws(() => save(recordsCandidate, { strict: true }), /无法保存/)
  assert.deepEqual(load().anniversaryRecords, [])
  failWrites = false
  save(recordsCandidate, { strict: true })
  assert.equal(load().anniversaryRecords[0].notes, '回忆')
  delete globalThis.uni
})
