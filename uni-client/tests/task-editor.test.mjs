import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as vue from 'vue'

const source = (await readFile(new URL('../src/components/TaskEditSheet.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]

async function editor() {
  const props = vue.reactive({ visible: false, task: { id: 'parent' }, presetDate: '' })
  const events = []
  const writes = []
  const callbacks = []
  let fail = false
  let release
  let hold = false
  let confirmed = false
  const parent = { id: 'parent', title: '原名称', notes: '', repeatRule: '{"kind":"none"}', priority: 'not_urgent_not_important' }
  const context = vm.createContext({
    setTimeout, clearTimeout, console,
    window: { addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
    defineProps: () => props,
    defineEmits: () => (...event) => events.push(event),
    defineExpose: () => {},
    uni: { $on() {}, $off() {}, showModal: options => options.success({ confirm: confirmed }) }
  })
  const modules = {
    vue: { ...vue, onBeforeUnmount: callback => callbacks.push(callback) },
    '@dcloudio/uni-app': { onShow() {}, onHide() {} },
    '../api/store': {
      getCategories: () => [], getNewTaskDefaults: () => ({ categoryId: null, priority: 'urgent_important' }), findTask: () => ({ ...parent }), listChildren: () => [],
      saveTask: (input, children, options) => {
        if (fail) throw new Error('写入失败')
        writes.push(JSON.parse(JSON.stringify({ input, children, options })))
        return { ...input, id: 'parent', reminderPromise: hold ? new Promise(resolve => { release = () => resolve({ supported: false }) }) : Promise.resolve({ supported: false }) }
      },
      removeTask() {}
    },
    '../utils/occurrence': { parseOccurrenceId: id => id.includes('@') ? { sourceId: id.split('@')[0], date: id.split('@')[1] } : null, parseRepeatRule: value => JSON.parse(value), repeatLabel: value => value },
    '../utils/task': { applyTaskTime: Object.assign, hasReminderTime: () => false, priorities: [], reminderOptions: [] },
    '../utils/date': { todayString: () => '2026-10-27' },
    '../api/reminders': { reminderState: () => ({ supported: false }), sendReminderTest() {} },
    '../api/android': { androidSettings() {}, requestNotificationPermission() {} },
    '../utils/platform': { toast() {} }
  }
  const module = new vm.SourceTextModule(`${source}\nexport { draft, flushDraft, requestClose, changeStatus, dirty, error };`, { context })
  await module.link(specifier => {
    const exports = modules[specifier]
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  props.visible = true
  await vue.nextTick()
  return {
    ...module.namespace, props, writes, events,
    setFailure: value => { fail = value },
    setHold: value => { hold = value },
    setConfirmed: value => { confirmed = value },
    release: () => release(),
    close: () => { props.visible = false; callbacks.forEach(callback => callback()) }
  }
}

test('新建首次获ID后队列仍记忆，快速重开旧事项不串新建标记', async () => {
  const ui = await editor()
  try {
    ui.props.visible = false
    await vue.nextTick()
    ui.props.task = null
    ui.props.visible = true
    await vue.nextTick()
    assert.equal(ui.draft.categoryId, null)
    assert.equal(ui.draft.priority, 'urgent_important')
    ui.setHold(true)
    ui.draft.title = '新建第一版'
    const saving = ui.flushDraft(true)
    assert.equal(ui.draft.id, 'parent', ui.error.value)
    ui.draft.priority = 'important_not_urgent'
    ui.setHold(false)
    ui.release()
    assert.equal(await saving, true)
    assert.deepEqual(ui.writes.map(write => write.options.rememberDefaults), [true, true])
    assert.equal(ui.writes.at(-1).input.priority, 'important_not_urgent')
    await ui.changeStatus('done')
    assert.equal(ui.writes.at(-1).options.rememberDefaults, true)
    assert.equal(ui.writes.at(-1).options.status, 'done')
    ui.props.visible = false
    await vue.nextTick()
    ui.props.task = { id: 'parent' }
    ui.props.visible = true
    await vue.nextTick()
    ui.draft.title = '旧编辑'
    await ui.flushDraft(true)
    assert.equal(ui.writes.at(-1).options.rememberDefaults, false)
  } finally { ui.close() }
})

test('旧排程未结束时快速重开，旧会话不覆盖新会话默认值和记忆选项', async () => {
  const ui = await editor()
  try {
    ui.setHold(true)
    ui.draft.title = '旧会话'
    const previous = ui.flushDraft(true)
    ui.props.visible = false
    await vue.nextTick()
    ui.props.task = null
    ui.props.visible = true
    await vue.nextTick()
    ui.draft.title = '新会话'
    const next = ui.flushDraft(true)
    ui.setHold(false)
    ui.release()
    assert.equal(await previous, false)
    assert.equal(await next, true)
    assert.deepEqual(ui.writes.map(write => write.options.rememberDefaults), [false, true])
    assert.equal(ui.writes.at(-1).input.title, '新会话')
    assert.equal(ui.writes.at(-1).input.priority, 'urgent_important')
  } finally { ui.close() }
})

test('保存期间的后续编辑持续排队，完成结果不清掉新修改', async () => {
  const ui = await editor()
  try {
    ui.setHold(true)
    ui.draft.title = '第一版'
    const saving = ui.flushDraft(true)
    ui.draft.title = '第二版'
    assert.equal(ui.dirty.value, true)
    ui.setHold(false)
    ui.release()
    assert.equal(await saving, true)
    assert.deepEqual(ui.writes.map(write => write.input.title), ['第一版', '第二版'])
    assert.equal(ui.dirty.value, false)
  } finally { ui.close() }
})

test('落盘失败阻止关闭并保留输入，重试成功后才关闭', async () => {
  const ui = await editor()
  try {
    ui.draft.notes = '必须保留的备注'
    ui.setFailure(true)
    assert.equal(await ui.requestClose(), false)
    assert.equal(ui.draft.notes, '必须保留的备注')
    assert.match(ui.error.value, /写入失败/)
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
    ui.setFailure(false)
    assert.equal(await ui.requestClose(), true)
    assert.equal(ui.events.at(-1)[0], 'close')
  } finally { ui.close() }
})

test('两子事项完成确认取消不写状态，确认后通过原子保存接口提交', async () => {
  const ui = await editor()
  try {
    ui.draft.subtasks = [{ id: 'a', title: '甲', status: 'todo' }, { id: 'b', title: '乙', status: 'todo' }]
    await ui.changeStatus('done')
    assert.equal(ui.writes.some(write => write.options?.status), false)
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
    ui.setConfirmed(true)
    await ui.changeStatus('done')
    assert.equal(ui.writes.at(-1).options.status, 'done')
    assert.equal(ui.writes.at(-1).children.length, 2)
  } finally { ui.close() }
})

test('当次事项保存不提交源子事项，状态使用同一个单次ID', async () => {
  const ui = await editor()
  try {
    ui.draft.id = 'parent@2026-10-27'
    ui.draft.notes = '当次备注'
    await ui.changeStatus('failed')
    assert.equal(ui.writes.at(-1).input.id, 'parent@2026-10-27')
    assert.equal(ui.writes.at(-1).children, undefined)
    assert.equal(ui.writes.at(-1).options.status, 'failed')
  } finally { ui.close() }
})
