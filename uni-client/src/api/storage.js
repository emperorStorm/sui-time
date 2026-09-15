import { todayString } from '../utils/date'

const STORAGE_KEY = 'sui-time-mobile:v1'

// 种子数据对齐原型演示语义，字段对齐生产 types.ts
function seedData() {
  const today = todayString()
  return {
    profile: { name: '暴走的小陌', phone: '182****9035', signature: '暴走方知深浅' },
    settings: { hideCompleted: true, collapsedGroups: [] },
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
  try {
    let raw = uni.getStorageSync(STORAGE_KEY)
    // H5 下 uni.getStorageSync 可能返回 {type, data} 包装结构，需解包
    if (raw && raw.data && typeof raw.data === 'object' && (raw.data.categories || raw.data.tasks)) raw = raw.data
    if (raw && raw.categories && raw.tasks) {
      cache = raw
      return cache
    }
  } catch (e) {
    // 存储异常时回退种子数据
  }
  cache = seedData()
  save(cache)
  return cache
}

export function save(data) {
  cache = data
  try {
    uni.setStorageSync(STORAGE_KEY, data)
  } catch (e) {
    // 存储失败不阻断界面
  }
}

export function reset() {
  cache = seedData()
  save(cache)
}

export function persist() {
  save(load())
}
