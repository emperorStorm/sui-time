import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as vue from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as realStore from '../src/api/store.js'
import { load, save as saveStorage } from '../src/api/storage.js'
import { reminderSaveMessage } from '../src/api/reminders.js'

let disk = null
let diskFailure = false
globalThis.uni = { getStorageSync: () => disk, setStorageSync: (_key, value) => { if (diskFailure) throw Error('写入失败'); disk = structuredClone(value) } }

const source = (await readFile(new URL('../src/components/TaskEditSheet.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]

async function editor({ storeApi = null, task = { id: 'parent' }, manualConfirmation = false, repeatRule = '{"kind":"none"}', selectorQuery = null, timers = { setTimeout, clearTimeout } } = {}) {
  const props = vue.reactive({ visible: false, task, presetDate: '' })
  const events = []
  const writes = []
  const callbacks = []
  const toasts = []
  let fail = false
  let release
  let hold = false
  let confirmed = false
  const parent = { id: 'parent', title: '原名称', notes: '', repeatRule, priority: 'not_urgent_not_important' }
  const context = vm.createContext({
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval, clearInterval, console,
    window: { addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
    defineProps: () => props,
    defineEmits: () => (...event) => events.push(event),
    defineExpose: () => {},
    uni: { $on() {}, $off() {}, createSelectorQuery: selectorQuery }
  })
  const modules = {
    vue: { ...vue, onBeforeUnmount: callback => callbacks.push(callback) },
    '@dcloudio/uni-app': { onShow() {}, onHide() {} },
    '../api/store': storeApi || {
      getCategories: () => [], getNewTaskDefaults: () => ({ categoryId: null, priority: 'urgent_important' }), findTask: () => ({ ...parent }), listChildren: () => [], getTaskSnapshot: () => ({ id: 'parent' }),
      saveTask: (input, children, options) => {
        if (fail) throw new Error('写入失败')
        writes.push(JSON.parse(JSON.stringify({ input, children, options })))
        return { ...input, id: 'parent', taskSnapshot: { id: input.id || 'parent' }, reminderPromise: hold ? new Promise((resolve, reject) => { release = (result = { supported: false }) => result instanceof Error ? reject(result) : resolve(result) }) : Promise.resolve({ supported: false }) }
      },
      removeTask() {}
    },
    '../utils/occurrence': { parseOccurrenceId: id => id.includes('@') ? { sourceId: id.split('@')[0], date: id.split('@')[1] } : null, parseRepeatRule: value => JSON.parse(value), repeatLabel: value => value },
    '../utils/task': { applyTaskTime: Object.assign, hasReminderTime: () => false, priorities: [], reminderOptions: [] },
    '../utils/date': { todayString: () => '2026-10-27' },
    '../api/reminders': { reminderState: () => ({ supported: false }), reminderSaveMessage, sendReminderTest() {} },
    '../api/android': { androidSettings() {}, requestNotificationPermission() {} },
    '../utils/platform': { toast: message => toasts.push(message) }
  }
  const module = new vm.SourceTextModule(`${source}\nexport { draft, advancedRule, advancedRuleDescription, selectRepeatKind, flushDraft, requestClose, discardAndClose, remove, save, changeStatus, dirty, error, reminderWarning, confirmation, resolveConfirmation, navigationFailed, closeEmitted, moveSubtaskTo, recordSubtaskTouch, startSubtaskDrag, moveSubtaskDrag, landSubtaskDrag, cancelSubtaskDrag, dragIndex, drag, dragScrollTop, saveOnHide };`, { context })
  await module.link(specifier => {
    const exports = modules[specifier]
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  const stopConfirmation = vue.watch(module.namespace.confirmation, value => {
    if (value && !manualConfirmation) module.namespace.resolveConfirmation(confirmed)
  }, { flush: 'post' })
  props.visible = true
  await vue.nextTick()
  return {
    ...module.namespace, props, writes, events, toasts,
    setFailure: value => { fail = value },
    setHold: value => { hold = value },
    setConfirmed: value => { confirmed = value },
    release: result => release(result),
    close: () => { stopConfirmation(); props.visible = false; callbacks.forEach(callback => callback()) }
  }
}

test('编辑保存后的部分成功只提示不支持，不误报排程失败', async () => {
  const ui = await editor()
  try {
    ui.setHold(true)
    ui.draft.notes = '修改'
    await ui.flushDraft()
    ui.release({ supported: true, notifications: true, exactAlarm: true, warnings: [{ id: 'a', title: '事项', kind: 'workdays' }] })
    await new Promise(resolve => setImmediate(resolve))
    assert.match(ui.reminderWarning.value, /暂不支持/)
    assert.doesNotMatch(ui.reminderWarning.value, /排程失败/)
  } finally { ui.close() }
})

test('快捷调整分别提示部分成功和真正错误', async () => {
  const quickSource = (await readFile(new URL('../src/components/QuickAdjustSheet.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const messages = []
  const context = vm.createContext({ defineProps: () => ({ visible: false }), defineEmits: () => () => {}, defineExpose() {} })
  const modules = {
    vue: { ...vue, onBeforeUnmount() {} },
    '../api/store': { findTask() {}, getTaskSnapshot() {}, saveTask() {} },
    '../utils/occurrence': { parseOccurrenceId() {}, parseRepeatRule() {} },
    '../utils/platform': { toast: message => messages.push(message) },
    '../api/reminders': { reminderSaveMessage }
  }
  const module = new vm.SourceTextModule(`${quickSource}\nexport { notifyReminder };`, { context })
  await module.link(specifier => new vm.SyntheticModule(Object.keys(modules[specifier]), function () {
    for (const [key, value] of Object.entries(modules[specifier])) this.setExport(key, value)
  }, { context }))
  await module.evaluate()
  await module.namespace.notifyReminder({ reminderPromise: Promise.resolve({ supported: true, notifications: true, exactAlarm: true, warnings: [{ id: 'a' }] }) })
  await module.namespace.notifyReminder({ reminderPromise: Promise.resolve({ error: '系统错误' }) })
  assert.match(messages[0], /暂不支持/)
  assert.doesNotMatch(messages[0], /排程失败/)
  assert.match(messages[1], /排程失败：系统错误/)
})

async function quickEditor() {
  const quickSource = (await readFile(new URL('../src/components/QuickAdjustSheet.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const props = vue.reactive({ visible: false, task: { id: 'a', title: '事项', plannedDate: '2026-10-01', categoryId: null, repeatRule: '{"kind":"none"}' }, categories: [] })
  const events = []
  const callbacks = []
  const writes = []
  let fail = false
  const context = vm.createContext({ defineProps: () => props, defineEmits: () => (...event) => events.push(event), defineExpose() {} })
  const modules = {
    vue: { ...vue, onBeforeUnmount: callback => callbacks.push(callback) },
    '../api/store': { findTask: () => props.task, getTaskSnapshot: () => ({ id: props.task.id }), saveTask: input => { if (fail) throw Error('写入失败'); writes.push(input); return input } },
    '../utils/occurrence': { parseOccurrenceId: () => null, parseRepeatRule: value => JSON.parse(value) },
    '../utils/platform': { toast() {} }, '../api/reminders': { reminderSaveMessage: () => '' }
  }
  const module = new vm.SourceTextModule(`${quickSource}\nexport { requestClose, continueEditing, discardAndClose, resumeAfterCloseFailure, save, draft, error, confirming };`, { context })
  await module.link(specifier => new vm.SyntheticModule(Object.keys(modules[specifier]), function () {
    for (const [key, value] of Object.entries(modules[specifier])) this.setExport(key, value)
  }, { context }))
  await module.evaluate()
  props.visible = true
  await vue.nextTick()
  return { ...module.namespace, props, events, writes, setFailure: value => { fail = value }, close: () => { props.visible = false; callbacks.forEach(callback => callback()) } }
}

test('快捷调整无草稿时取消只关闭一次且不写入', async () => {
  const cancel = await quickEditor()
  try {
    assert.equal(cancel.requestClose(), true)
    assert.equal(cancel.events.filter(event => event[0] === 'close').length, 1)
    assert.equal(cancel.requestClose(), false)
    assert.equal(cancel.writes.length, 0)
  } finally { cancel.close() }
})

test('快捷调整有草稿时取消确认保留修改，确认放弃才关闭', async () => {
  const ui = await quickEditor()
  try {
    ui.draft.categoryId = 'cat'
    assert.equal(ui.requestClose(), false)
    assert.equal(ui.confirming.value, true)
    assert.equal(ui.requestClose(), false)
    ui.continueEditing()
    assert.equal(ui.confirming.value, false)
    assert.equal(ui.draft.categoryId, 'cat')
    assert.equal(ui.requestClose(), false)
    assert.equal(ui.confirming.value, true)
    ui.discardAndClose()
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
    assert.equal(ui.writes.length, 0)
  } finally { ui.close() }
})

test('快捷调整返回失败可重试且保留草稿', async () => {
  const ui = await quickEditor()
  try {
    ui.draft.categoryId = 'cat'
    assert.equal(ui.requestClose(), false)
    ui.discardAndClose()
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
    ui.resumeAfterCloseFailure('返回失败')
    assert.match(ui.error.value, /返回失败/)
    assert.equal(ui.confirming.value, false)
    assert.equal(ui.draft.categoryId, 'cat')
    assert.equal(ui.requestClose(), false)
    assert.equal(ui.confirming.value, true)
    ui.discardAndClose()
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 2)
  } finally { ui.close() }
})

test('快捷调整保存失败保留草稿；旧确认和确认期间的新修改不能关闭', async () => {
  const ui = await quickEditor()
  try {
    ui.draft.plannedDate = '2026-11-01'
    ui.setFailure(true)
    await ui.save()
    assert.match(ui.error.value, /写入失败/)
    assert.equal(ui.draft.plannedDate, '2026-11-01')
    assert.equal(ui.events.length, 0)
    assert.equal(ui.requestClose(), false)
    ui.draft.categoryId = 'new'
    ui.discardAndClose()
    assert.match(ui.error.value, /草稿已发生变化/)
    assert.equal(ui.confirming.value, false)
    assert.equal(ui.requestClose(), false)
    ui.props.visible = false
    await vue.nextTick()
    ui.props.visible = true
    await vue.nextTick()
    ui.draft.categoryId = 'current'
    ui.discardAndClose()
    assert.equal(ui.confirming.value, false)
    assert.equal(ui.draft.categoryId, 'current')
    assert.equal(ui.events.length, 0)
    ui.setFailure(false)
    await ui.save()
    assert.equal(ui.writes.length, 1)
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
  } finally { ui.close() }
})

test('任务页调整进入独立页面，读取失败时保留分类草稿并可返回关闭', async () => {
  const file = await readFile(new URL('../src/pages/tasks/index.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(file).descriptor, { id: 'task-page-test', inlineTemplate: true, templateOptions: { compilerOptions: { isCustomElement: tag => ['scroll-view', 'picker'].includes(tag) } } }).content
  const callbacks = {}
  const instances = {}
  const navigations = []
  let failing = false
  const item = { id: 'a', title: '事项', status: 'todo', repeatRule: '{"kind":"none"}' }
  function sheet(name) {
    return { props: ['visible', 'task', 'categories'], setup(props, { expose, emit }) {
      const state = { draft: '', calls: 0, props, unmounted: false }
      instances[name] = state
      vue.onUnmounted(() => { state.unmounted = true })
      expose({ requestClose() { state.calls++; emit('close') } })
      return () => vue.h('sheet-stub', { name })
    } }
  }
  const modules = {
    vue: { ...vue, vModelText: {} },
    '@dcloudio/uni-app': { onShow: fn => { callbacks.show = fn }, onHide: fn => { callbacks.hide = fn }, onBackPress: fn => { callbacks.back = fn }, onUnload() {} },
    '../../components/TaskEditSheet.vue': { default: sheet('task') },
    '../../components/QuickAdjustSheet.vue': { default: sheet('quick') },
    '../../components/CategoryManageSheet.vue': { default: sheet('category') },
    '../../api/store': { listTasks: () => { if (failing) throw Error('读取失败'); return [item] }, getCategories: () => [], getSettings: () => ({}), getHideCompleted: () => false, setTaskStatus() {}, toggleGroupCollapsed() {} },
    '../../utils/occurrence': { repeatLabel: () => '', parseRepeatRule: () => ({ kind: 'none' }), occursOn: () => false },
    '../../api/reminders': { reminderState: () => ({ warnings: [] }), reminderSummary: () => '', subscribeReminderState: () => () => {}, syncTaskReminders() {} },
    '../../api/android': { androidSettings() {} },
    '../../utils/task': { compareTasks: () => 0, matchesTaskFilter: () => true, taskMark: () => '', validateTaskDateRange() {} },
    '../../utils/date': { shortDate: () => '', weekday: () => '', todayString: () => '2026-10-01' },
    '../../utils/platform': { toast() {} },
    '../../utils/pull-sync.js': { usePullSync: () => ({ refreshing: vue.ref(false), refresh() {} }) },
    '../../utils/main-tab.js': { useMainTabTap() {}, registerTabDrafts() {}, pendingTabDraft: () => null }
  }
  const context = vm.createContext({ setTimeout, clearTimeout, console, uni: { navigateTo: options => navigations.push(options.url) } })
  const module = new vm.SourceTextModule(compiled, { context })
  await module.link(specifier => new vm.SyntheticModule(Object.keys(modules[specifier]), function () {
    for (const [key, value] of Object.entries(modules[specifier])) this.setExport(key, value)
  }, { context }))
  await module.evaluate()
  const renderer = vue.createRenderer({
    createElement: type => ({ type, children: [], props: {}, style: {} }), createText: text => ({ text }), createComment: text => ({ text }),
    setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
    patchProp: (node, key, _old, value) => { node.props[key] = value },
    insert: (node, parent, anchor) => { if (node.parent) { const old = node.parent.children.indexOf(node); if (old >= 0) node.parent.children.splice(old, 1) }; node.parent = parent; const index = parent.children.indexOf(anchor); parent.children.splice(index < 0 ? parent.children.length : index, 0, node) },
    remove: node => { const index = node.parent?.children.indexOf(node); if (index >= 0) node.parent.children.splice(index, 1) },
    parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null
  })
  const root = { children: [] }
  const app = renderer.createApp(module.namespace.default)
  for (const name of ['scroll-view', 'picker']) app.component(name, { setup(_props, { slots }) { return () => vue.h(name, slots.default?.()) } })
  app.mount(root)
  const find = (node, predicate) => predicate(node) ? node : (node.children || []).map(child => find(child, predicate)).find(Boolean)
  try {
    callbacks.show()
    await vue.nextTick()
    await vue.nextTick()
    find(root, node => node.props?.class === 'task-adjust').props.onClick({ stopPropagation() {} })
    assert.deepEqual(navigations, ['/pages/task-adjust/index?id=a'])
    callbacks.show()
    await vue.nextTick()
    await vue.nextTick()
    find(root, node => node.props?.class === 'task-adjust').props.onClick({ stopPropagation() {} })
    assert.deepEqual(navigations, ['/pages/task-adjust/index?id=a'])
    callbacks.hide()
    callbacks.show()
    await vue.nextTick()
    await vue.nextTick()
    find(root, node => node.props?.['aria-label'] === '管理分类').props.onClick()
    await vue.nextTick()
    const category = instances.category
    category.draft = '分类草稿'
    failing = true
    callbacks.show()
    await vue.nextTick()
    await vue.nextTick()
    assert.equal(instances.category, category)
    assert.equal(category.unmounted, false)
    assert.equal(category.props.visible, true)
    assert.equal(category.draft, '分类草稿')
    assert.equal(callbacks.back(), true)
    await vue.nextTick()
    assert.equal(category.calls, 1)
    assert.equal(callbacks.back(), false)
  } finally { app.unmount() }
})

test('页面内删除确认可取消，确认期间编辑使删除失效，再确认才删除', async () => {
  const item = realStore.saveTask({ title: '待删除事项' }, [{ title: '子项' }])
  const ui = await editor({ storeApi: realStore, task: { id: item.id }, manualConfirmation: true })
  try {
    const cancelled = ui.remove()
    assert.equal(ui.confirmation.value.title, '删除事项')
    assert.match(ui.confirmation.value.content, /子事项/)
    assert.equal(ui.confirmation.value.confirmText, '删除')
    ui.resolveConfirmation(false)
    await cancelled
    assert.equal(realStore.findTask(item.id).title, '待删除事项')
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
    const stale = ui.remove()
    assert.equal(ui.confirmation.value.title, '删除事项')
    ui.draft.notes = '确认期间的草稿'
    ui.resolveConfirmation(true)
    await stale
    assert.equal(realStore.findTask(item.id).title, '待删除事项')
    assert.equal(ui.draft.notes, '确认期间的草稿')
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
    const confirmed = ui.remove()
    assert.match(ui.confirmation.value.content, /草稿/)
    ui.resolveConfirmation(true)
    await confirmed
    assert.equal(realStore.findTask(item.id), null)
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
  } finally { ui.close() }
})

test('放弃草稿后页面返回失败恢复脏状态，可再次确认', async () => {
  const ui = await editor({ task: null, manualConfirmation: true })
  try {
    ui.draft.notes = '未保存备注'
    const closing = ui.requestClose()
    assert.equal(ui.confirmation.value.title, '放弃未保存的修改？')
    ui.resolveConfirmation(true)
    assert.equal(await closing, true)
    assert.equal(ui.closeEmitted.value, true)
    assert.equal(ui.dirty.value, false)
    ui.navigationFailed('返回失败')
    assert.equal(ui.closeEmitted.value, false)
    assert.equal(ui.dirty.value, true)
    assert.equal(ui.draft.notes, '未保存备注')
    assert.match(ui.error.value, /返回失败/)
    const retry = ui.requestClose()
    assert.ok(ui.confirmation.value)
    ui.resolveConfirmation(false)
    assert.equal(await retry, false)
    assert.equal(ui.draft.notes, '未保存备注')
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
  } finally { ui.close() }
})

test('高级规则保持原始 JSON，替换需确认且可以取消', async () => {
  const original = '{ "kind": "every_days", "interval": 3, "endMode": "count", "count": 4 }'
  const ui = await editor({ repeatRule: original })
  try {
    assert.equal(ui.advancedRule.value.interval, 3)
    assert.match(ui.advancedRuleDescription.value, /重复次数：4/)
    ui.draft.notes = '保留规则'
    await ui.flushDraft()
    assert.equal(ui.writes.at(-1).input.repeatRule, original)
    await ui.selectRepeatKind('weekly')
    assert.equal(ui.draft.repeatRule, original)
    assert.equal(ui.draft.repeatKind, 'every_days')
    ui.setConfirmed(true)
    await ui.selectRepeatKind('weekly')
    await ui.flushDraft()
    assert.equal(ui.writes.at(-1).input.repeatRule, '{"kind":"weekly"}')
    assert.equal(ui.writes.at(-1).input.notes, '保留规则')
  } finally { ui.close() }
})

test('高级规则确认在页面隐藏后过期，旧确认不能替换规则', async () => {
  const original = '{"kind":"every_days","interval":3}'
  const ui = await editor({ repeatRule: original, manualConfirmation: true })
  try {
    const changing = ui.selectRepeatKind('weekly')
    assert.equal(ui.confirmation.value.title, '替换高级重复规则？')
    ui.saveOnHide()
    ui.resolveConfirmation(true)
    await changing
    assert.equal(ui.draft.repeatRule, original)
    assert.equal(ui.draft.repeatKind, 'every_days')
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
    const retry = ui.selectRepeatKind('weekly')
    assert.ok(ui.confirmation.value)
    ui.resolveConfirmation(true)
    await retry
    assert.equal(ui.draft.repeatRule, '{"kind":"weekly"}')
  } finally { ui.close() }
})

test('单次实例不能替换高级规则', async () => {
  const original = '{"kind":"every_days","interval":2}'
  const ui = await editor({ task: { id: 'parent@2026-10-10' }, repeatRule: original })
  try {
    ui.setConfirmed(true)
    await ui.selectRepeatKind('none')
    ui.draft.notes = '仅本次'
    await ui.flushDraft()
    assert.equal(ui.writes.at(-1).input.repeatRule, original)
  } finally { ui.close() }
})

test('未修改的已有事项可通过返回和保存关闭', async () => {
  for (const entry of ['requestClose', 'save']) {
    const ui = await editor()
    try {
      await ui[entry]()
      assert.equal(ui.writes.length, 0)
      assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
    } finally { ui.close() }
  }
})

test('输入框失焦保存与点击保存重叠时仍关闭', async () => {
  const ui = await editor()
  try {
    ui.props.visible = false
    await vue.nextTick()
    ui.props.task = null
    ui.props.visible = true
    await vue.nextTick()
    ui.draft.title = '新事项'
    const blur = ui.flushDraft()
    await ui.save()
    await blur
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
  } finally { ui.close() }
})

test('提醒排程挂起不阻止已落盘事项关闭', async () => {
  const ui = await editor()
  try {
    ui.setHold(true)
    ui.draft.notes = '已落盘'
    const result = await Promise.race([ui.requestClose(), new Promise(resolve => setTimeout(() => resolve('超时'), 50))])
    assert.equal(ui.writes.length, 1)
    assert.equal(result, true)
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
  } finally { ui.release(); ui.close() }
})

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
    assert.equal(await previous, true)
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

test('无标题草稿可确认放弃，取消确认保留输入', async () => {
  const ui = await editor()
  try {
    ui.props.visible = false
    await vue.nextTick()
    ui.props.task = null
    ui.props.visible = true
    await vue.nextTick()
    ui.draft.notes = '尚未保存的备注'
    assert.equal(await ui.requestClose(), false)
    assert.equal(ui.draft.notes, '尚未保存的备注')
    assert.match(ui.error.value, /请先填写事项名称/)
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
    ui.setConfirmed(true)
    assert.equal(await ui.requestClose(), true)
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
    assert.equal(ui.writes.length, 0)
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

function touch(y, x = 0) {
  return { touches: [{ clientX: x, clientY: y }], preventDefault() {}, stopPropagation() {} }
}

test('并发关闭只发一次事件且保存等待期间的修改', async () => {
  const ui = await editor()
  try {
    ui.draft.notes = '第一版'
    const first = ui.requestClose()
    const second = ui.requestClose()
    ui.draft.notes = '第二版'
    assert.equal(await first, true)
    assert.equal(await second, true)
    assert.deepEqual(ui.writes.map(write => write.input.notes), ['第一版', '第二版'])
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
  } finally { ui.close() }
})

test('关闭后提醒失败通过提示可见，不污染新会话', async () => {
  const ui = await editor()
  try {
    ui.setHold(true)
    ui.draft.notes = '已保存'
    assert.equal(await ui.requestClose(), true)
    ui.props.visible = false
    await vue.nextTick()
    ui.props.visible = true
    await vue.nextTick()
    ui.release({ error: '排程失败' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(ui.reminderWarning.value, '')
    assert.match(ui.toasts.at(-1), /排程失败/)
  } finally { ui.close() }
})

test('状态保存不等待提醒，排程异常在关闭后提示', async () => {
  const ui = await editor()
  try {
    ui.setHold(true)
    await ui.changeStatus('failed')
    assert.equal(ui.writes.at(-1).options.status, 'failed')
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
    ui.release(new Error('提醒异常'))
    await new Promise(resolve => setImmediate(resolve))
    assert.match(ui.toasts.at(-1), /提醒异常/)
  } finally { ui.close() }
})

test('旧会话关闭任务不能关闭新会话', async () => {
  const ui = await editor()
  try {
    ui.draft.notes = '旧修改'
    const closing = ui.requestClose()
    ui.props.visible = false
    await vue.nextTick()
    ui.props.task = null
    ui.props.visible = true
    await vue.nextTick()
    assert.equal(await closing, false)
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
    assert.equal(ui.draft.title, '')
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

test('完成确认期间草稿变更使确认过期，重新确认才提交状态', async () => {
  const ui = await editor({ manualConfirmation: true })
  try {
    ui.draft.subtasks = [{ id: 'a', title: '甲', status: 'todo' }, { id: 'b', title: '乙', status: 'todo' }]
    const stale = ui.changeStatus('done')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(ui.confirmation.value.title, '完成全部子事项？')
    ui.draft.notes = '确认期间的修改'
    ui.resolveConfirmation(true)
    await stale
    assert.equal(ui.writes.some(write => write.options?.status), false)
    assert.equal(ui.draft.notes, '确认期间的修改')
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
    const retry = ui.changeStatus('done')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(ui.confirmation.value.title, '完成全部子事项？')
    ui.resolveConfirmation(true)
    await retry
    assert.equal(ui.writes.at(-1).options.status, 'done')
    assert.equal(ui.writes.at(-1).input.notes, '确认期间的修改')
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

test('子项换位只调整数组顺序，取消拖动恢复开始前顺序', async () => {
  const ui = await editor()
  try {
    ui.draft.subtasks = [{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }, { id: 'c', title: '丙' }]
    ui.moveSubtaskTo(0, 2)
    assert.equal(ui.draft.subtasks.map(item => item.id).join(','), 'b,c,a')
    ui.drag.snapshot = ['a', 'b', 'c']
    ui.dragIndex.value = 1
    ui.cancelSubtaskDrag()
    assert.equal(ui.draft.subtasks.map(item => item.id).join(','), 'a,b,c')
    assert.equal(ui.dragIndex.value, -1)
  } finally { ui.close() }
})

test('子事项测量回调晚于抬手或取消时不启动拖动，也不影响下一次触摸', async () => {
  const callbacks = []
  const selectorQuery = () => {
    const query = { in: () => query, select: () => query, selectAll: () => query, boundingClientRect: () => query, scrollOffset: () => query, exec: callback => callbacks.push(callback) }
    return query
  }
  const ui = await editor({ selectorQuery })
  const result = [{ top: 0, bottom: 200, height: 200 }, { scrollTop: 0, scrollHeight: 300 }, [{ top: 0, bottom: 50 }, { top: 50, bottom: 100 }]]
  try {
    ui.draft.subtasks = [{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]
    ui.recordSubtaskTouch(touch(20))
    ui.startSubtaskDrag(0)
    ui.landSubtaskDrag()
    ui.recordSubtaskTouch(touch(70))
    callbacks.shift()(result)
    assert.equal(ui.dragIndex.value, -1)
    assert.equal(ui.drag.timer, null)
    ui.startSubtaskDrag(1)
    callbacks.shift()(result)
    assert.equal(ui.dragIndex.value, 1)
    ui.cancelSubtaskDrag()
    ui.recordSubtaskTouch(touch(20))
    ui.startSubtaskDrag(0)
    ui.cancelSubtaskDrag()
    callbacks.shift()(result)
    assert.equal(ui.dragIndex.value, -1)
    assert.equal(ui.drag.timer, null)
  } finally { ui.close() }
})

test('有效子事项拖动可换位，抬手保存，取消恢复顺序', async () => {
  let measured
  const selectorQuery = () => {
    const query = { in: () => query, select: () => query, selectAll: () => query, boundingClientRect: () => query, scrollOffset: () => query, exec: callback => { measured = callback } }
    return query
  }
  const ui = await editor({ selectorQuery })
  try {
    ui.draft.subtasks = [{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]
    const start = () => { ui.recordSubtaskTouch(touch(20)); ui.startSubtaskDrag(0); measured([{ top: 0, bottom: 200, height: 200 }, { scrollTop: 0, scrollHeight: 200 }, [{ top: 0, bottom: 50 }, { top: 50, bottom: 100 }]]) }
    start()
    ui.moveSubtaskDrag(touch(90))
    assert.equal(ui.draft.subtasks.map(item => item.id).join(','), 'b,a')
    ui.cancelSubtaskDrag()
    assert.equal(ui.draft.subtasks.map(item => item.id).join(','), 'a,b')
    start()
    ui.moveSubtaskDrag(touch(90))
    ui.landSubtaskDrag()
    await vue.nextTick()
    assert.equal(ui.writes.at(-1).children.map(item => item.id).join(','), 'b,a')
    assert.equal(ui.drag.timer, null)
  } finally { ui.close() }
})

test('页面隐藏保留草稿和冲突，旧删除及关闭确认失效', async () => {
  const item = realStore.saveTask({ title: '挂起事项' }, [{ title: '子项' }])
  const ui = await editor({ storeApi: realStore, task: { id: item.id }, manualConfirmation: true })
  try {
    ui.draft.notes = '保留草稿'
    remoteTask(item.id, { title: '外部修改' })
    assert.equal(await ui.flushDraft(true), false)
    const closing = ui.discardAndClose()
    assert.ok(ui.confirmation.value)
    ui.saveOnHide()
    ui.resolveConfirmation(true)
    assert.equal(await closing, false)
    assert.equal(ui.draft.notes, '保留草稿')
    assert.equal(ui.draft.subtasks[0].title, '子项')
    assert.equal(ui.dirty.value, true)
    assert.match(ui.error.value, /更改或删除/)
    const deleting = ui.remove()
    assert.ok(ui.confirmation.value)
    ui.saveOnHide()
    ui.resolveConfirmation(true)
    await deleting
    assert.equal(realStore.findTask(item.id).title, '外部修改')
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
  } finally { ui.close() }
})

test('页面隐藏期间异步新建完成后保留 ID 和快照并串行保存后续草稿', async () => {
  let release
  const writes = []
  const storeApi = {
    getCategories: () => [], getNewTaskDefaults: () => ({ categoryId: null, priority: 'urgent_important' }),
    findTask: () => null, listChildren: () => [], getTaskSnapshot: () => null,
    saveTask: (input, children, options) => {
      writes.push({ input, children, options })
      if (writes.length === 1) return new Promise(resolve => { release = resolve })
      return { id: 'created', taskSnapshot: { version: 2 }, reminderPromise: Promise.resolve({ supported: false }) }
    }, removeTask() {}
  }
  const ui = await editor({ storeApi, task: null })
  try {
    ui.draft.title = '第一版'
    const saving = ui.flushDraft(true)
    ui.saveOnHide()
    ui.draft.notes = '第二版'
    release({ id: 'created', taskSnapshot: { version: 1 }, reminderPromise: Promise.resolve({ supported: false }) })
    assert.equal(await saving, true)
    assert.equal(ui.draft.id, 'created')
    assert.equal(ui.draft.notes, '第二版')
    assert.equal(writes.length, 2)
    assert.equal(writes[1].input.id, 'created')
    assert.equal(writes[1].options.expectedSnapshot.version, 1)
    assert.equal(ui.dirty.value, false)
  } finally { ui.close() }
})

test('页面隐藏使完成确认失效，空标题和单次草稿保留', async () => {
  const ui = await editor({ manualConfirmation: true })
  try {
    ui.draft.subtasks = [{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]
    const completing = ui.changeStatus('done')
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(ui.confirmation.value)
    ui.saveOnHide()
    ui.resolveConfirmation(true)
    await completing
    assert.equal(ui.writes.some(write => write.options.status), false)
    ui.draft.id = 'parent@2026-10-27'
    ui.draft.title = ''
    ui.draft.notes = '单次备注'
    ui.saveOnHide()
    assert.equal(ui.draft.id, 'parent@2026-10-27')
    assert.equal(ui.draft.notes, '单次备注')
    assert.equal(ui.dirty.value, true)
    assert.match(ui.error.value, /填写事项名称/)
  } finally { ui.close() }
})

test('子事项拖动触摸超时后恢复', async () => {
  const scheduled = []
  const timers = { setTimeout: (fn, delay) => { const timer = { fn, delay }; scheduled.push(timer); return timer }, clearTimeout() {} }
  const ui = await editor({ timers })
  try {
    ui.recordSubtaskTouch(touch(10))
    assert.equal(ui.drag.touching, true)
    scheduled.filter(timer => timer.delay === 4000).at(-1).fn()
    assert.equal(ui.drag.touching, false)
  } finally { ui.close() }
})

function remoteTask(id, patch) {
  const data = load()
  saveStorage({ ...data, tasks: data.tasks.map(item => item.id === id ? { ...item, ...patch } : item) }, { strict: true, remote: true })
}

test('真实存储中新建及多轮自动保存使用实际落盘基线，失败可重试', async () => {
  const ui = await editor({ storeApi: realStore, task: null })
  try {
    ui.draft.title = '新事项'
    ui.draft.subtasks = [{ id: 'new-ui-child', title: '子项', status: 'todo' }]
    assert.equal(await ui.flushDraft(true), true)
    const id = ui.draft.id
    ui.draft.notes = '第二版'
    assert.equal(await ui.flushDraft(true), true)
    diskFailure = true
    ui.draft.notes = '第三版'
    assert.equal(await ui.flushDraft(true), false)
    assert.equal(realStore.findTask(id).notes, '第二版')
    diskFailure = false
    assert.equal(await ui.flushDraft(true), true)
    assert.equal(realStore.findTask(id).notes, '第三版')
    assert.equal(realStore.listChildren(id)[0].title, '子项')
  } finally { diskFailure = false; ui.close() }
})

test('真实存储冲突保留草稿，取消及确认放弃均可达', async () => {
  const item = realStore.saveTask({ title: '本机', notes: '旧备注' }, [{ title: '原子项' }])
  const ui = await editor({ storeApi: realStore, task: { id: item.id } })
  try {
    ui.draft.notes = '未保存输入'
    remoteTask(item.id, { title: '云端同时间修改' })
    assert.equal(await ui.flushDraft(true), false)
    assert.match(ui.error.value, /更改或删除/)
    assert.equal(ui.draft.notes, '未保存输入')
    assert.equal(realStore.findTask(item.id).title, '云端同时间修改')
    assert.equal(await ui.requestClose(), false)
    assert.equal(await ui.discardAndClose(), false)
    assert.equal(ui.dirty.value, true)
    ui.setConfirmed(true)
    assert.equal(await ui.discardAndClose(), true)
    assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
    assert.equal(realStore.findTask(item.id).notes, '旧备注')
  } finally { ui.close() }
})

test('冲突后保存不会误触发放弃确认，确认期间的新草稿不会丢失', async () => {
  const item = realStore.saveTask({ title: '原事项' })
  const ui = await editor({ storeApi: realStore, task: { id: item.id }, manualConfirmation: true })
  try {
    ui.draft.notes = '本机输入'
    remoteTask(item.id, { title: '远端更新' })
    assert.equal(await ui.flushDraft(true), false)
    await ui.save()
    assert.equal(ui.confirmation.value, null)
    const closing = ui.discardAndClose()
    assert.ok(ui.confirmation.value)
    ui.draft.notes = '确认期间继续编辑'
    ui.resolveConfirmation(true)
    assert.equal(await closing, false)
    assert.equal(ui.draft.notes, '确认期间继续编辑')
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
  } finally { ui.close() }
})

test('重复当次编辑允许其他实例变化，但拒绝同实例变化', async () => {
  const item = realStore.saveTask({ title: '重复事项', plannedDate: '2026-10-01', repeatRule: '{"kind":"daily"}' })
  const id = `${item.id}@2026-10-11`
  const other = `${item.id}@2026-10-12`
  const ui = await editor({ storeApi: realStore, task: { id } })
  try {
    realStore.saveTask({ id: other, notes: '其他实例' })
    ui.draft.notes = '当次草稿'
    assert.equal(await ui.flushDraft(true), true)
    assert.equal(realStore.findTask(other).notes, '其他实例')
    assert.equal(realStore.findTask(id).notes, '当次草稿')
    realStore.saveTask({ id, title: '远端当次' })
    await ui.changeStatus('done')
    assert.match(ui.error.value, /更改或删除/)
    assert.equal(realStore.findTask(id).title, '远端当次')
    assert.equal(realStore.findTask(id).status, 'todo')
  } finally { ui.close() }
})

test('旧会话的放弃确认不能关闭新会话或清除新草稿', async () => {
  const item = realStore.saveTask({ title: '原事项' })
  const ui = await editor({ storeApi: realStore, task: { id: item.id }, manualConfirmation: true })
  try {
    ui.draft.notes = '旧草稿'
    remoteTask(item.id, { title: '远端事项' })
    assert.equal(await ui.flushDraft(true), false)
    const closing = ui.discardAndClose()
    assert.ok(ui.confirmation.value)
    ui.props.visible = false
    await vue.nextTick()
    ui.props.task = null
    ui.props.visible = true
    await vue.nextTick()
    ui.draft.title = '新草稿'
    ui.resolveConfirmation(true)
    assert.equal(await closing, false)
    assert.equal(ui.draft.title, '新草稿')
    assert.equal(ui.dirty.value, true)
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
  } finally { ui.close() }
})

test('无草稿状态切换、删除及子事项修改均检测远端冲突', async () => {
  for (const kind of ['status', 'delete', 'child', 'deleted']) {
    const item = realStore.saveTask({ title: '原事项' }, [{ title: '子项' }])
    const ui = await editor({ storeApi: realStore, task: { id: item.id } })
    try {
      const child = realStore.listChildren(item.id)[0]
      if (kind === 'child') { ui.draft.notes = '草稿'; remoteTask(child.id, { title: '云端子项' }) }
      else if (kind === 'deleted') { ui.draft.notes = '草稿'; remoteTask(item.id, { deletedAt: Date.now() }) }
      else remoteTask(item.id, { title: '云端事项' })
      ui.setConfirmed(true)
      if (kind === 'status') await ui.changeStatus('done')
      else if (kind === 'delete') await ui.remove()
      else assert.equal(await ui.flushDraft(true), false)
      assert.match(ui.error.value, /更改或删除/, kind)
      assert.equal(ui.events.some(event => event[0] === 'close'), false)
      if (kind === 'child' || kind === 'deleted') assert.equal(ui.draft.notes, '草稿')
      if (kind === 'delete') assert.equal(realStore.findTask(item.id).title, '云端事项')
    } finally { ui.close() }
  }
})
