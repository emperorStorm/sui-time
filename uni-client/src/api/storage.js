import { todayString } from '../utils/date.js'

const STORAGE_KEY = 'sui-time-mobile:v1'

// 种子数据对齐原型演示语义，字段对齐生产 types.ts
function seedData() {
  const today = todayString()
  return {
    profile: { name: '暴走的小陌', phone: '182****9035', signature: '暴走方知深浅' },
    settings: { hideCompleted: true, collapsedGroups: [] },
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

export function load() {
  if (cache) return cache
  let raw
  try {
    // #ifdef H5
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    // #endif
    raw = uni.getStorageSync(STORAGE_KEY)
    // #ifdef H5
    if (stored !== null && (raw === undefined || raw === null || raw === '')) throw new Error('读取失败')
    // #endif
  } catch {
    throw new Error('无法读取本机数据，请稍后重试')
  }
  if (raw === undefined || raw === null || raw === '') {
    save(seedData(), { strict: true, message: '无法初始化本机数据，请检查存储空间后重试' })
    return cache
  }
  // 兼容 H5 存储包装；非空坏数据不能被演示数据覆盖。
  if (raw && typeof raw === 'object' && raw.data && !raw.categories && !raw.tasks) raw = raw.data
  const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
  if (!isObject(raw) || !Array.isArray(raw.categories) || !Array.isArray(raw.tasks)
    || raw.categories.some(item => !isObject(item)) || raw.tasks.some(item => !isObject(item))
    || (raw.settings !== undefined && !isObject(raw.settings))
    || (raw.anniversaries !== undefined && !Array.isArray(raw.anniversaries))
    || (raw.anniversaryRecords !== undefined && !Array.isArray(raw.anniversaryRecords))) {
    throw new Error('本机数据已损坏，请保留数据并重试')
  }
  cache = {
    ...raw,
    settings: { hideCompleted: true, collapsedGroups: [], ...raw.settings },
    anniversaries: raw.anniversaries || [],
    anniversaryRecords: raw.anniversaryRecords || []
  }
  return cache
}

export function save(data, { strict = false, message = '无法保存纪念日，存储空间可能不足，请减少照片后重试' } = {}) {
  try {
    uni.setStorageSync(STORAGE_KEY, data)
    cache = data
  } catch (e) {
    if (strict) throw new Error(message)
    // 兼容旧的非严格调用，写入失败时仍保留上一次缓存。
  }
}

export function reset() {
  save(seedData(), { strict: true, message: '无法恢复演示数据，请检查存储空间' })
}

export function persist() {
  save(load())
}
