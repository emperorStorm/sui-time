// 与同步引擎保持一致；记录以纪念日和日期组成稳定复合 id。
export const entityCollections = {
  categories: 'category', tasks: 'task', anniversaries: 'anniversary', anniversaryRecords: 'anniversary_record'
}

export const entityId = (collection, item) => collection === 'anniversaryRecords'
  ? `${item.anniversaryId}@${item.date}` : item.id

export const cloneData = value => JSON.parse(JSON.stringify(value))

export function syncSettings(data) {
  return {
    'show_completed.tasks': !data.settings?.hideCompletedByView?.tasks,
    'show_completed.month': !data.settings?.hideCompletedByView?.month,
    'mobile.new_task_defaults': data.settings?.newTaskDefaults ?? null,
    'mobile.collapsed_groups': data.settings?.collapsedGroups ?? [],
    'mobile.profile': data.profile ?? {}
  }
}

export function applySyncSetting(data, key, value, deleted) {
  data.settings ||= {}
  if (key === 'show_completed.tasks' || key === 'show_completed.month') {
    if (!deleted && typeof value !== 'boolean') throw new Error('远端显示偏好无效')
    data.settings.hideCompletedByView ||= {}
    data.settings.hideCompletedByView[key.endsWith('tasks') ? 'tasks' : 'month'] = deleted ? true : !value
  } else if (key === 'mobile.new_task_defaults') {
    if (deleted) delete data.settings.newTaskDefaults
    else data.settings.newTaskDefaults = cloneData(value)
  } else if (key === 'mobile.collapsed_groups') {
    if (!deleted && !Array.isArray(value)) throw new Error('远端分组偏好无效')
    data.settings.collapsedGroups = deleted ? [] : cloneData(value)
  } else if (key === 'mobile.profile') {
    if (!deleted && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('远端资料格式无效')
    data.profile = deleted ? {} : cloneData(value)
  }
}


export function sameData(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameData(a[key], b[key]))
}

export function captureChanges(previous, next, now) {
  const pending = cloneData(next.syncMeta.outbox)
  // 同次提交使用统一且递增的版本，父子级联不会因各自历史版本不同而分叉。
  let version = now
  for (const collection of Object.keys(entityCollections)) {
    for (const item of previous?.[collection] || []) version = Math.max(version, (item.updatedAt || 0) + 1)
    for (const item of next[collection]) version = Math.max(version, item.updatedAt || 0)
  }
  for (const entries of Object.values(pending)) {
    for (const updatedAt of Object.values(entries)) version = Math.max(version, updatedAt + 1)
  }
  let changed = false
  const enqueue = (entity, id) => {
    const entries = Object.hasOwn(pending, entity) ? pending[entity] : {}
    // defineProperty 避免历史自定义 id（如 __proto__）触发原型 setter。
    Object.defineProperty(entries, id, { value: version, enumerable: true, writable: true, configurable: true })
    pending[entity] = entries
    changed = true
  }
  for (const [collection, entity] of Object.entries(entityCollections)) {
    const oldItems = new Map((previous?.[collection] || []).map(item => [entityId(collection, item), item]))
    const ids = new Set(next[collection].map(item => entityId(collection, item)))
    // 兼容旧调用方传入物理删除后的数组，已存在墓碑也不能丢失。
    for (const [id, item] of oldItems) {
      if (!ids.has(id)) next[collection].push(item.deletedAt != null ? cloneData(item) : { ...cloneData(item), deletedAt: now })
    }
    next[collection] = next[collection].map(item => {
      const id = entityId(collection, item)
      if (sameData(oldItems.get(id), item)) return item
      enqueue(entity, id)
      return { ...item, updatedAt: version, deviceId: next.syncMeta.deviceId }
    })
  }
  const oldSettings = syncSettings(previous)
  for (const [key, value] of Object.entries(syncSettings(next))) {
    if (!sameData(oldSettings[key], value)) enqueue('setting', key)
  }
  next.syncMeta.outbox = pending
  if (changed) next.syncMeta.dataOrigin = 'user'
  return changed
}
