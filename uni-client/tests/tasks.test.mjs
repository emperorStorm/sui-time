import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTaskTime, normalizeTask, compareTasks, taskMark } from '../src/utils/task.js'
import { occursOn, resolveTasksForDate, repeatLabel } from '../src/utils/occurrence.js'
import { weekDates, weekTitle } from '../src/utils/date.js'
import * as store from '../src/api/store.js'
import { syncTaskReminders, reminderState, reminderSummary, reminderSaveMessage, subscribeReminderState } from '../src/api/reminders.js'
import { load, save as saveStorage } from '../src/api/storage.js'
import { refreshHolidayCalendar } from '../src/api/holiday.js'
import { confirm } from '../src/utils/platform.js'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as vue from 'vue'

let disk = null
let fail = false
let writes = 0
globalThis.uni = { getStorageSync: () => disk, setStorageSync: (_, value) => { writes++; if (fail) throw Error('存储失败'); disk = structuredClone(value) } }
const task = (patch = {}) => ({ title: '测试事项', plannedDate: '2026-10-10', scheduleKind: 'all_day', status: 'todo', priority: 'not_urgent_not_important', ...patch })

const recurrence = { occursOn, tasksForDate: resolveTasksForDate }

test('确认窗口失败时返回明确错误，不让调用方永久等待', async () => {
  const previous = globalThis.uni.showModal
  try {
    globalThis.uni.showModal = options => options.fail({ errMsg: 'unavailable' })
    await assert.rejects(confirm('确认操作'), /确认窗口无法打开/)
    globalThis.uni.showModal = options => options.success({ confirm: false })
    assert.equal(await confirm('确认操作'), false)
  } finally {
    if (previous) globalThis.uni.showModal = previous
    else delete globalThis.uni.showModal
  }
})

test('节假日刷新区分有效空数据和无缓存的网络失败', async () => {
  const previous = globalThis.uni
  let cache = { '2026': [{ date: '2026-10-01', name: '旧标记', isOffDay: true }] }
  let failRequest = false
  globalThis.uni = {
    getStorageSync: () => cache,
    setStorageSync: (_, value) => { cache = value },
    request: options => failRequest ? options.fail(new Error('离线')) : options.success({ statusCode: 200, data: { year: 2026, days: [] } })
  }
  try {
    const refreshed = await refreshHolidayCalendar([2026])
    assert.deepEqual(refreshed.availableYears, [2026])
    assert.deepEqual(refreshed.days, {})
    cache = {}
    failRequest = true
    const offline = await refreshHolidayCalendar([2027])
    assert.deepEqual(offline.availableYears, [])
    assert.deepEqual(offline.days, {})
  } finally { globalThis.uni = previous }
})

test('前台恢复时报告提醒排程错误，并区分本机读取失败', async () => {
  const source = (await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const modals = []
  const events = []
  let readFailure = false
  let reminderResult = { error: '排程异常' }
  const context = vm.createContext({ uni: { $emit: event => events.push(event), showModal: options => modals.push(options), showToast() {} } })
  const dependencies = {
    vue: { onBeforeUnmount() {} },
    '@dcloudio/uni-app': { onHide() {}, onLaunch() {}, onShow() {} },
    './api/store': { listTasks: () => { if (readFailure) throw new Error('读取异常'); return [] } },
    './api/reminders': { syncTaskReminders: async () => reminderResult },
    './api/update': { resumeUpdateInstallation() {} },
    './api/sync.js': { startAutoSync() {}, syncNow() {} }
  }
  const module = new vm.SourceTextModule(`${source}\nexport { refreshReminders };`, { context })
  await module.link(specifier => new vm.SyntheticModule(Object.keys(dependencies[specifier]), function () {
    for (const [key, value] of Object.entries(dependencies[specifier])) this.setExport(key, value)
  }, { context }))
  await module.evaluate()
  await module.namespace.refreshReminders()
  assert.equal(modals[0].title, '更新系统提醒失败')
  assert.match(modals[0].content, /排程异常/)
  assert.deepEqual(events, ['reminder-permissions'])
  modals[0].success({ confirm: false })
  readFailure = true
  await module.namespace.refreshReminders()
  assert.equal(modals[1].title, '读取本机事项失败')
  assert.match(modals[1].content, /读取异常/)
  modals[1].success({ confirm: false })
  readFailure = false
  reminderResult = { supported: true, notifications: true, exactAlarm: true, warnings: [{ id: 'a', title: '事项', kind: 'workdays' }] }
  await module.namespace.refreshReminders()
  await module.namespace.refreshReminders()
  assert.equal(modals.length, 2)
})

test('提醒警告、真实错误和权限变化持续更新且不丢失已知警告', async () => {
  const warning = { id: 'a', title: '工作日事项', kind: 'workdays' }
  let permissions = { supported: true, notifications: true, exactAlarm: true }
  let response = { ...permissions, scheduled: 2, warnings: [warning] }
  const observed = []
  globalThis.plus = { os: { name: 'Android' }, android: { runtimeMainActivity: () => ({}), invoke: (name) => JSON.stringify(name.endsWith('AppSettings') ? permissions : response) } }
  const unsubscribe = subscribeReminderState(state => observed.push(state))
  try {
    const result = await syncTaskReminders([{ id: 'a' }])
    assert.match(reminderSaveMessage(result), /暂不支持/)
    assert.doesNotMatch(reminderSaveMessage(result), /排程失败/)
    assert.match(reminderSummary(reminderState()), /1 项/)
    response = { ...permissions, scheduled: 2, warnings: [{ ...warning, title: '已更名' }] }
    await syncTaskReminders([{ id: 'a' }])
    assert.equal(reminderState().warnings[0].title, '已更名')
    observed.at(-1).warnings[0].title = '外部修改'
    assert.equal(reminderState().warnings[0].title, '已更名')
    response = { supported: true, error: '排程异常', warnings: [] }
    await syncTaskReminders([{ id: 'a' }])
    assert.equal(reminderState().warnings[0].id, 'a')
    assert.match(reminderSummary(reminderState()), /排程异常/)
    response = { supported: true, error: '以下事项的重复规则暂不支持安卓提醒' }
    await syncTaskReminders([{ id: 'a' }])
    assert.match(reminderState().error, /暂不支持/)
    permissions = { ...permissions, exactAlarm: false }
    response = { ...permissions, scheduled: 0 }
    await syncTaskReminders([{ id: 'a' }])
    assert.equal(reminderState().warnings.length, 1)
    assert.match(reminderSummary(reminderState()), /未安排/)
    response = { ...permissions, scheduled: 0, warnings: [] }
    await syncTaskReminders([])
    assert.equal(reminderState().warnings.length, 0)
    assert.match(reminderSummary(reminderState()), /未安排/)
    permissions = { ...permissions, exactAlarm: true }
    response = { ...permissions, scheduled: 1, warnings: [] }
    await syncTaskReminders([])
    assert.equal(reminderState().warnings.length, 0)
    assert.match(reminderSummary(reminderState()), /已安排 1/)
    unsubscribe()
    const count = observed.length
    await syncTaskReminders([])
    assert.equal(observed.length, count)
  } finally { unsubscribe(); delete globalThis.plus; await syncTaskReminders([]) }
})

test('提醒状态监听中提交新快照仍会安排最新内容', async () => {
  const snapshots = []
  let requested = false
  globalThis.plus = { os: { name: 'Android' }, android: { runtimeMainActivity: () => ({}), invoke: (name, method, context, snapshot) => {
    if (name.endsWith('ReminderBridge')) snapshots.push(JSON.parse(snapshot))
    return JSON.stringify({ supported: true, notifications: true, exactAlarm: true, scheduled: 0, warnings: [] })
  } } }
  const unsubscribe = subscribeReminderState(state => {
    if (state.scheduleReady && !requested) { requested = true; void syncTaskReminders([{ id: 'new' }]) }
  })
  try {
    await syncTaskReminders([{ id: 'old' }])
    assert.equal(snapshots.at(-1)[0].id, 'new')
  } finally { unsubscribe(); delete globalThis.plus; await syncTaskReminders([]) }
})

test('间隔日与其他高级重复规则不误显示为不重复', () => {
  assert.equal(repeatLabel('every_days', 3), '每隔3天')
  assert.equal(repeatLabel('workdays'), '工作日')
  assert.notEqual(repeatLabel('custom'), '不重复')
})

test('重复次数按实际匹配的源日期计数', () => {
  const vectors = [
    ['2026-01-01', { kind: 'weekly', interval: 3, count: 2 }, ['2026-01-01', '2026-01-08'], ['2026-01-15', '2026-01-02']],
    ['2026-01-31', { kind: 'monthly', interval: 3, count: 2 }, ['2026-01-31', '2026-03-31'], ['2026-02-28', '2026-05-31']],
    ['2024-02-29', { kind: 'yearly', count: 2 }, ['2024-02-29', '2028-02-29'], ['2025-02-28', '2032-02-29']],
    ['2096-02-29', { kind: 'yearly', count: 2 }, ['2096-02-29', '2104-02-29'], ['2100-02-28', '2108-02-29']],
    ['2026-01-03', { kind: 'workdays', count: 2 }, ['2026-01-05', '2026-01-06'], ['2026-01-03', '2026-01-07']],
    ['2026-01-01', { kind: 'weekly_slots', weekdays: [1, 4, 4], slots: [{ day: 4, time: '09:00' }, { day: 4, time: '17:00' }], interval: 2, count: 2 }, ['2026-01-01', '2026-01-05'], ['2026-01-08']],
    ['2026-01-30', { kind: 'monthly_slots', monthDays: [1, 29, 31, 31], count: 4 }, ['2026-01-31', '2026-02-01', '2026-03-01', '2026-03-29'], ['2026-01-30', '2026-03-31']],
    ['2026-01-01', { kind: 'memory', count: 2 }, ['2026-01-02', '2026-01-04'], ['2026-01-01', '2026-01-08']],
    ['2026-01-01', { kind: 'memory', count: 5 }, ['2026-01-02', '2026-01-04', '2026-01-08', '2026-01-15', '2026-01-30'], ['2026-01-03', '2026-01-31']],
    ['2026-01-01', { kind: 'memory', count: 9 }, ['2026-01-30'], ['2026-01-31']],
    ['2023-12-29', { kind: 'monthly_slots', monthDays: [29], count: 3 }, ['2024-01-29', '2024-02-29'], ['2024-03-29']],
    ['2026-01-01', { kind: 'weekly_slots', count: 2 }, ['2026-01-01', '2026-01-08'], ['2026-01-15']],
    ['2026-01-31', { kind: 'monthly_slots', count: 2 }, ['2026-01-31', '2026-03-31'], ['2026-05-31']],
    ...['daily', 'every_days', 'custom'].map(kind => ['2026-01-01', { kind, interval: 2, count: 2 }, ['2026-01-01', '2026-01-03'], ['2026-01-02', '2026-01-05']]),
    ['2026-01-01', { kind: 'weekly', count: 1 }, ['2026-01-01'], ['2025-12-25', '2026-01-08']],
    ...[undefined, 0, -2].map(count => ['2026-01-01', { kind: 'weekly', count }, ['2026-01-15'], []])
  ]
  for (const [plannedDate, rule, yes, no] of vectors) {
    const item = task({ plannedDate, repeatRule: JSON.stringify({ ...rule, endMode: 'count' }) })
    for (const date of yes) assert.equal(recurrence.occursOn(item, date), true, `${JSON.stringify(rule)} ${date}`)
    for (const date of no) assert.equal(recurrence.occursOn(item, date), false, `${JSON.stringify(rule)} ${date}`)
  }
})

test('周期计数与逐日匹配的参考结果一致', () => {
  const rules = [
    { kind: 'daily', interval: 3 }, { kind: 'weekly' }, { kind: 'workdays' },
    { kind: 'weekly_slots', weekdays: [0, 2, 6] }, { kind: 'monthly' },
    { kind: 'monthly_slots', monthDays: [1, 28, 29, 30, 31] }, { kind: 'yearly' }, { kind: 'memory' }
  ]
  for (const rule of rules) {
    const item = task({ plannedDate: '2024-02-29', repeatRule: JSON.stringify(rule) })
    let count = 0
    for (let day = Date.UTC(2024, 1, 29); day <= Date.UTC(2029, 2, 1); day += 86400000) {
      const date = new Date(day).toISOString().slice(0, 10)
      if (!recurrence.occursOn(item, date)) continue
      count++
      for (const limit of [1, 2, 10, 100]) {
        const limited = { ...item, repeatRule: JSON.stringify({ ...rule, endMode: 'count', count: limit }) }
        assert.equal(recurrence.occursOn(limited, date), count <= limit, `${rule.kind} ${date} ${limit}`)
      }
    }
  }
})

test('夏令时跨越按日历日期而非本地毫秒计数', () => {
  const previous = process.env.TZ
  try {
    for (const zone of ['America/New_York', 'Australia/Sydney']) {
      process.env.TZ = zone
      for (const [start, second, third] of [['2026-03-07', '2026-03-08', '2026-03-09'], ['2026-10-03', '2026-10-04', '2026-10-05'], ['2026-10-31', '2026-11-01', '2026-11-02']]) {
        const item = task({ plannedDate: start, repeatRule: JSON.stringify({ kind: 'daily', endMode: 'count', count: 2 }) })
        assert.equal(recurrence.occursOn(item, second), true, `${zone} ${second}`)
        assert.equal(recurrence.occursOn(item, third), false, `${zone} ${third}`)
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('移动、删除和终态不改变源次数，终态覆盖仍可显示', () => {
  const item = task({ id: 'repeat', plannedDate: '2026-01-01', repeatRule: JSON.stringify({ kind: 'weekly', endMode: 'count', count: 3 }), occurrenceOverrides: JSON.stringify({
    '2026-01-01': { deleted: true },
    '2026-01-08': { plannedDate: '2026-01-09' },
    '2026-01-15': { status: 'done' },
    '2026-01-22': { status: 'failed' }
  }) })
  assert.equal(recurrence.tasksForDate([item], '2026-01-01').length, 0)
  assert.equal(recurrence.tasksForDate([item], '2026-01-08').length, 0)
  assert.equal(recurrence.tasksForDate([item], '2026-01-09')[0].id, 'repeat@2026-01-08')
  assert.equal(recurrence.tasksForDate([item], '2026-01-15')[0].status, 'done')
  assert.equal(recurrence.occursOn(item, '2026-01-22'), false)
  assert.equal(recurrence.tasksForDate([item], '2026-01-22')[0].status, 'failed')
  assert.equal(recurrence.tasksForDate([item], '2026-01-29').length, 0)
})

test('首次设时间、关闭后编辑、全天与重新设置时间', () => {
  const draft = task()
  applyTaskTime(draft, { scheduleKind: 'point', plannedTime: '09:00' })
  assert.deepEqual(draft.reminderOffsets, [0])
  draft.reminderOffsets = []
  applyTaskTime(draft, { plannedTime: '10:00' })
  assert.deepEqual(draft.reminderOffsets, [])
  draft.reminderOffsets = [0, 15, 30]
  applyTaskTime(draft, { scheduleKind: 'range', plannedEndTime: '11:00' })
  assert.deepEqual(draft.reminderOffsets, [0, 15, 30])
  applyTaskTime(draft, { scheduleKind: 'all_day' })
  assert.equal(draft.plannedTime, null)
  assert.deepEqual(draft.reminderOffsets, [])
  applyTaskTime(draft, { scheduleKind: 'point', plannedTime: '08:00' })
  assert.deepEqual(draft.reminderOffsets, [0])
})

test('旧数据不启用提醒，并拒绝无效时间段、日期和提醒规则', () => {
  assert.deepEqual(normalizeTask(task()).reminderOffsets, [])
  assert.throws(() => normalizeTask(task({ plannedDate: '2026-02-30' })), /有效日期/)
  assert.throws(() => normalizeTask(task({ scheduleKind: 'range', plannedTime: '10:00', plannedEndTime: '09:00' })), /结束时间/)
  assert.throws(() => normalizeTask(task({ scheduleKind: 'point', plannedTime: '09:00', reminderOffsets: [0, 5, 15, 30] })), /最多/)
})

test('有时间优先、时间先于优先级、完成失败置底及轻量标记', () => {
  const data = [task({ id: 'c', priority: 'urgent_important' }), task({ id: 'b', scheduleKind: 'point', plannedTime: '10:00', priority: 'urgent_important' }), task({ id: 'a', scheduleKind: 'point', plannedTime: '09:00' }), task({ id: 'd', status: 'failed', scheduleKind: 'point', plannedTime: '08:00' })]
  assert.deepEqual(data.sort(compareTasks).map(item => item.id), ['a', 'b', 'c', 'd'])
  assert.equal(taskMark(data[0]), 'IV')
  assert.equal(taskMark(data[3]), '×')
  assert.equal(taskMark(task({ status: 'done' })), '✓')
})

test('多个改期实例与原实例在同一天全部显示', () => {
  const source = task({ id: 'repeat', repeatRule: '{"kind":"daily"}', occurrenceOverrides: JSON.stringify({ '2026-10-09': null, '2026-10-10': { plannedDate: '2026-10-12' }, '2026-10-11': { plannedDate: '2026-10-12' } }) })
  assert.equal(resolveTasksForDate([source], '2026-10-12').length, 3)
  assert.equal(resolveTasksForDate([source], '2026-10-10').length, 0)
})

test('父子原子保存、全部子项删除、存储失败不污染缓存、不排程', async () => {
  const calls = []
  globalThis.plus = { os: { name: 'Android' }, android: { runtimeMainActivity: () => ({}), invoke: (_, method, context, snapshot) => { calls.push(snapshot); return '{"supported":true}' } } }
  const parent = store.saveTask(task(), [{ id: 'child-a', title: '子事项' }])
  await syncTaskReminders(store.listTasks())
  assert.equal(store.listChildren(parent.id).length, 1)
  store.saveTask({ ...parent, title: '修改标题' }, [])
  await syncTaskReminders(store.listTasks())
  assert.equal(store.listChildren(parent.id).length, 0)
  const before = structuredClone(store.listTasks())
  const count = calls.length
  fail = true
  assert.throws(() => store.saveTask({ ...parent, title: '不会落盘' }), /无法保存/)
  assert.throws(() => store.restoreDemoData(), /无法恢复/)
  assert.deepEqual(store.listTasks(), before)
  assert.equal(calls.length, count)
  fail = false
  delete globalThis.plus
})

test('当次时间编辑与完成不更改源，已完成实例保留快照', () => {
  const parent = store.saveTask(task({ repeatRule: '{"kind":"daily"}', scheduleKind: 'point', plannedTime: '09:00', reminderOffsets: [15] }))
  const id = `${parent.id}@2026-10-11`
  store.saveTask({ id, title: '当次修改', plannedTime: '10:00' })
  assert.equal(store.findTask(id).plannedTime, '10:00')
  assert.equal(store.findTask(parent.id).plannedTime, '09:00')
  assert.deepEqual(store.findTask(id).reminderOffsets, [15])
  store.setTaskStatus(id, 'done')
  assert.equal(store.findTask(parent.id).status, 'todo')
  store.saveTask({ id: parent.id, title: '新源名称' })
  assert.equal(store.findTask(id).title, '当次修改')
  assert.equal(store.findTask(`${parent.id}@2026-10-12`).status, 'todo')
  store.removeTask(id)
  assert.equal(store.findTask(id), null)
})

test('同步进行中提交新快照，最后一轮读取最新内容', async () => {
  const calls = []
  globalThis.plus = { os: { name: 'Android' }, android: { runtimeMainActivity: () => ({}), invoke: (_, method, context, snapshot) => {
    calls.push(JSON.parse(snapshot))
    if (calls.length === 1) syncTaskReminders([{ id: 'latest' }])
    return '{"supported":true}'
  } } }
  await syncTaskReminders([{ id: 'first' }])
  assert.equal(calls.at(-1)[0].id, 'latest')
  await syncTaskReminders([])
  assert.deepEqual(calls.at(-1), [])
  delete globalThis.plus
})

test('标题及备注长度校验，不截断草稿', () => {
  const input = task({ title: `  ${'名'.repeat(120)}  `, notes: '备'.repeat(1000) })
  assert.equal(normalizeTask(input).title.length, 120)
  assert.equal(normalizeTask(input).notes.length, 1000)
  assert.throws(() => normalizeTask(task({ title: '名'.repeat(121) })), /120/)
  const old = task({ notes: '备'.repeat(1001) })
  assert.throws(() => normalizeTask(old), /1000/)
  assert.equal(old.notes.length, 1001)
  assert.throws(() => normalizeTask(task({ title: 123 })), /事项名称/)
})

test('分类与设置严格提交，所有失败操作不污染缓存、磁盘或新建输入', () => {
  store.setSetting('customSetting', { enabled: true })
  const category = { name: '独立分类', color: '#123456' }
  store.saveCategory(category)
  const parent = store.saveTask(task({ categoryId: category.id }))
  const before = structuredClone(load())
  const diskBefore = structuredClone(disk)
  const draft = { name: '未落盘分类' }
  fail = true
  try {
    for (const action of [
      () => store.saveCategory(draft),
      () => store.saveCategory({ id: category.id, name: '不会生效' }),
      () => store.reorderCategories(store.getCategories().map(item => item.id).reverse()),
      () => store.removeCategory(category.id),
      () => store.setSetting('hideCompleted', false),
      () => store.toggleGroupCollapsed('今天')
    ]) {
      assert.throws(action, /无法/)
      assert.deepEqual(load(), before)
      assert.deepEqual(disk, diskBefore)
    }
    assert.deepEqual(draft, { name: '未落盘分类' })
  } finally { fail = false }
  store.toggleGroupCollapsed('今天')
  assert.deepEqual(store.getSettings().customSetting, { enabled: true })
  store.removeCategory(category.id)
  assert.equal(store.findTask(parent.id).categoryId, null)
  assert.equal(disk.tasks.find(item => item.id === parent.id).categoryId, null)
})

test('子项状态原子保存与父项汇总，保留旧字段、完成时间与排序', async () => {
  const parent = store.saveTask(task(), [{ title: '甲' }, { title: '乙' }])
  const original = store.listChildren(parent.id)
  const enriched = { ...original[0], notes: '旧备注', custom: { keep: true }, createdAt: 7, status: 'done', completedAt: 123 }
  saveStorage({ ...load(), tasks: load().tasks.map(item => item.id === enriched.id ? enriched : item) }, { strict: true })
  const count = writes
  const result = store.saveTask({ id: parent.id, title: '修改父项' }, [
    { id: original[1].id, title: '乙', status: 'done' },
    { id: original[0].id, title: '甲改名', status: 'done' }
  ])
  assert.equal(writes, count + 1)
  assert.equal(result.status, 'done')
  const children = store.listChildren(parent.id)
  assert.deepEqual(children.map(item => item.sortOrder), [0, 1])
  assert.equal(children[1].completedAt, 123)
  assert.equal(children[1].createdAt, 7)
  assert.equal(children[1].notes, '旧备注')
  assert.deepEqual(children[1].custom, { keep: true })
  assert.equal(children[0].completedAt, result.completedAt)
  assert.ok(result.reminderPromise instanceof Promise)
  await result.reminderPromise
  assert.equal(Object.keys(result).includes('reminderPromise'), false)
  assert.equal('reminderPromise' in store.findTask(parent.id), false)
  const reopened = store.saveTask({ id: parent.id }, children.map(item => ({ id: item.id, title: item.title, status: item.id === children[1].id ? 'todo' : 'done' })))
  assert.equal(reopened.status, 'todo')
  assert.equal(reopened.completedAt, null)
  assert.equal(store.listChildren(parent.id)[1].completedAt, null)
  const before = structuredClone(load())
  assert.throws(() => store.saveTask({ id: parent.id }, [{ title: '子项', status: 'failed' }]), /子事项状态/)
  assert.throws(() => store.saveTask({ id: parent.id }, [{ title: '超'.repeat(121) }]), /120/)
  assert.deepEqual(load(), before)
})

test('零子项、失败、重复源和嵌套子项不汇总父状态', () => {
  const empty = store.saveTask(task({ status: 'done', completedAt: 17 }), [])
  assert.equal(empty.status, 'done')
  assert.equal(empty.completedAt, 17)
  for (const patch of [{ status: 'failed' }, { repeatRule: '{"kind":"daily"}' }, { parentTaskId: empty.id }]) {
    const parent = store.saveTask(task(patch), [{ title: '全部完成', status: 'done' }])
    assert.equal(parent.status, patch.status || 'todo')
  }
})

test('完成及恢复级联直属子项，失败不级联，完成和更新时间一致', async () => {
  const parent = store.saveTask(task(), [{ title: '直属甲' }, { title: '直属乙' }])
  const direct = store.listChildren(parent.id)
  const nested = store.saveTask(task({ parentTaskId: direct[0].id }))
  let count = writes
  await store.setTaskStatus(parent.id, 'done')
  assert.equal(writes, count + 1)
  const done = store.findTask(parent.id)
  for (const child of store.listChildren(parent.id)) {
    assert.equal(child.status, 'done')
    assert.equal(child.completedAt, done.completedAt)
    assert.equal(child.updatedAt, done.updatedAt)
  }
  assert.equal(store.findTask(nested.id).status, 'todo')
  const completedChildren = structuredClone(store.listChildren(parent.id))
  await store.setTaskStatus(parent.id, 'failed')
  assert.equal(store.findTask(parent.id).completedAt, null)
  assert.deepEqual(store.listChildren(parent.id), completedChildren)
  count = writes
  await store.setTaskStatus(parent.id, 'todo')
  assert.equal(writes, count + 1)
  const reopened = store.findTask(parent.id)
  for (const child of store.listChildren(parent.id)) {
    assert.equal(child.status, 'todo')
    assert.equal(child.completedAt, null)
    assert.equal(child.updatedAt, reopened.updatedAt)
  }
})

test('编辑加显式状态只写一次，显式完成及恢复覆盖子项汇总，失败不级联', async () => {
  const parent = store.saveTask(task(), [{ title: '子事项' }])
  const child = store.listChildren(parent.id)[0]
  let count = writes
  const saved = store.saveTask({ id: parent.id, title: '编辑并完成' }, [{ id: child.id, title: '编辑子项', status: 'todo' }], { status: 'done' })
  await saved.reminderPromise
  assert.equal(writes, count + 1)
  assert.equal(saved.title, '编辑并完成')
  assert.equal(saved.status, 'done')
  assert.equal(store.listChildren(parent.id)[0].completedAt, saved.completedAt)
  const reopened = store.saveTask({ id: parent.id }, [{ id: child.id, title: '编辑子项', status: 'done' }], { status: 'todo' })
  assert.equal(reopened.status, 'todo')
  assert.equal(store.listChildren(parent.id)[0].status, 'todo')
  count = writes
  store.saveTask({ id: parent.id }, [{ id: child.id, title: '已完成子项', status: 'done' }], { status: 'failed' })
  assert.equal(writes, count + 1)
  assert.equal(store.findTask(parent.id).status, 'failed')
  assert.equal(store.listChildren(parent.id)[0].status, 'done')
  const before = structuredClone(load())
  const diskBefore = structuredClone(disk)
  fail = true
  try {
    assert.throws(() => store.saveTask({ id: parent.id, title: '失败草稿' }, [], { status: 'done' }), /无法保存/)
    assert.throws(() => store.setTaskStatus(parent.id, 'todo'), /无法保存/)
    assert.deepEqual(load(), before)
    assert.deepEqual(disk, diskBefore)
  } finally { fail = false }
})

test('重复实例传子项不改源子项，编辑及状态只写当次覆盖并保存快照', async () => {
  const source = store.saveTask(task({ repeatRule: '{"kind":"daily"}' }), [{ title: '源子项' }])
  const children = structuredClone(store.listChildren(source.id))
  const id = `${source.id}@2026-10-11`
  const count = writes
  const instance = store.saveTask({ id, title: '当次草稿', plannedDate: '2026-10-12' }, [{ title: '不得写源', status: 'done' }], { status: 'done' })
  await instance.reminderPromise
  assert.equal(writes, count + 1)
  assert.equal(instance.status, 'done')
  assert.equal(instance.title, '当次草稿')
  assert.equal(instance.completedAt, instance.updatedAt)
  assert.equal(store.findTask(source.id).status, 'todo')
  assert.deepEqual(store.listChildren(source.id), children)
  assert.equal(store.findTask(`${source.id}@2026-10-12`).status, 'todo')
  await store.setTaskStatus(id, 'todo')
  assert.equal(store.findTask(id).completedAt, null)
  assert.equal(store.findTask(id).plannedDate, '2026-10-12')
  await store.setTaskStatus(id, 'failed')
  assert.equal(store.findTask(id).status, 'failed')
  assert.deepEqual(store.listChildren(source.id), children)
  await store.setTaskStatus(source.id, 'done')
  assert.deepEqual(store.listChildren(source.id), children)
})

test('事项快照比较真实落盘版本、全部相关子树及同时间戳内容', () => {
  const parent = store.saveTask(task(), [{ title: '子项' }])
  const child = store.listChildren(parent.id)[0]
  const grandchild = store.saveTask(task({ title: '孙项', parentTaskId: child.id }))
  const snapshot = store.getTaskSnapshot(parent.id)
  const first = store.saveTask({ id: parent.id, notes: '第一轮' }, store.listChildren(parent.id), { expectedSnapshot: snapshot })
  assert.deepEqual(first.taskSnapshot, store.getTaskSnapshot(parent.id))
  const second = store.saveTask({ id: parent.id, notes: '第二轮' }, store.listChildren(parent.id), { expectedSnapshot: first.taskSnapshot })
  assert.deepEqual(second.taskSnapshot, store.getTaskSnapshot(parent.id))
  const data = load()
  saveStorage({ ...data, tasks: data.tasks.map(item => item.id === grandchild.id ? { ...item, title: '云端孙项' } : item) }, { strict: true, remote: true })
  const before = structuredClone(load())
  assert.throws(() => store.removeTask(parent.id, { expectedSnapshot: second.taskSnapshot }), /更改或删除/)
  assert.throws(() => store.saveTask({ id: parent.id, notes: '过期' }, store.listChildren(parent.id), { expectedSnapshot: second.taskSnapshot }), /更改或删除/)
  assert.deepEqual(load(), before)
  const current = store.getTaskSnapshot(parent.id)
  const data2 = load()
  saveStorage({ ...data2, tasks: data2.tasks.map(item => item.id === parent.id ? { ...item, notes: '同版本不同内容' } : item) }, { strict: true, remote: true })
  assert.throws(() => store.saveTask({ id: parent.id }, undefined, { expectedSnapshot: current }), /更改或删除/)
  const beforeDelete = store.getTaskSnapshot(parent.id)
  const data3 = load()
  saveStorage({ ...data3, tasks: data3.tasks.map(item => item.id === parent.id ? { ...item, deletedAt: 42 } : item) }, { strict: true, remote: true })
  assert.throws(() => store.saveTask({ id: parent.id }, undefined, { expectedSnapshot: beforeDelete }), /更改或删除/)
})

test('重复当次比较当前实例及源字段，其他实例修改不造成冲突或丢失', () => {
  const source = store.saveTask(task({ repeatRule: '{"kind":"daily"}' }))
  const id = `${source.id}@2026-10-11`
  const other = `${source.id}@2026-10-12`
  let snapshot = store.getTaskSnapshot(id)
  store.saveTask({ id: other, notes: '其他实例' })
  const saved = store.saveTask({ id, notes: '当前实例' }, undefined, { expectedSnapshot: snapshot })
  assert.equal(store.findTask(other).notes, '其他实例')
  snapshot = saved.taskSnapshot
  store.saveTask({ id, notes: '同实例外部修改' })
  assert.throws(() => store.saveTask({ id, notes: '旧草稿' }, undefined, { expectedSnapshot: snapshot }), /更改或删除/)
  assert.throws(() => store.removeTask(id, { expectedSnapshot: snapshot }), /更改或删除/)
  snapshot = store.getTaskSnapshot(id)
  store.saveTask({ id: source.id, title: '源被修改' })
  assert.throws(() => store.saveTask({ id, notes: '旧草稿' }, undefined, { expectedSnapshot: snapshot }), /更改或删除/)
  snapshot = store.getTaskSnapshot(id)
  store.removeTask(id)
  assert.throws(() => store.saveTask({ id, notes: '旧草稿' }, undefined, { expectedSnapshot: snapshot }), /更改或删除/)
})

test('从待办变完成不沿用旧的残留完成时间，连续保存完成态保留时间', () => {
  const parent = store.saveTask(task({ completedAt: 1 }), [{ title: '子事项' }])
  const child = store.listChildren(parent.id)[0]
  saveStorage({ ...load(), tasks: load().tasks.map(item => item.id === child.id ? { ...item, completedAt: 2 } : item) }, { strict: true })
  const saved = store.saveTask({ id: parent.id }, [{ id: child.id, title: child.title, status: 'done' }])
  assert.equal(saved.completedAt, saved.updatedAt)
  assert.equal(store.listChildren(parent.id)[0].completedAt, saved.completedAt)
  const again = store.saveTask({ id: parent.id }, [{ id: child.id, title: child.title, status: 'done' }])
  assert.equal(again.completedAt, saved.completedAt)
  assert.equal(store.listChildren(parent.id)[0].completedAt, saved.completedAt)
})

test('子项 id 不得覆盖其他事项，不接受重复 id', () => {
  const parent = store.saveTask(task(), [{ title: '所属子项' }])
  const other = store.saveTask(task())
  const child = store.listChildren(parent.id)[0]
  const before = structuredClone(load())
  assert.throws(() => store.saveTask({ id: parent.id }, [{ id: other.id, title: '抢占' }]), /子事项数据无效/)
  assert.throws(() => store.saveTask({ id: parent.id }, [{ id: child.id, title: '甲' }, { id: child.id, title: '乙' }]), /子事项数据无效/)
  assert.deepEqual(load(), before)
})

test('双视图独立过滤、重复源保留、严格失败不改任一偏好', async () => {
  const before = load()
  saveStorage({ ...before, tasks: [], settings: { ...before.settings, hideCompleted: true, hideCompletedByView: { tasks: false, month: true, future: false } } }, { strict: true })
  try {
    const ordinary = store.saveTask(task({ status: 'done' }))
    const repeat = store.saveTask(task({ status: 'done', repeatRule: '{"kind":"daily"}' }))
    assert.equal(store.tasksForDate('2026-10-10').some(item => item.id === ordinary.id), false)
    assert.ok(store.tasksGrouped().flatMap(group => group.items).some(item => item.id === ordinary.id))
    store.setHideCompleted('tasks', true)
    assert.equal(store.getHideCompleted('month'), true)
    const groups = store.tasksGrouped().flatMap(group => group.items)
    assert.equal(groups.some(item => item.id === ordinary.id), false)
    assert.ok(groups.some(item => item.id === repeat.id))
    store.setHideCompleted('month', false)
    assert.ok(store.tasksForDate('2026-10-10').some(item => item.id === ordinary.id))
    assert.deepEqual(store.getSettings().hideCompletedByView, { tasks: true, month: false, future: false })
    const snapshot = structuredClone(load())
    const diskBefore = structuredClone(disk)
    fail = true
    assert.throws(() => store.setHideCompleted('tasks', false), /无法保存/)
    assert.deepEqual(load(), snapshot)
    assert.deepEqual(disk, diskBefore)
  } finally { fail = false; saveStorage(before, { strict: true }) }
})

test('新建默认值区分缺省与null、失效分类、非法优先级及空分类', () => {
  const before = load()
  try {
    const categories = [{ id: 'first' }, { id: 'second' }]
    const cases = [
      [undefined, 'first', 'not_urgent_not_important'],
      [{ categoryId: null, priority: 'urgent_important' }, null, 'urgent_important'],
      [{ categoryId: 'second', priority: 'important_not_urgent' }, 'second', 'important_not_urgent'],
      [{ categoryId: 'deleted', priority: 'invalid' }, 'first', 'not_urgent_not_important'],
      [{ priority: false }, 'first', 'not_urgent_not_important']
    ]
    for (const [defaults, categoryId, priority] of cases) {
      saveStorage({ ...before, categories, settings: { ...before.settings, newTaskDefaults: defaults } }, { strict: true })
      assert.deepEqual(store.getNewTaskDefaults(), { categoryId, priority })
    }
    saveStorage({ ...before, categories: [], settings: {} }, { strict: true })
    assert.deepEqual(store.getNewTaskDefaults(), { categoryId: null, priority: 'not_urgent_not_important' })
  } finally { saveStorage(before, { strict: true }) }
})

test('规范化的新建记忆和父子状态仅写一次，旧编辑不记忆，失败全部不变，提醒失败保留落盘', async () => {
  const before = load()
  try {
    let count = writes
    const created = store.saveTask(task({ title: '  新建  ', categoryId: null, priority: 'urgent_important' }), [{ title: '子项' }], { rememberDefaults: true, status: 'done' })
    await created.reminderPromise
    assert.equal(writes, count + 1)
    assert.equal(created.title, '新建')
    assert.equal(created.status, 'done')
    assert.equal(store.listChildren(created.id)[0].status, 'done')
    assert.deepEqual(store.getNewTaskDefaults(), { categoryId: null, priority: 'urgent_important' })
    store.saveTask({ id: created.id, priority: 'important_not_urgent' }, undefined, { rememberDefaults: true })
    assert.equal(store.getNewTaskDefaults().priority, 'important_not_urgent')
    store.saveTask({ id: created.id, priority: 'urgent_not_important' })
    assert.equal(store.getNewTaskDefaults().priority, 'important_not_urgent')
    const snapshot = structuredClone(load())
    const diskBefore = structuredClone(disk)
    fail = true
    try {
      assert.throws(() => store.saveTask(task({ priority: 'urgent_important' }), [{ title: '子项' }], { rememberDefaults: true, status: 'done' }), /无法保存/)
      assert.deepEqual(load(), snapshot)
      assert.deepEqual(disk, diskBefore)
    } finally { fail = false }
    globalThis.plus = { os: { name: 'Android' }, android: { runtimeMainActivity: () => ({}), invoke: () => { throw Error('排程失败') } } }
    count = writes
    const saved = store.saveTask(task({ priority: 'urgent_important' }), [], { rememberDefaults: true })
    const result = await saved.reminderPromise
    assert.ok(result.error)
    assert.equal(writes, count + 1)
    assert.ok(store.findTask(saved.id))
    assert.equal(store.getNewTaskDefaults().priority, 'urgent_important')
    assert.deepEqual(disk.settings.newTaskDefaults, load().settings.newTaskDefaults)
  } finally { fail = false; delete globalThis.plus; saveStorage(before, { strict: true }) }
})

test('返回权限设置后读取新权限，不被上轮排程结果覆盖', async () => {
  let allowed = false
  globalThis.plus = { os: { name: 'Android' }, android: { runtimeMainActivity: () => ({}), invoke: (_, method) => JSON.stringify(method === 'state' ? { supported: true, notifications: allowed, exactAlarm: allowed } : { supported: true, notifications: false, exactAlarm: false, scheduled: 0 }) } }
  await syncTaskReminders([])
  allowed = true
  assert.equal(reminderState().notifications, true)
  assert.equal(reminderState().exactAlarm, true)
  delete globalThis.plus
})

test('周日期以周一为起始，跨月与跨年标题可读', () => {
  assert.deepEqual(weekDates('2026-10-01'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  assert.equal(weekDates('2026-10-04')[0], '2026-09-28')
  assert.deepEqual(weekDates('2027-01-01'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
  assert.equal(weekTitle(weekDates('2026-10-05')), '2026年10月5日 – 11日')
  assert.equal(weekTitle(weekDates('2026-10-01')), '2026年9月28日 – 10月4日')
  assert.equal(weekTitle(weekDates('2027-01-01')), '2026年12月28日 – 2027年1月3日')
})

test('快捷改期改分类：普通事项更新自身，实例只写当次覆盖并刷新目标日期', async () => {
  const category = store.saveCategory({ name: '快捷调整', color: '#123456' })
  const plain = store.saveTask(task())
  const moved = store.saveTask({ id: plain.id, plannedDate: '2026-10-20', categoryId: category.id })
  await moved.reminderPromise
  assert.equal(store.findTask(plain.id).plannedDate, '2026-10-20')
  assert.equal(store.findTask(plain.id).categoryId, category.id)
  assert.equal(store.findTask(plain.id).title, '测试事项')

  const source = store.saveTask(task({ repeatRule: '{"kind":"daily"}', plannedDate: '2026-10-01' }))
  const id = `${source.id}@2026-10-05`
  const instance = store.saveTask({ id, plannedDate: '2026-10-20', categoryId: category.id })
  await instance.reminderPromise
  assert.equal(store.findTask(source.id).plannedDate, '2026-10-01')
  assert.equal(store.findTask(source.id).categoryId, null)
  assert.equal(store.tasksForDate('2026-10-05').some(item => item.id === id), false)
  const target = store.tasksForDate('2026-10-20').find(item => item.id === id)
  assert.ok(target)
  assert.equal(target.plannedDate, '2026-10-20')
  assert.equal(target.categoryId, category.id)
  assert.equal(target.status, 'todo')
  const override = JSON.parse(store.findTask(source.id).occurrenceOverrides)['2026-10-05']
  assert.equal(override.plannedDate, '2026-10-20')
  assert.equal(override.categoryId, category.id)
  assert.ok(store.tasksForDate('2026-10-06').some(item => item.id === `${source.id}@2026-10-06`))
})

test('重复源改分类影响后续规则，已有当次覆盖保留自身分类与日期', () => {
  const source = store.saveTask(task({ repeatRule: '{"kind":"weekly"}', plannedDate: '2026-10-01' }))
  const overrideId = `${source.id}@2026-10-08`
  store.saveTask({ id: overrideId, notes: '当次备注' })
  const category = store.saveCategory({ name: '系列分类', color: '#654321' })
  store.saveTask({ id: source.id, categoryId: category.id })
  assert.equal(store.findTask(source.id).categoryId, category.id)
  const kept = store.tasksForDate('2026-10-08').find(item => item.id === overrideId)
  assert.equal(kept.categoryId, null)
  const next = store.tasksForDate('2026-10-15').find(item => item.id === `${source.id}@2026-10-15`)
  assert.equal(next.categoryId, category.id)
})

test('快捷调整写入失败不污染缓存、磁盘且不触发提醒排程', async () => {
  const calls = []
  globalThis.plus = { os: { name: 'Android' }, android: { runtimeMainActivity: () => ({}), invoke: (_, method, context, snapshot) => { calls.push(snapshot); return '{"supported":true}' } } }
  const item = store.saveTask(task())
  await item.reminderPromise
  await syncTaskReminders(store.listTasks())
  const before = structuredClone(load())
  const diskBefore = structuredClone(disk)
  const count = calls.length
  fail = true
  try {
    assert.throws(() => store.saveTask({ id: item.id, plannedDate: '2026-12-01', categoryId: null }), /无法保存/)
  } finally { fail = false; delete globalThis.plus }
  assert.deepEqual(load(), before)
  assert.deepEqual(disk, diskBefore)
  assert.equal(calls.length, count)
})

async function anniversarySheet(name, { initialProps, storeApi } = {}) {
  const source = (await readFile(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const isEdit = name === 'AnniversaryEditSheet'
  const props = vue.reactive(initialProps || (isEdit ? { visible: true, item: null } : { occurrence: { anniversaryId: 'a', date: '2026-01-01', notes: '', record: { notes: '原备注' } }, today: '2026-10-10' }))
  const events = []
  const modals = []
  const navigation = []
  const unmount = []
  let failSave = false
  let photoResolve
  const context = vm.createContext({
    defineProps: () => props, defineEmits: () => (...event) => events.push(event), defineExpose() {},
    uni: { showModal: options => modals.push(options), navigateTo: options => navigation.push(options.url) }
  })
  const modules = {
    vue: { ...vue, onBeforeUnmount: callback => unmount.push(callback) },
    '../api/store': storeApi || {
      getAnniversaryRecordSnapshot: (_id, _date, record) => record ? JSON.parse(JSON.stringify(record)) : null,
      saveAnniversary: (input, _options) => { if (failSave) throw Error('写入失败'); return { ...input, id: 'saved' } },
      saveAnniversaryRecord: (input, _options) => { if (failSave) throw Error('写入失败'); return { ...input, notes: input.notes.trim() } }
    },
    '../utils/anniversary': { anniversaryThemes: [], anniversaryTypes: [], localToday: () => '2026-10-10', anniversaryCalendar: () => ({}), chooseAnniversaryPhoto: () => new Promise(resolve => { photoResolve = resolve }) },
    '../../../shared/anniversary.mjs': { anniversaryRecordOccurrence: record => record }
  }
  const exported = isEdit ? 'draft, close, submit, importPhoto, error' : 'notes, close, details, save, error'
  const module = new vm.SourceTextModule(`${source}\nexport { ${exported} };`, { context })
  await module.link(specifier => new vm.SyntheticModule(Object.keys(modules[specifier]), function () {
    for (const [key, value] of Object.entries(modules[specifier])) this.setExport(key, value)
  }, { context }))
  await module.evaluate()
  return { ...module.namespace, props, events, modals, navigation, unmount: () => unmount.forEach(callback => callback()), setFailure: value => { failSave = value }, releasePhoto: value => photoResolve(value) }
}

test('纪念日编辑取消和遮罩共享草稿确认，失败、保存及重复请求安全', async () => {
  const ui = await anniversarySheet('AnniversaryEditSheet')
  ui.draft.title = '保留输入'
  const first = ui.close()
  await ui.close()
  assert.equal(ui.modals.length, 1)
  ui.modals[0].success({ confirm: false })
  assert.equal(await first, false)
  assert.equal(ui.draft.title, '保留输入')
  assert.equal(ui.events.length, 0)
  const failed = ui.close()
  ui.modals[1].fail(Error('窗口失败'))
  assert.equal(await failed, false)
  assert.match(ui.error.value, /重试/)
  ui.setFailure(true)
  ui.submit()
  assert.match(ui.error.value, /写入失败/)
  assert.equal(ui.draft.title, '保留输入')
  ui.setFailure(false)
  ui.submit()
  assert.equal(ui.events[0][0], 'saved')
  assert.equal(await ui.close(), true)
  assert.equal(ui.modals.length, 2)
  assert.equal(ui.events.at(-1)[0], 'close')
  ui.unmount()
})

test('纪念记录关闭和详情须确认，保存更新基线，失败保留输入', async () => {
  const ui = await anniversarySheet('AnniversaryRecordSheet')
  ui.notes.value = '新的备注'
  let leaving = ui.details()
  await ui.close()
  assert.equal(ui.modals.length, 1)
  ui.modals[0].success({ confirm: false })
  assert.equal(await leaving, false)
  assert.equal(ui.notes.value, '新的备注')
  assert.equal(ui.navigation.length, 0)
  ui.setFailure(true)
  ui.save(false)
  assert.match(ui.error.value, /写入失败/)
  leaving = ui.close()
  ui.modals[1].success({ confirm: false })
  await leaving
  ui.setFailure(false)
  ui.save(false)
  assert.equal(await ui.details(), true)
  assert.equal(ui.modals.length, 2)
  assert.equal(ui.events.at(-1)[0], 'close')
  assert.equal(ui.navigation[0], '/pages/anniversaries/detail?id=a')
  ui.unmount()
})

test('确认放弃后才关闭或导航，旧会话与卸载后的确认不能影响新草稿', async () => {
  const edit = await anniversarySheet('AnniversaryEditSheet')
  edit.draft.photos.push('照片')
  let pending = edit.close()
  edit.props.visible = false
  edit.props.visible = true
  edit.draft.title = '新会话'
  edit.modals[0].success({ confirm: true })
  assert.equal(await pending, false)
  assert.equal(edit.draft.title, '新会话')
  assert.equal(edit.events.length, 0)
  pending = edit.close()
  edit.modals[1].success({ confirm: true })
  assert.equal(await pending, true)
  assert.equal(edit.events.at(-1)[0], 'close')
  edit.unmount()

  const switched = await anniversarySheet('AnniversaryEditSheet')
  switched.draft.title = '旧条目'
  pending = switched.close()
  switched.props.item = { id: 'other', title: '另一条' }
  switched.modals[0].success({ confirm: true })
  assert.equal(await pending, false)
  assert.equal(switched.draft.title, '另一条')
  assert.equal(switched.events.length, 0)
  switched.unmount()

  const record = await anniversarySheet('AnniversaryRecordSheet')
  record.notes.value = '旧草稿'
  pending = record.details()
  record.props.occurrence = { anniversaryId: 'b', date: '2026-01-02', record: { notes: '新草稿' } }
  record.modals[0].success({ confirm: true })
  assert.equal(await pending, false)
  assert.equal(record.notes.value, '新草稿')
  assert.equal(record.navigation.length, 0)
  record.notes.value = '修改'
  pending = record.details()
  record.unmount()
  record.modals[1].success({ confirm: true })
  assert.equal(await pending, false)
  assert.equal(record.events.length, 0)
  assert.equal(record.navigation.length, 0)
})

test('照片导入与确认期间的后续编辑不会被旧操作丢弃', async () => {
  const ui = await anniversarySheet('AnniversaryEditSheet')
  const photo = ui.importPhoto()
  ui.props.visible = false
  ui.props.visible = true
  ui.releasePhoto('旧照片')
  await photo
  assert.equal(ui.draft.photos.length, 0)
  ui.draft.notes = '第一版'
  const pending = ui.close()
  ui.draft.notes = '第二版'
  ui.modals[0].success({ confirm: true })
  assert.equal(await pending, false)
  assert.equal(ui.draft.notes, '第二版')
  assert.equal(ui.events.length, 0)
  ui.unmount()
})

test('纪念日编辑连续保存使用落盘基线，失败和异设备冲突保留草稿与照片', async () => {
  const created = store.saveAnniversary({ kind: 'anniversary', title: '初始纪念日', date: '2000-01-01', notes: '', theme: 'sky', photos: [], coverIndex: 0 })
  const ui = await anniversarySheet('AnniversaryEditSheet', { initialProps: { visible: true, item: store.getAnniversary(created.id) }, storeApi: store })
  try {
    ui.draft.title = '第一次'
    ui.submit()
    assert.equal(ui.events.length, 1)
    assert.deepEqual(ui.events[0][1], store.getAnniversary(created.id))
    ui.draft.notes = '第二次'
    ui.submit()
    assert.equal(ui.events.length, 2)
    assert.equal(store.getAnniversary(created.id).notes, '第二次')
    ui.draft.notes = '失败草稿'
    const before = structuredClone(load())
    const diskBefore = structuredClone(disk)
    fail = true
    ui.submit()
    fail = false
    assert.match(ui.error.value, /无法保存/)
    assert.equal(ui.draft.notes, '失败草稿')
    assert.deepEqual(load(), before)
    assert.deepEqual(disk, diskBefore)
    ui.submit()
    assert.equal(ui.events.length, 3)
    const current = store.getAnniversary(created.id)
    const remote = { ...current, photos: ['云端照片'], deviceId: 'other-device' }
    saveStorage({ ...load(), anniversaries: load().anniversaries.map(item => item.id === created.id ? remote : item) }, { strict: true, remote: true })
    ui.props.item = structuredClone(remote)
    ui.draft.title = '本地草稿'
    ui.submit()
    assert.match(ui.error.value, /更改.*重新打开/)
    assert.equal(ui.events.length, 3)
    assert.equal(ui.draft.title, '本地草稿')
    assert.deepEqual(store.getAnniversary(created.id), remote)
    assert.equal(disk.anniversaries.find(item => item.id === created.id).photos[0], '云端照片')
    const sameVersion = { ...remote, title: '同版本不同内容' }
    saveStorage({ ...load(), anniversaries: load().anniversaries.map(item => item.id === created.id ? sameVersion : item) }, { strict: true, remote: true })
    assert.throws(() => store.saveAnniversary({ ...current, title: '草稿' }, { expectedSnapshot: remote }), /更改/)
    assert.deepEqual(store.getAnniversary(created.id), sameVersion)
  } finally { fail = false; ui.unmount() }
})

test('纪念记录连续保存、失败重试及同时间戳异设备更新不丢备注', async () => {
  const item = store.saveAnniversary({ kind: 'anniversary', title: '记录测试', date: '2000-01-01', notes: '', theme: 'sky', photos: [], coverIndex: 0 })
  const date = '2001-01-01'
  const initial = store.saveAnniversaryRecord({ anniversaryId: item.id, date, notes: '初始', confirmed: false })
  const occurrence = { anniversaryId: item.id, date, notes: '', record: initial }
  const ui = await anniversarySheet('AnniversaryRecordSheet', { initialProps: { occurrence, today: '2026-10-10' }, storeApi: store })
  try {
    ui.notes.value = '第一次'
    ui.save(true)
    assert.equal(ui.events.length, 1)
    assert.deepEqual(ui.events[0][1], store.listAnniversaryRecords({ anniversaryId: item.id })[0])
    ui.notes.value = '第二次'
    ui.save(true)
    assert.equal(ui.events.length, 2)
    const before = structuredClone(load())
    const diskBefore = structuredClone(disk)
    ui.notes.value = '失败后保留'
    fail = true
    ui.save(false)
    fail = false
    assert.match(ui.error.value, /无法保存/)
    assert.equal(ui.notes.value, '失败后保留')
    assert.deepEqual(load(), before)
    assert.deepEqual(disk, diskBefore)
    ui.save(true)
    assert.equal(ui.events.length, 3)
    const current = store.listAnniversaryRecords({ anniversaryId: item.id })[0]
    const remote = { ...current, title: '异设备更新', confirmedAt: null, deviceId: 'other-device' }
    saveStorage({ ...load(), anniversaryRecords: load().anniversaryRecords.map(record => record.anniversaryId === item.id && record.date === date ? remote : record) }, { strict: true, remote: true })
    ui.notes.value = '本地未保存备注'
    ui.props.occurrence = { ...occurrence, record: remote }
    assert.equal(ui.notes.value, '本地未保存备注')
    ui.save(true)
    assert.match(ui.error.value, /更改.*重新打开/)
    assert.equal(ui.notes.value, '本地未保存备注')
    assert.equal(ui.events.length, 3)
    assert.deepEqual(store.listAnniversaryRecords({ anniversaryId: item.id })[0], remote)
    assert.deepEqual(disk.anniversaryRecords.find(record => record.anniversaryId === item.id), remote)
    const sameVersion = { ...remote, notes: '同版本不同内容' }
    saveStorage({ ...load(), anniversaryRecords: load().anniversaryRecords.map(record => record.anniversaryId === item.id ? sameVersion : record) }, { strict: true, remote: true })
    assert.throws(() => store.saveAnniversaryRecord({ anniversaryId: item.id, date, notes: '草稿', confirmed: true }, { expectedSnapshot: remote }), /更改/)
    assert.deepEqual(store.listAnniversaryRecords({ anniversaryId: item.id })[0], sameVersion)
  } finally { fail = false; ui.unmount() }
})

test('无记录时同步新增及墓碑变化均阻止覆盖，兼容未传基线的调用', async () => {
  const item = store.saveAnniversary({ kind: 'anniversary', title: '新增记录测试', date: '2000-01-01', notes: '', theme: 'sky', photos: [], coverIndex: 0 })
  const date = '2002-01-01'
  const occurrence = { anniversaryId: item.id, date, notes: '', record: null }
  const ui = await anniversarySheet('AnniversaryRecordSheet', { initialProps: { occurrence, today: '2026-10-10' }, storeApi: store })
  try {
    ui.notes.value = '本地备注'
    const remote = store.saveAnniversaryRecord({ anniversaryId: item.id, date, notes: '远端记录', confirmed: true })
    ui.save(false)
    assert.match(ui.error.value, /更改.*重新打开/)
    assert.equal(ui.notes.value, '本地备注')
    assert.equal(ui.events.length, 0)
    assert.deepEqual(store.listAnniversaryRecords({ anniversaryId: item.id })[0], remote)
    assert.deepEqual(disk.anniversaryRecords.find(record => record.anniversaryId === item.id), remote)
    const legacy = store.saveAnniversaryRecord({ anniversaryId: item.id, date, notes: '兼容旧调用', confirmed: true })
    assert.equal(legacy.notes, '兼容旧调用')
    const tombstone = { ...legacy, deletedAt: 10 }
    saveStorage({ ...load(), anniversaryRecords: load().anniversaryRecords.map(record => record.anniversaryId === item.id ? tombstone : record) }, { strict: true, remote: true })
    const snapshot = store.getAnniversaryRecordSnapshot(item.id, date, null)
    const changed = { ...tombstone, notes: '墓碑变化' }
    saveStorage({ ...load(), anniversaryRecords: load().anniversaryRecords.map(record => record.anniversaryId === item.id ? changed : record) }, { strict: true, remote: true })
    assert.throws(() => store.saveAnniversaryRecord({ anniversaryId: item.id, date, notes: '本地', confirmed: false }, { expectedSnapshot: snapshot }), /更改/)
    assert.deepEqual(load().anniversaryRecords.find(record => record.anniversaryId === item.id), changed)
  } finally { ui.unmount() }
})

test('列表读取失败不展示空态，规划错误分支保留打开的弹层', async () => {
  const list = await readFile(new URL('../src/pages/anniversaries/index.vue', import.meta.url), 'utf8')
  const planning = await readFile(new URL('../src/pages/planning/index.vue', import.meta.url), 'utf8')
  assert.match(list, /v-if="!error && !visibleItems\.length"/)
  assert.match(list, /@click="refresh">重试读取/)
  assert.match(planning, /<\/template>\s*<QuickAdjustSheet v-if="ready \|\| adjustVisible"/)
  assert.match(planning, /<AnniversaryRecordSheet v-if="ready \|\| activeRecord"/)
})
