import { load, save } from './storage.js'
import { syncSettings, applySyncSetting } from './sync-outbox.js'
import { authenticate, readAuth, writeAuth, request, revokeAuth } from './auth.js'
import { LOCAL_WRITE_EVENT, SYNC_APPLIED_EVENT, MAX_PUSH_BYTES, MAX_PUSH_CHANGES } from '../utils/sync-config.js'

const COLLECTIONS = { category: 'categories', task: 'tasks', anniversary: 'anniversaries', anniversary_record: 'anniversaryRecords' }
const MAX_INITIAL_BATCHES = 1000
const MAX_INITIAL_BYTES = 256 * 1024 * 1024
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
  const meta = data.syncMeta || ensureMeta(data)
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

export function initialBatches(changes, sessionId, deviceId) {
  const batches = []
  let batch = []
  let bytes = byteLength({ sessionId, deviceId, index: 0, changes: [] })
  for (const change of changes) {
    const size = byteLength(change)
    const emptySize = byteLength({ sessionId, deviceId, index: batches.length, changes: [] })
    if (emptySize + size > MAX_PUSH_BYTES) throw new Error('单条数据超过 8MB，请减少照片后重试')
    if (batch.length && (batch.length >= MAX_PUSH_CHANGES || bytes + size + 1 > MAX_PUSH_BYTES)) {
      batches.push(batch)
      batch = []
      bytes = byteLength({ sessionId, deviceId, index: batches.length, changes: [] })
      if (bytes + size > MAX_PUSH_BYTES) throw new Error('单条数据超过 8MB，请减少照片后重试')
    }
    bytes += size + (batch.length ? 1 : 0)
    batch.push(change)
  }
  // 空快照也发送一个空批次，避免把零批次当成已完成。
  batches.push(batch)
  if (batches.length > MAX_INITIAL_BATCHES || batches.reduce((total, item) => total + byteLength(item), 0) > MAX_INITIAL_BYTES) {
    throw new Error('本机数据超过首次上传上限（1000 批或 256 MiB），请减少数据后重试')
  }
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
  function prepareInitialUpload(auth) {
    const data = load()
    const meta = ensureMeta(data)
    const now = Date.now()
    for (const [entity, key] of Object.entries(COLLECTIONS)) {
      meta.outbox[entity] ||= {}
      for (const item of data[key] || []) {
        const id = entity === 'anniversary_record' ? recordId(item) : item.id
        if (!Object.hasOwn(meta.outbox[entity], id)) Object.defineProperty(meta.outbox[entity], id, { value: item.updatedAt || item.createdAt || now, enumerable: true, writable: true, configurable: true })
      }
    }
    meta.outbox.setting ||= {}
    for (const key of Object.keys(syncSettings(data))) meta.outbox.setting[key] ||= now
    const sessionId = globalThis.crypto?.randomUUID?.() || `init-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
    const changes = outgoing(data).sort((a, b) => a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const session = { sessionId, deviceId: meta.deviceId, userId: auth.user.id, username: auth.user.username,
      batches: initialBatches(changes, sessionId, meta.deviceId) }
    data.syncMeta.initialUpload = session
    persist(data)
    return session
  }
  function initialIdentity(session) {
    if (!session || typeof session.sessionId !== 'string' || !session.sessionId || typeof session.deviceId !== 'string' || !session.deviceId
      || !Array.isArray(session.batches) || !session.batches.length || session.batches.length > MAX_INITIAL_BATCHES) {
      throw new Error('首次上传会话无效，请保留本机数据')
    }
    return { sessionId: session.sessionId, deviceId: session.deviceId }
  }
  function initialStatus(result, session, requireReceived = true) {
    if (result?.sessionId !== session.sessionId || result.batchCount !== session.batches.length
      || !['active', 'expired', 'cancelled', 'completed'].includes(result.status)
      || (requireReceived && (!Array.isArray(result.received)
      || result.received.some(index => !Number.isSafeInteger(index) || index < 0 || index >= session.batches.length)
      || new Set(result.received).size !== result.received.length
      || (result.status === 'completed' && result.received.length !== session.batches.length)))) {
      throw new Error('首次上传会话响应无效，请保留本机数据并重试')
    }
    return result
  }
  async function resumeInitialUpload(auth, session) {
    if (session.userId !== auth.user.id) throw new Error('首次上传尚未完成，请登录原账号继续')
    const identity = initialIdentity(session)
    const keys = new Set()
    if (!Array.isArray(session.batches) || !session.batches.length || session.batches.some((batch, index) => {
      if (!Array.isArray(batch) || batch.length > MAX_PUSH_CHANGES || (!batch.length && session.batches.length !== 1)
        || byteLength({ ...identity, index, changes: batch }) > MAX_PUSH_BYTES) return true
      return batch.some(change => {
        if (!change || (!COLLECTIONS[change.entity] && change.entity !== 'setting') || typeof change.id !== 'string' || !change.id
          || !Number.isSafeInteger(change.updatedAt) || change.updatedAt <= 0 || typeof change.deviceId !== 'string' || !change.deviceId
          || !change.data || typeof change.data !== 'object' || Array.isArray(change.data)) return true
        const key = JSON.stringify([change.entity, change.id])
        if (keys.has(key)) return true
        keys.add(key)
        return false
      })
    })) throw new Error('首次上传快照无效，请保留本机数据')
    const status = initialStatus(await request('/api/v1/sui-time/sync/init/start', { method: 'POST', auth,
      data: { ...identity, batchCount: session.batches.length } }), session)
    if (status.status === 'expired' || status.status === 'cancelled') throw new Error('首次上传会话已过期或取消，请取消本机会话后重新选择绑定方式')
    // 重发每个批次，让服务端核对快照摘要，包括已接收和已完成的批次。
    const received = new Set(status.received)
    for (let index = 0; index < session.batches.length; index++) {
      const uploaded = initialStatus(await request('/api/v1/sui-time/sync/init/batch', { method: 'POST', auth,
        data: { ...identity, index, changes: session.batches[index] } }), session)
      if (uploaded.status !== status.status || !uploaded.received.includes(index)
        || [...received].some(item => !uploaded.received.includes(item))) throw new Error('首次上传批次确认协议无效，请保留本机数据')
      for (const item of uploaded.received) received.add(item)
    }
    if (status.status === 'active') {
      const completed = initialStatus(await request('/api/v1/sui-time/sync/init/complete', { method: 'POST', auth, data: identity }), session)
      if (completed.status !== 'completed') throw new Error('首次上传尚未完成，请重试')
    }
    const remote = await pull(auth, 0)
    const latest = load()
    const meta = ensureMeta(latest)
    if (!same(meta.initialUpload, session) || readAuth()?.token !== auth.token || readAuth()?.user?.id !== session.userId) throw new Error('首次上传账号或会话已改变，请重试')
    const keyOf = change => JSON.stringify([change.entity, change.id])
    const snapshot = new Map(session.batches.flat().map(change => [keyOf(change), change]))
    const current = outgoing(latest)
    const protectedKeys = new Set()
    for (const change of current) {
      const key = keyOf(change)
      if (!snapshot.has(key) || !same(snapshot.get(key), change)) protectedKeys.add(key)
    }
    for (const change of current) if (!protectedKeys.has(keyOf(change))) delete meta.outbox[change.entity]?.[change.id]
    const incoming = new Map()
    for (const change of remote.changes) {
      const key = keyOf(change)
      const old = incoming.get(key)
      if (!old || change.updatedAt > old.updatedAt || (change.updatedAt === old.updatedAt && change.deviceId > old.deviceId)) incoming.set(key, change)
    }
    for (const [key, change] of incoming) if (!protectedKeys.has(key)) applyChange(latest, change)
    Object.assign(meta, { remoteUserId: session.userId, remoteUsername: session.username, cursor: remote.cursor,
      lastSyncAt: Date.now(), dataOrigin: 'user', initialUpload: null })
    persist(latest)
    emit(SYNC_APPLIED_EVENT)
    return meta
  }
  async function exchange(auth, requireEmpty = false) {
    const snapshot = load()
    const meta = ensureMeta(snapshot)
    const merging = meta.initialMerge
    if (merging ? merging.userId !== auth.user.id || meta.remoteUserId || merging.deviceId !== meta.deviceId || meta.cursor !== 0
      : meta.remoteUserId !== auth.user.id) throw new Error('登录账号与绑定账号不一致，请登录原账号')
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
    if ((merging ? !same(latestMeta.initialMerge, merging) || latestMeta.remoteUserId || latestMeta.deviceId !== merging.deviceId || latestMeta.cursor !== 0
      : latestMeta.remoteUserId !== auth.user.id) || readAuth()?.token !== auth.token || readAuth()?.user?.id !== auth.user.id) throw new Error('同步账号已改变，请重试')
    // 只有请求快照仍匹配的队列项才能出队；网络期间编辑的同一实体保持待上传。
    const protectedKeys = new Set()
    for (const [entity, entries] of Object.entries(latestMeta.outbox)) {
      for (const [id, version] of Object.entries(entries)) {
        if (meta.outbox[entity]?.[id] !== version || !same(entityValue(snapshot, entity, id), entityValue(latest, entity, id))) protectedKeys.add(JSON.stringify([entity, id]))
      }
    }
    for (const change of changes) {
      if (!protectedKeys.has(JSON.stringify([change.entity, change.id]))) delete latestMeta.outbox[change.entity]?.[change.id]
    }
    const incoming = new Map()
    for (const change of [...remote.changes, ...superseded]) {
      const key = JSON.stringify([change.entity, change.id])
      const old = incoming.get(key)
      if (!old || change.updatedAt > old.updatedAt || (change.updatedAt === old.updatedAt && change.deviceId > old.deviceId)) incoming.set(key, change)
    }
    for (const [key, change] of incoming) if (!protectedKeys.has(key)) applyChange(latest, change)
    latestMeta.cursor = remote.cursor
    latestMeta.lastSyncAt = Date.now()
    if (merging) Object.assign(latestMeta, { remoteUserId: merging.userId, remoteUsername: merging.username, initialMerge: null, dataOrigin: 'user' })
    persist(latest)
    emit(SYNC_APPLIED_EVENT)
    return latestMeta
  }
  function syncNow() {
    return singleFlight(() => {
      const auth = readAuth()
      if (!auth?.token) return null
      const meta = ensureMeta(load())
      return meta.initialUpload ? resumeInitialUpload(auth, meta.initialUpload) : meta.initialMerge || meta.remoteUserId ? exchange(auth) : null
    })
  }
  function bind({ mode = 'login', username, password, strategy = 'remote' }) {
    return singleFlight(async () => {
      if (!['upload', 'merge', 'remote'].includes(strategy)) throw new Error('请选择有效的数据绑定方式')
      const id = deviceId()
      const auth = await authenticate(mode, username, password, id)
      const snapshot = load()
      const meta = ensureMeta(snapshot)
      if (meta.initialUpload) {
        if (meta.initialUpload.userId !== auth.user.id) throw new Error('首次上传尚未完成，请登录原账号继续')
        writeAuth(auth)
        return resumeInitialUpload(auth, meta.initialUpload)
      }
      if (meta.initialMerge) {
        if (meta.initialMerge.userId !== auth.user.id) throw new Error('首次合并尚未完成，请登录原账号继续')
        writeAuth(auth)
        return exchange(auth)
      }
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
        const session = prepareInitialUpload(auth)
        writeAuth(auth)
        return resumeInitialUpload(auth, session)
      }
      const latest = load()
      const latestMeta = ensureMeta(latest)
      latestMeta.initialMerge = { userId: auth.user.id, username: auth.user.username, deviceId: latestMeta.deviceId }
      latestMeta.cursor = 0
      latestMeta.dataOrigin = 'user'
      const now = Date.now()
      for (const [entity, key] of Object.entries(COLLECTIONS)) {
        latestMeta.outbox[entity] ||= {}
        for (const item of latest[key] || []) {
          const itemId = entity === 'anniversary_record' ? recordId(item) : item.id
          if (!Object.hasOwn(latestMeta.outbox[entity], itemId)) Object.defineProperty(latestMeta.outbox[entity], itemId, { value: item.updatedAt || item.createdAt || now, enumerable: true, writable: true, configurable: true })
        }
      }
      latestMeta.outbox.setting ||= {}
      for (const key of Object.keys(syncSettings(latest))) latestMeta.outbox.setting[key] ||= now
      const previous = readAuth()
      writeAuth(auth)
      try { persist(latest) } catch (error) { writeAuth(previous); throw error }
      return exchange(auth)
    }, 'bind')
  }
  function cancelInitialUpload(expected) {
    return singleFlight(async () => {
      const auth = readAuth()
      const meta = ensureMeta(load())
      const session = meta.initialUpload
      if (!session || session.sessionId !== expected?.sessionId || session.userId !== expected?.userId) throw new Error('首次上传账号或会话已改变，请重新确认')
      if (!auth?.token || auth.user?.id !== session.userId) throw new Error('请先登录原账号，再取消首次上传')
      if (meta.remoteUserId || meta.deviceId !== session.deviceId) throw new Error('首次上传账号或设备已改变，请保留本机数据')
      const identity = initialIdentity(session)
      let started
      try {
        started = initialStatus(await request('/api/v1/sui-time/sync/init/start', { method: 'POST', auth,
          data: { ...identity, batchCount: session.batches.length } }), session, false)
      } catch (error) {
        // 仅这两个明确错误表明该账号和设备下的会话尚未创建。
        if (!['remote_not_empty', 'init_in_progress'].includes(error.code)) throw error
      }
      if (started) {
        if (started.status === 'completed') throw new Error('云端已完成初始化，请继续首次上传以完成绑定')
        let cancelled
        try {
          cancelled = initialStatus(await request('/api/v1/sui-time/sync/init/cancel', { method: 'POST', auth, data: identity }), session, false)
        } catch (error) {
          if (error.code === 'init_completed') throw new Error('云端已完成初始化，请继续首次上传以完成绑定')
          throw error
        }
        if (cancelled.status !== 'cancelled') throw new Error('未能确认初始化已取消，请保留本机数据并重试')
      }
      const latest = load()
      const current = ensureMeta(latest)
      const currentAuth = readAuth()
      if (!same(current.initialUpload, session) || current.deviceId !== session.deviceId || current.remoteUserId !== meta.remoteUserId
        || currentAuth?.token !== auth.token || currentAuth?.user?.id !== session.userId) throw new Error('首次上传账号或会话已改变，请重新操作')
      current.initialUpload = null
      persist(latest)
    }, 'cancel')
  }
  function unbind() {
    return singleFlight(async () => {
      const old = readAuth()
      const data = load()
      const meta = ensureMeta(data)
      if (meta.initialUpload || meta.initialMerge) throw new Error('首次上传或合并尚未完成，请先继续原账号的同步')
      Object.assign(meta, { remoteUserId: null, remoteUsername: null, cursor: 0, lastSyncAt: null })
      persist(data)
      writeAuth(null)
      publish({ status: 'unbound' })
      try { await revokeAuth(old) } catch { /* 离线解绑仍保留本地数据并清除本机凭证。 */ }
    }, 'unbind')
  }
  return { deviceId, syncNow, bind, unbind, cancelInitialUpload, getState: () => ({ ...state }),
    subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener) } }
}

export const syncEngine = createSyncEngine({ load, save, readAuth, writeAuth, request, authenticate, revokeAuth,
  emit: event => uni.$emit(event) })
export const syncNow = () => syncEngine.syncNow()
export const bindAccount = options => syncEngine.bind(options)
export const unbindAccount = () => syncEngine.unbind()
export const cancelInitialUpload = expected => syncEngine.cancelInitialUpload(expected)

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
      const meta = load().syncMeta
      if (readAuth()?.token && meta?.remoteUserId && Object.values(meta.outbox || {}).some(entries => Object.keys(entries).length)) dirty = true
    } catch {
      // 失败时保留 outbox，等待下一次轮询或新的本地写入，不因未完成的写入加速重试。
      dirty = false
      clearTimeout(timer)
    } finally {
      running = false
      if (active && dirty) { clearTimeout(timer); timer = setTimeout(drain, 800) }
    }
  }
  const onWrite = () => { dirty = true; clearTimeout(timer); timer = setTimeout(drain, 800) }
  const pollTimer = setInterval(drain, 60000)
  uni.$on(LOCAL_WRITE_EVENT, onWrite)
  uni.$on(SYNC_APPLIED_EVENT, onApplied)
  return () => { active = false; clearTimeout(timer); clearInterval(pollTimer); uni.$off(LOCAL_WRITE_EVENT, onWrite); uni.$off(SYNC_APPLIED_EVENT, onApplied) }
}
