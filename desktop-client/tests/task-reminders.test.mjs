import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const schedulerSource = fs.readFileSync(new URL('../src/composables/use-task-reminders.ts', import.meta.url), 'utf8')
const occurrenceSource = fs.readFileSync(new URL('../src/utils/task-occurrence.ts', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const now = new Date('2026-10-10T12:00:00').getTime()

function loadModule(source, dependencies, globals = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  vm.runInNewContext(output, { exports, require: name => {
    assert.ok(name in dependencies, `未模拟依赖 ${name}`)
    return dependencies[name]
  }, Date, console, ...globals })
  return exports
}

function task(patch = {}) {
  return { id: 'task-1', title: '测试事项', categoryId: null, plannedDate: '2026-10-10', plannedTime: '13:00', plannedEndTime: null, scheduleKind: 'point', priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', occurrenceOverrides: '{}', reminderOffsets: [0], parentTaskId: null, status: 'todo', notes: '', createdAt: now, updatedAt: now, ...patch }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function until(predicate) {
  for (let index = 0; index < 30 && !predicate(); index++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(predicate(), '异步调度未达到预期状态')
}

function fixture(overrides = {}) {
  const writes = []
  const errors = []
  const permissions = []
  const listeners = new Map()
  let tasks = [task()]
  const native = {
    isTauriRuntime: () => true,
    getNativeReminderPermission: async () => ({ status: 'granted' }),
    listTasks: async () => tasks,
    replaceNativeReminders: async requests => { writes.push(['replace', requests]) },
    clearNativeReminders: async () => { writes.push(['clear']) },
    ...overrides
  }
  const target = {
    setInterval: () => 1, clearInterval: () => {},
    addEventListener: (name, handler) => listeners.set(handler, name),
    removeEventListener: (_name, handler) => listeners.delete(handler),
    visibilityState: 'visible'
  }
  class Clock extends Date { static now() { return now } }
  const occurrence = loadModule(occurrenceSource, {}, { Date: Clock })
  const module = loadModule(schedulerSource, {
    '../api/native': native,
    '../utils/task-occurrence': occurrence,
    '@tauri-apps/plugin-notification': { cancelAll: async () => {}, isPermissionGranted: async () => true }
  }, { Date: Clock, window: target, document: target })
  return {
    writes, errors, permissions, listeners,
    setTasks: value => { tasks = value },
    create: userId => module.createTaskReminderScheduler(userId, error => errors.push(error), permission => permissions.push(permission))
  }
}

const recurrence = loadModule(occurrenceSource, {})

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

test('同步读取期间再次保存，只排程最新时间及提醒规则', async () => {
  const reading = deferred()
  let reads = 0
  const f = fixture({ listTasks: async () => ++reads === 1 ? reading.promise : [task({ plannedTime: '14:00', reminderOffsets: [0, 15] })] })
  const scheduler = f.create('user-a')
  scheduler.start()
  await until(() => reads === 1)
  await scheduler.sync()
  await scheduler.sync()
  reading.resolve([task()])
  await until(() => f.writes.length === 1)
  assert.equal(reads, 2)
  assert.deepEqual(Array.from(f.writes[0][1], request => request.triggerAt), [new Date('2026-10-10T13:45:00').getTime(), new Date('2026-10-10T14:00:00').getTime()])
  scheduler.stop()
  await until(() => f.writes.length === 2)
  assert.equal(f.listeners.size, 0)
})

test('正在原生写入时连续保存，完成后补排最新配置', async () => {
  const writing = deferred()
  const writes = []
  const f = fixture({ replaceNativeReminders: async requests => {
    writes.push(requests)
    if (writes.length === 1) await writing.promise
  } })
  const scheduler = f.create('user-a')
  scheduler.start()
  await until(() => writes.length === 1)
  f.setTasks([task({ reminderOffsets: [] })])
  await scheduler.sync()
  writing.resolve()
  await until(() => writes.length === 2)
  assert.equal(writes[1].length, 0)
  scheduler.stop()
  await until(() => f.writes.length === 1)
})

test('登出清理完成后才开始新用户排程，旧结果不能回写', async () => {
  const clearing = deferred()
  const reading = deferred()
  const history = []
  let reads = 0
  const f = fixture({
    listTasks: async () => ++reads === 1 ? reading.promise : [task()],
    clearNativeReminders: async () => { history.push('clear-start'); await clearing.promise; history.push('clear-end') },
    replaceNativeReminders: async requests => { history.push(requests[0].identifier) }
  })
  const old = f.create('old-user')
  old.start()
  await until(() => reads === 1)
  old.stop()
  old.stop()
  const current = f.create('new-user')
  current.start()
  current.start()
  reading.resolve([task()])
  await until(() => history.length === 1)
  assert.equal(reads, 1)
  clearing.resolve()
  await until(() => history.length === 3)
  assert.deepEqual(history.slice(0, 2), ['clear-start', 'clear-end'])
  assert.match(history[2], /^sui-time:new-user:/)
  assert.equal(f.listeners.size, 2)
  current.stop()
  await until(() => history.length === 5)
  assert.equal(f.listeners.size, 0)
})

test('拒绝权限不排程，授权恢复后排程；系统错误可见且后续能重试', async () => {
  let permission = { status: 'denied' }
  const f = fixture({ getNativeReminderPermission: async () => permission })
  const scheduler = f.create('user-a')
  scheduler.start()
  await until(() => f.writes.length === 1)
  assert.equal(f.writes[0][0], 'clear')
  permission = { status: 'granted', detail: '通知声音已关闭' }
  await scheduler.sync()
  assert.equal(f.writes[1][0], 'replace')
  assert.equal(f.permissions.at(-1).detail, '通知声音已关闭')
  permission = { status: 'error', detail: '查询超时' }
  await scheduler.sync()
  assert.deepEqual(f.errors, ['查询超时'])
  permission = { status: 'granted' }
  await scheduler.sync()
  assert.equal(f.writes.at(-1)[0], 'replace')
  scheduler.stop()
  await until(() => f.writes.at(-1)[0] === 'clear')
})

test('只排程未来48小时的未完成父事项，遵守重复实例的时间和提醒覆盖', async () => {
  const f = fixture()
  f.setTasks([
    task({ id: 'off', reminderOffsets: [] }),
    task({ id: 'done', status: 'done' }),
    task({ id: 'failed', status: 'failed' }),
    task({ id: 'child', parentTaskId: 'parent' }),
    task({ id: 'all-day', scheduleKind: 'all_day' }),
    task({ id: 'past', plannedTime: '11:59' }),
    task({ id: 'far', plannedDate: '2026-10-13' }),
    task({ id: 'repeat', repeatRule: '{"kind":"daily"}', occurrenceOverrides: JSON.stringify({ '2026-10-10': { plannedTime: '14:00', reminderOffsets: [15] }, '2026-10-11': { status: 'done' }, '2026-10-12': { plannedTime: '10:00' } }) })
  ])
  const scheduler = f.create('user-a')
  scheduler.start()
  await until(() => f.writes.length === 1)
  const requests = f.writes[0][1]
  assert.equal(requests.length, 2)
  assert.ok(requests.every(request => request.identifier.includes('repeat@')))
  assert.equal(requests[0].triggerAt, new Date('2026-10-10T13:45:00').getTime())
  assert.equal(requests[1].triggerAt, new Date('2026-10-12T10:00:00').getTime())
  scheduler.stop()
  await until(() => f.writes.length === 2)
})

test('首次具体时间默认准时，改时间保留手动关闭和提前提醒，清除后重新默认开启', () => {
  const script = appSource.split('<script setup lang="ts">')[1].split('</script>')[0]
  const ast = ts.createSourceFile('App.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['applyTimeSelection', 'saveReminderSettings', 'toggleReminderEnabled'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n')
  const draft = { plannedDate: null, plannedTime: null, scheduleKind: 'all_day', parentTaskId: null, reminderOffsets: [] }
  const offsets = { value: [] }
  let saves = 0
  let guides = 0
  const context = {
    taskDraft: draft, reminderDraftOffsets: offsets,
    canSetReminder: { get value() { return Boolean(!draft.parentTaskId && draft.plannedDate && draft.plannedTime && draft.scheduleKind !== 'all_day') } },
    reminderEnabled: { get value() { return offsets.value.length > 0 } },
    timeOpen: { value: true }, reminderOpen: { value: true },
    flushTaskDraftSave: () => { saves++ }, refreshReminderPermission: () => { guides++ }
  }
  const module = loadModule(`${declarations}\nexport { applyTimeSelection, saveReminderSettings, toggleReminderEnabled }`, {}, context)
  const timed = { plannedDate: '2026-10-10', plannedTime: '13:00', scheduleKind: 'point' }
  module.applyTimeSelection(timed)
  assert.deepEqual(Array.from(draft.reminderOffsets), [0])
  draft.reminderOffsets = []
  module.applyTimeSelection({ ...timed, plannedTime: '14:00' })
  assert.equal(draft.reminderOffsets.length, 0)
  draft.reminderOffsets = [0, 15]
  module.applyTimeSelection({ ...timed, plannedTime: '15:00', plannedEndTime: '16:00', scheduleKind: 'range' })
  assert.deepEqual(draft.reminderOffsets, [0, 15])
  module.applyTimeSelection({ plannedDate: null, plannedTime: null, scheduleKind: 'all_day' })
  assert.equal(draft.reminderOffsets.length, 0)
  module.applyTimeSelection(timed)
  assert.deepEqual(Array.from(draft.reminderOffsets), [0])
  draft.parentTaskId = 'parent'
  module.applyTimeSelection(timed)
  assert.equal(draft.reminderOffsets.length, 0)
  offsets.value = [0, 15]
  module.saveReminderSettings()
  assert.deepEqual(Array.from(draft.reminderOffsets), [0, 15])
  module.toggleReminderEnabled()
  assert.equal(offsets.value.length, 0)
  module.toggleReminderEnabled()
  assert.deepEqual(Array.from(offsets.value), [0])
  assert.equal(saves, 7)
  assert.equal(guides, 3)
})
