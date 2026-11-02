import { todayString } from '../utils/date.js'
import { captureChanges, cloneData, entityCollections, entityId, sameData } from './sync-outbox.js'

const STORAGE_KEY = 'sui-time-mobile:v2'
const LEGACY_STORAGE_KEY = 'sui-time-mobile:v1'

// 种子数据对齐原型演示语义，字段对齐生产 types.ts
function seedData() {
  const today = todayString()
  return {
    profile: { name: '暴走的小陌', phone: '182****9035', signature: '暴走方知深浅' },
    settings: { hideCompleted: true, hideCompletedByView: { tasks: true, month: true }, collapsedGroups: [] },
    anniversaries: [],
    anniversaryRecords: [],
    categories: [
      { id: 'work', name: '工作', color: '#7299d5', icon: 'monitor', sortOrder: 0 },
      { id: 'growth', name: '自增', color: '#12bd75', icon: 'bookmark', sortOrder: 1 },
      { id: 'life', name: '生活', color: '#ff8545', icon: 'flower', sortOrder: 2 }
    ],
    tasks: [
      { id: 't1', title: '一体化门户集成', categoryId: 'growth', plannedDate: today, plannedTime: null, scheduleKind: 'all_day', priority: 'urgent_not_important', repeatRule: '{"kind":"none"}', parentTaskId: null, status: 'todo', notes: '', createdAt: Date.now(), updatedAt: Date.now() },
      { id: 't2', title: '采购实施方案后续字段维护', categoryId: 'work', plannedDate: today, plannedTime: null, scheduleKind: 'all_day', priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', parentTaskId: null, status: 'todo', notes: '', createdAt: Date.now(), updatedAt: Date.now() },
      { id: 't3', title: '软考-系统架构师', categoryId: 'growth', plannedDate: today, plannedTime: null, scheduleKind: 'all_day', priority: 'urgent_not_important', repeatRule: '{"kind":"none"}', parentTaskId: null, status: 'todo', notes: '', createdAt: Date.now(), updatedAt: Date.now() },
      { id: 't4', title: '房租', categoryId: 'life', plannedDate: today, plannedTime: '08:00', scheduleKind: 'point', priority: 'urgent_important', repeatRule: '{"kind":"monthly"}', parentTaskId: null, status: 'todo', notes: '', createdAt: Date.now(), updatedAt: Date.now() },
      { id: 't5', title: '工时、周报', categoryId: 'work', plannedDate: today, plannedTime: '19:00', scheduleKind: 'point', priority: 'not_urgent_not_important', repeatRule: '{"kind":"weekly"}', parentTaskId: null, status: 'todo', notes: '', createdAt: Date.now(), updatedAt: Date.now() },
      { id: 't6', title: '小敏敏33岁生日', categoryId: 'life', plannedDate: today, plannedTime: null, scheduleKind: 'all_day', priority: 'urgent_important', repeatRule: '{"kind":"yearly"}', parentTaskId: null, status: 'done', notes: '', createdAt: Date.now(), updatedAt: Date.now() }
    ]
  }
}

let cache = null
let committed = null
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
const newDeviceId = () => globalThis.crypto?.randomUUID?.() || `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`

function normalizeData(raw, origin = 'user') {
  if (!isObject(raw) || !Array.isArray(raw.categories) || !Array.isArray(raw.tasks)
    || (raw.settings !== undefined && !isObject(raw.settings))
    || (raw.syncMeta !== undefined && !isObject(raw.syncMeta))
    || (raw.version !== undefined && ![1, 2].includes(raw.version))) {
    throw new Error('本机数据已损坏，请保留数据并重试')
  }
  const sourceMeta = raw.syncMeta || committed?.syncMeta || {}
  // 凭据由账号模块独立保存，syncMeta 只接收这些白名单字段。
  const syncMeta = {
    deviceId: sourceMeta.deviceId || committed?.syncMeta.deviceId || newDeviceId(),
    cursor: sourceMeta.cursor ?? 0,
    lastSyncAt: sourceMeta.lastSyncAt ?? null,
    remoteUserId: sourceMeta.remoteUserId ?? null,
    remoteUsername: sourceMeta.remoteUsername ?? null,
    outbox: sourceMeta.outbox ?? {},
    dataOrigin: sourceMeta.dataOrigin ?? origin
  }
  if (typeof syncMeta.deviceId !== 'string' || !syncMeta.deviceId.trim()
    || !Number.isSafeInteger(syncMeta.cursor) || syncMeta.cursor < 0
    || (syncMeta.lastSyncAt !== null && (!Number.isFinite(syncMeta.lastSyncAt) || syncMeta.lastSyncAt < 0))
    || ![null, 'string'].includes(syncMeta.remoteUserId === null ? null : typeof syncMeta.remoteUserId)
    || ![null, 'string'].includes(syncMeta.remoteUsername === null ? null : typeof syncMeta.remoteUsername)
    || !['seed', 'user'].includes(syncMeta.dataOrigin)
    || !isObject(syncMeta.outbox)
    || Object.entries(syncMeta.outbox).some(([entity, entries]) => ![...Object.values(entityCollections), 'setting'].includes(entity)
      || !isObject(entries) || Object.entries(entries).some(([id, version]) => !id || !Number.isSafeInteger(version) || version <= 0))) {
    throw new Error('本机同步数据已损坏，请保留数据并重试')
  }
  const data = { ...raw, version: 2, syncMeta }
  delete data.token
  delete data.accessToken
  delete data.refreshToken
  for (const collection of Object.keys(entityCollections)) {
    const items = raw[collection] === undefined ? [] : raw[collection]
    if (!Array.isArray(items)) throw new Error('本机数据已损坏，请保留数据并重试')
    const ids = new Set()
    data[collection] = items.map(item => {
      if (!isObject(item)) throw new Error('本机数据已损坏，请保留数据并重试')
      const id = entityId(collection, item)
      if (typeof id !== 'string' || !id || ids.has(id)
        || (collection === 'anniversaryRecords' && (!item.anniversaryId || !item.date))
        || (item.deletedAt != null && (!Number.isFinite(item.deletedAt) || item.deletedAt < 0))) {
        throw new Error('本机数据已损坏，请保留数据并重试')
      }
      ids.add(id)
      return { ...item, deletedAt: item.deletedAt ?? null, deviceId: item.deviceId || syncMeta.deviceId }
    })
  }
  const settings = { hideCompleted: true, collapsedGroups: [], ...raw.settings }
  const legacyHide = typeof settings.hideCompleted === 'boolean' ? settings.hideCompleted : true
  const byView = isObject(settings.hideCompletedByView) ? settings.hideCompletedByView : {}
  settings.hideCompletedByView = { ...byView }
  for (const view of ['tasks', 'month']) {
    settings.hideCompletedByView[view] = typeof byView[view] === 'boolean' ? byView[view] : legacyHide
  }
  data.settings = settings
  return cloneData(data)
}

export function load() {
  if (cache) return cache
  let raw
  let fromLegacy = false
  try {
    // #ifdef H5
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    // #endif
    raw = uni.getStorageSync(STORAGE_KEY)
    // #ifdef H5
    if (stored !== null && (raw === undefined || raw === null || raw === '')) throw new Error('读取失败')
    // #endif
    if (raw === undefined || raw === null || raw === '') {
      raw = uni.getStorageSync(LEGACY_STORAGE_KEY)
      fromLegacy = raw !== undefined && raw !== null && raw !== ''
      // #ifdef H5
      const legacyStored = typeof window !== 'undefined' ? window.localStorage.getItem(LEGACY_STORAGE_KEY) : null
      if (legacyStored !== null && (raw === undefined || raw === null || raw === '')) throw new Error('读取失败')
      // #endif
    }
  } catch {
    throw new Error('无法读取本机数据，请稍后重试')
  }
  if (raw === undefined || raw === null || raw === '') {
    const data = normalizeData(seedData(), 'seed')
    save(data, { strict: true, remote: true, message: '无法初始化本机数据，请检查存储空间后重试' })
    return cache
  }
  // 兼容 H5 存储包装；非空坏数据不能被演示数据覆盖。
  if (raw && typeof raw === 'object' && raw.data && !raw.categories && !raw.tasks) raw = raw.data
  const data = normalizeData(raw)
  if (fromLegacy || raw.version !== 2) {
    save(data, { strict: true, remote: true, message: '无法升级本机数据，请检查存储空间后重试' })
  } else {
    cache = data
    committed = cloneData(data)
  }
  return cache
}

export function save(data, { strict = false, remote = false, message = '无法保存纪念日，存储空间可能不足，请减少照片后重试' } = {}) {
  let localWrite = false
  try {
    // 即使调用方原地修改了 load() 的结果，也始终与上次成功落盘的快照比较。
    if (!committed && !remote) load()
    const candidate = normalizeData(data)
    if (!remote) {
      candidate.syncMeta = { ...cloneData(committed.syncMeta) }
      localWrite = captureChanges(committed, candidate, Date.now())
    }
    uni.setStorageSync(STORAGE_KEY, candidate)
    committed = cloneData(candidate)
    // 保持原有 save 后 load() 返回传入对象的兼容行为。
    delete data.token
    delete data.accessToken
    delete data.refreshToken
    Object.assign(data, candidate)
    cache = data
  } catch (e) {
    if (committed && !sameData(cache, committed)) cache = cloneData(committed)
    if (strict) throw new Error(message)
    return false
  }
  // 监听器异常不能把已经成功的落盘误报成失败。
  if (localWrite) {
    try { uni.$emit?.('local-write') } catch { /* 本地数据已经落盘，下一次同步仍可读取 outbox。 */ }
  }
  return true
}

export function reset() {
  const data = load()
  // 已有实体仍通过统一入口生成墓碑；恢复演示属于用户主动写入。
  return save({ ...seedData(), syncMeta: { ...data.syncMeta, dataOrigin: 'user' } }, { strict: true, message: '无法恢复演示数据，请检查存储空间' })
}

export function persist() {
  return save(load())
}
