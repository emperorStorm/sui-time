import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as vue from 'vue'
import * as store from '../src/api/store.js'
import * as occurrence from '../src/utils/occurrence.js'

let disk = null
let fail = false
globalThis.uni = {
  getStorageSync: () => disk,
  setStorageSync: (_key, value) => { if (fail) throw new Error('写入失败'); disk = structuredClone(value) }
}
const source = (await readFile(new URL('../src/components/QuickAdjustSheet.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]

async function open(task, storeApi = store) {
  const props = vue.reactive({ visible: false, suspended: false, task, categories: [] })
  const events = []
  const modals = []
  const callbacks = []
  const context = vm.createContext({ defineProps: () => props, defineEmits: () => (...event) => events.push(event), defineExpose() {}, uni: { showModal: options => modals.push(options) } })
  const modules = {
    vue: { ...vue, onBeforeUnmount: callback => callbacks.push(callback) },
    '../api/store': storeApi,
    '../utils/occurrence': occurrence,
    '../utils/platform': { toast() {} },
    '../api/reminders': { reminderSaveMessage: () => '' }
  }
  const module = new vm.SourceTextModule(`${source}\nexport { current, draft, error, confirming, requestClose, save, onBackdrop };`, { context })
  await module.link(specifier => new vm.SyntheticModule(Object.keys(modules[specifier]), function () {
    for (const [key, value] of Object.entries(modules[specifier])) this.setExport(key, value)
  }, { context }))
  await module.evaluate()
  props.visible = true
  await vue.nextTick()
  return { ...module.namespace, props, events, modals, unmount: () => callbacks.forEach(callback => callback()) }
}

function createTask(patch = {}) {
  disk = null
  fail = false
  return store.saveTask({ title: '事项', plannedDate: '2026-10-10', scheduleKind: 'all_day', priority: 'not_urgent_not_important', ...patch })
}

test('挂起保留草稿和错误，恢复后保存；挂起期间动作无效', async () => {
  const task = createTask()
  const ui = await open(task)
  ui.draft.plannedDate = '2026-11-01'
  ui.error.value = '原错误'
  ui.props.suspended = true
  await ui.save()
  assert.equal(await ui.requestClose(), false)
  assert.equal(store.findTask(task.id).plannedDate, '2026-10-10')
  assert.equal(ui.error.value, '原错误')
  ui.props.suspended = false
  assert.equal(ui.draft.plannedDate, '2026-11-01')
  assert.equal(ui.current.value.id, task.id)
  await ui.save()
  assert.equal(store.findTask(task.id).plannedDate, '2026-11-01')
  assert.deepEqual(ui.events.map(event => event[0]), ['saved', 'close'])
  ui.unmount()
})

test('挂起及新会话使旧确认失效，无变更取消直接关闭', async () => {
  const task = createTask()
  const ui = await open(task)
  ui.draft.plannedDate = '2026-11-01'
  const old = ui.requestClose()
  ui.props.suspended = true
  ui.props.suspended = false
  const next = ui.requestClose()
  ui.modals[0].success({ confirm: true })
  assert.equal(await old, false)
  assert.equal(ui.confirming.value, true)
  ui.props.visible = false
  await vue.nextTick()
  ui.props.visible = true
  await vue.nextTick()
  ui.modals[1].success({ confirm: true })
  assert.equal(await next, false)
  assert.equal(ui.events.length, 0)
  assert.equal(await ui.requestClose(), true)
  assert.equal(ui.events.length, 1)
  ui.unmount()
})

for (const change of ['修改', '删除']) {
  test(`恢复后目标被${change}时保留草稿`, async () => {
    const task = createTask()
    const ui = await open(task)
    ui.draft.plannedDate = '2026-11-01'
    ui.props.suspended = true
    if (change === '修改') store.saveTask({ id: task.id, title: '远端修改' })
    else store.removeTask(task.id)
    ui.props.suspended = false
    await ui.save()
    assert.match(ui.error.value, /更改或删除/)
    assert.equal(ui.draft.plannedDate, '2026-11-01')
    assert.equal(ui.events.length, 0)
    ui.unmount()
  })
}

test('重复实例自身发生修改时冲突，其他实例修改不阻止保存', async () => {
  const task = createTask({ repeatRule: JSON.stringify({ kind: 'daily' }) })
  const id = `${task.id}@2026-10-10`
  const ui = await open(store.findTask(id))
  ui.draft.plannedDate = '2026-11-01'
  ui.props.suspended = true
  store.saveTask({ id: `${task.id}@2026-10-11`, title: '另一实例' })
  ui.props.suspended = false
  await ui.save()
  assert.equal(ui.events[0][0], 'saved')
  ui.unmount()
  const second = await open(store.findTask(id))
  second.draft.plannedDate = '2026-11-02'
  second.props.suspended = true
  store.saveTask({ id, title: '同一实例' })
  second.props.suspended = false
  await second.save()
  assert.match(second.error.value, /更改或删除/)
  assert.equal(second.draft.plannedDate, '2026-11-02')
  assert.equal(second.events.length, 0)
  second.unmount()
})

test('打开时读取失败仍可关闭但不能带草稿覆盖事项', async () => {
  const task = createTask()
  const dependencies = { ...store, getTaskSnapshot: () => { throw new Error('快照读取失败') } }
  const ui = await open(task, dependencies)
  ui.draft.plannedDate = '2026-11-01'
  await ui.save()
  assert.match(ui.error.value, /快照读取失败/)
  assert.equal(store.findTask(task.id).plannedDate, '2026-10-10')
  assert.equal(ui.draft.plannedDate, '2026-11-01')
  assert.equal(ui.events.length, 0)
  ui.unmount()
})

test('存储失败保留草稿并允许重试', async () => {
  const task = createTask()
  const ui = await open(task)
  ui.draft.plannedDate = '2026-11-01'
  ui.props.suspended = true
  ui.props.suspended = false
  fail = true
  await ui.save()
  assert.ok(ui.error.value)
  assert.equal(ui.draft.plannedDate, '2026-11-01')
  assert.equal(ui.events.length, 0)
  fail = false
  await ui.save()
  assert.equal(store.findTask(task.id).plannedDate, '2026-11-01')
  ui.unmount()
})
