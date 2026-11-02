import { load, save } from './storage.js'
import { syncSettings, applySyncSetting } from './sync-outbox.js'
import { authenticate, readAuth, writeAuth, request, revokeAuth } from './auth.js'
import { LOCAL_WRITE_EVENT, SYNC_APPLIED_EVENT, MAX_PUSH_BYTES, MAX_PUSH_CHANGES } from '../utils/sync-config.js'

const COLLECTIONS = { category: 'categories', task: 'tasks', anniversary: 'anniversaries', anniversary_record: 'anniversaryRecords' }
const clone = value => JSON.parse(JSON.stringify(value))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const recordId = item => `${item.anniversaryId}@${item.date}`

export function entityValue(data, entity, id) {
  if (entity === 'setting') return syncSettings(data)[id]
  const collection = COLLECTIONS[entity]
  return collection ? data[collection]?.find(item => (entity === 'anniversary_record' ? recordId(item) : item.id) === id) : undefined
}

function businessData(data) {
  return Object.fromEntries([...Object.values(COLLECTIONS), 'settings', 'profile'].map(key => [key, data[key]]))
}

function ensureMeta(data) {
  data.syncMeta = { deviceId: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`, cursor: 0,
    lastSyncAt: null, remoteUserId: null, remoteUsername: null, outbox: {}, dataOrigin: 'user', ...data.syncMeta }
  return data.syncMeta
}

function tombstone(entity, id) {
  if (entity === 'category') return { name: '已删除', color: '#999999' }
  if (entity === 'task') return { title: '已删除', status: 'todo' }
  if (entity === 'anniversary') return { title: '已删除', kind: 'anniversary', date: '1970-01-01' }
  if (entity === 'anniversary_record') {
    const at = id.lastIndexOf('@')
    return { anniversaryId: id.slice(0, at), date: id.slice(at + 1), title: '已删除', kind: 'anniversary', originalDate: '1970-01-01' }
  }
  return { value: null }
}

function outgoing(data) {
  const changes = []
  const meta = ensureMeta(data)
  for (const [entity, entries] of Object.entries(meta.outbox)) {
    if (!COLLECTIONS[entity] && entity !== 'setting') throw new Error(`未知待同步实体：${entity}`)
    for (const [id, updatedAt] of Object.entries(entries)) {
      if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) throw new Error('待同步版本无效，请保留本机数据')
      const value = entityValue(data, entity, id)
      changes.push({ entity, id, updatedAt, deletedAt: value === undefined || (entity === 'setting' && value === null) ? updatedAt : value.deletedAt ?? null, deviceId: entity === 'setting' ? meta.deviceId : value?.deviceId || meta.deviceId,
        data: value === undefined ? tombstone(entity, id) : entity === 'setting' ? { value } : value })
    }
  }
  return changes
}

const byteLength = value => {
  const text = JSON.stringify(value)
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

export function pushBatches(changes, deviceId, requireEmpty = false) {
  const batches = []
  let batch = []
  let bytes = byteLength({ deviceId, requireEmpty, changes: [] })
  for (const change of changes) {
    const size = byteLength(change) + (batch.length ? 1 : 0)
    if (byteLength({ deviceId, requireEmpty, changes: [change] }) > MAX_PUSH_BYTES) throw new Error('单条数据超过 8MB，请减少照片后重试')
    if (batch.length && (batch.length >= MAX_PUSH_CHANGES || bytes + size > MAX_PUSH_BYTES)) {
      batches.push(batch); batch = []; bytes = byteLength({ deviceId, requireEmpty, changes: [] })
    }
    batch.push(change); bytes += byteLength(change) + (batch.length > 1 ? 1 : 0)
  }
  if (batch.length || requireEmpty) batches.push(batch)
  return batches
}

function applyChange(data, change) {
  const { entity, id, deletedAt, updatedAt, deviceId } = change
  if (entity === 'setting') {
    applySyncSetting(data, id, change.data.value, deletedAt != null)
    return
  }
  const key = COLLECTIONS[entity]
  if (!key) throw new Error('远端实体类型无效')
  const items = data[key] || []
  const index = items.findIndex(item => (entity === 'anniversary_record' ? recordId(item) : item.id) === id)
  const value = { ...clone(change.data), id, updatedAt, deviceId, deletedAt: deletedAt ?? null }
  if (entity === 'anniversary_record' && recordId(value) !== id) throw new Error('远端纪念记录标识无效')
  if (index >= 0) items[index] = value
  else items.push(value)
  data[key] = items
}

export function createSyncEngine(deps) {
  const { load: readData, save, readAuth, writeAuth, request, authenticate, revokeAuth, emit = () => {} } = deps
  const load = () => clone(readData())
  let flight = null
  let state = { status: 'idle', error: '' }
  const listeners = new Set()
  const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener({ ...state }) }
  const persist = data => save(data, { remote: true, strict: true })
  function deviceId() {
    const data = load()
    const missing = !data.syncMeta?.deviceId
    const meta = ensureMeta(data)
    if (missing) persist(data)
    return meta.deviceId
  }
  function singleFlight(operation, kind = 'sync') {
    if (flight) return kind === 'sync' ? flight : Promise.reject(new Error('正在同步，请稍后重试'))
    publish({ status: 'syncing', error: '' })
    flight = Promise.resolve().then(operation).then(result => {
      publish({ status: readAuth()?.token ? 'idle' : 'unbound', error: '' })
      return result
    }).catch(error => {
      publish({ status: error.status === 401 ? 'needsReauth' : 'error', error: error.message || String(error) })
      throw error
    }).finally(() => { flight = null })
    return flight
  }
  async function pull(auth, cursor) {
    const changes = []
    for (;;) {
      const page = await request(`/api/v1/sui-time/sync/pull?cursor=${cursor}&limit=500`, { auth })
      if (!Array.isArray(page?.changes) || !Number.isSafeInteger(page.nextCursor) || page.nextCursor < cursor
        || typeof page.hasMore !== 'boolean' || (page.hasMore && page.nextCursor <= cursor)) throw new Error('远端同步分页无效')
      for (const item of page.changes) {
        if (!item || typeof item.id !== 'string' || !Number.isSafeInteger(item.updatedAt) || item.updatedAt <= 0
          || !item.data || typeof item.data !== 'object' || (!COLLECTIONS[item.entity] && item.entity !== 'setting')) throw new Error('远端变更格式无效')
      }
      changes.push(...page.changes)
      cursor = page.nextCursor
      if (!page.hasMore) return { changes, cursor }
    }
  }
  async function exchange(auth, requireEmpty = false) {
    const snapshot = load()
    const meta = ensureMeta(snapshot)
    if (meta.remoteUserId !== auth.user.id) throw new Error('登录账号与绑定账号不一致，请先解绑')
    const changes = outgoing(snapshot)
    const superseded = []
    const batches = pushBatches(changes, meta.deviceId, requireEmpty)
    for (let index = 0; index < batches.length; index++) {
      const result = await request('/api/v1/sui-time/sync/push', { method: 'POST', auth,
        data: { deviceId: meta.deviceId, requireEmpty: requireEmpty && index === 0, changes: batches[index] } })
      if (!Array.isArray(result?.superseded) || !Array.isArray(result?.applied)) throw new Error('远端上传响应无效')
      superseded.push(...result.superseded.map(item => item.server))
    }
    const remote = await pull(auth, meta.cursor)
    const latest = load()
    const latestMeta = ensureMeta(latest)
    if (latestMeta.remoteUserId !== auth.user.id || readAuth()?.token !== auth.token) throw new Error('同步账号已改变，请重试')
    // 只有请求快照仍匹配的队列项才能出队；网络期间编辑的同一实体保持待上传。
    const protectedKeys = new Set()
    for (const [entity, entries] of Object.entries(latestMeta.outbox)) {
      for (const [id, version] of Object.entries(entries)) {
        if (meta.outbox[entity]?.[id] !== version || !same(entityValue(snapshot, entity, id), entityValue(latest, entity, id))) protectedKeys.add(`${entity}|${id}`)
      }
    }
    for (const change of changes) {
      if (!protectedKeys.has(`${change.entity}|${change.id}`)) delete latestMeta.outbox[change.entity]?.[change.id]
    }
    const incoming = new Map()
    for (const change of [...remote.changes, ...superseded]) {
      const key = `${change.entity}|${change.id}`
      const old = incoming.get(key)
      if (!old || change.updatedAt > old.updatedAt || (change.updatedAt === old.updatedAt && change.deviceId > old.deviceId)) incoming.set(key, change)
    }
    for (const [key, change] of incoming) if (!protectedKeys.has(key)) applyChange(latest, change)
    latestMeta.cursor = remote.cursor
    latestMeta.lastSyncAt = Date.now()
    persist(latest)
    emit(SYNC_APPLIED_EVENT)
    return latestMeta
  }
  function syncNow() {
    return singleFlight(() => {
      const auth = readAuth()
      if (!auth?.token) return null
      return exchange(auth)
    })
  }
  function bind({ mode = 'login', username, password, strategy = 'remote' }) {
    return singleFlight(async () => {
      if (!['upload', 'merge', 'remote'].includes(strategy)) throw new Error('请选择有效的数据绑定方式')
      const id = deviceId()
      const auth = await authenticate(mode, username, password, id)
      const snapshot = load()
      const meta = ensureMeta(snapshot)
      if (meta.remoteUserId && meta.remoteUserId !== auth.user.id) throw new Error('请先解绑当前账号后再切换账号')
      if (meta.remoteUserId === auth.user.id) {
        writeAuth(auth)
        return exchange(auth)
      }
      if (strategy === 'remote') {
        const remote = await pull(auth, 0)
        const latest = load()
        if (!same(businessData(snapshot), businessData(latest)) || !same(meta.outbox, latest.syncMeta?.outbox)) throw new Error('拉取期间本机数据已修改，请重新选择绑定方式')
        const replacement = { ...latest, categories: [], tasks: [], anniversaries: [], anniversaryRecords: [],
          settings: { hideCompleted: true, hideCompletedByView: { tasks: true, month: true }, collapsedGroups: [] },
          profile: { name: auth.user.username, phone: '', signature: '' } }
        for (const change of remote.changes) applyChange(replacement, change)
        replacement.syncMeta = { ...ensureMeta(latest), remoteUserId: auth.user.id, remoteUsername: auth.user.username,
          cursor: remote.cursor, lastSyncAt: Date.now(), outbox: {}, dataOrigin: 'user' }
        // 凭证单独存储；业务保存失败时恢复旧凭证。
        const previous = readAuth()
        writeAuth(auth)
        try { persist(replacement) } catch (error) { writeAuth(previous); throw error }
        emit(SYNC_APPLIED_EVENT)
        return replacement.syncMeta
      }
      if (strategy === 'upload') {
        const remote = await request('/api/v1/sui-time/sync/state', { auth })
        if (remote?.remoteEmpty !== true) throw new Error('云端已有数据，请选择合并或以云端为准')
      }
      const latest = load()
      const latestMeta = ensureMeta(latest)
      latestMeta.remoteUserId = auth.user.id
      latestMeta.remoteUsername = auth.user.username
      latestMeta.cursor = 0
      latestMeta.dataOrigin = 'user'
      const now = Date.now()
      for (const [entity, key] of Object.entries(COLLECTIONS)) {
        latestMeta.outbox[entity] ||= {}
        for (const item of latest[key] || []) {
          const itemId = entity === 'anniversary_record' ? recordId(item) : item.id
          latestMeta.outbox[entity][itemId] ||= item.updatedAt || item.createdAt || now
        }
      }
      latestMeta.outbox.setting ||= {}
      for (const key of Object.keys(syncSettings(latest))) latestMeta.outbox.setting[key] ||= now
      const previous = readAuth()
      writeAuth(auth)
      try { persist(latest) } catch (error) { writeAuth(previous); throw error }
      try { return await exchange(auth, strategy === 'upload') } catch (error) {
        if (strategy === 'upload' && error.code === 'remote_not_empty') {
          // state 检查后仍可能被其他设备抢先写入，服务端拒绝时恢复未绑定状态。
          const current = load()
          Object.assign(ensureMeta(current), { remoteUserId: null, remoteUsername: null, cursor: 0, lastSyncAt: null })
          persist(current)
          writeAuth(previous)
        }
        throw error
      }
    }, 'bind')
  }
  function unbind() {
    return singleFlight(async () => {
      const old = readAuth()
      const data = load()
      const meta = ensureMeta(data)
      Object.assign(meta, { remoteUserId: null, remoteUsername: null, cursor: 0, lastSyncAt: null })
      persist(data)
      writeAuth(null)
      publish({ status: 'unbound' })
      try { await revokeAuth(old) } catch { /* 离线解绑仍保留本地数据并清除本机凭证。 */ }
    }, 'unbind')
  }
  return { deviceId, syncNow, bind, unbind, getState: () => ({ ...state }),
    subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener) } }
}

export const syncEngine = createSyncEngine({ load, save, readAuth, writeAuth, request, authenticate, revokeAuth,
  emit: event => uni.$emit(event) })
export const syncNow = () => syncEngine.syncNow()
export const bindAccount = options => syncEngine.bind(options)
export const unbindAccount = () => syncEngine.unbind()

export function startAutoSync(onApplied = () => {}) {
  let timer = null
  let active = true
  let dirty = false
  let running = false
  async function drain() {
    if (!active || running) return
    running = true
    dirty = false
    try {
      await syncNow()
      // 可能加入了 onShow 已开始的请求；检查剩余队列，补传该快照之后的编辑。
      if (readAuth()?.token && Object.values(load().syncMeta?.outbox || {}).some(entries => Object.keys(entries).length)) dirty = true
    } catch { /* 状态保留错误，手动入口可重试。 */ }
    finally {
      running = false
      if (active && dirty) { clearTimeout(timer); timer = setTimeout(drain, 800) }
    }
  }
  const onWrite = () => { dirty = true; clearTimeout(timer); timer = setTimeout(drain, 800) }
  uni.$on(LOCAL_WRITE_EVENT, onWrite)
  uni.$on(SYNC_APPLIED_EVENT, onApplied)
  return () => { active = false; clearTimeout(timer); uni.$off(LOCAL_WRITE_EVENT, onWrite); uni.$off(SYNC_APPLIED_EVENT, onApplied) }
}
