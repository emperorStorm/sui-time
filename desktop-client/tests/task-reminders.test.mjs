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
