import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as vue from 'vue'
import * as realStore from '../src/api/store.js'
import { load, save as saveStorage } from '../src/api/storage.js'
import { reminderSaveMessage } from '../src/api/reminders.js'

let disk = null
let diskFailure = false
globalThis.uni = { getStorageSync: () => disk, setStorageSync: (_key, value) => { if (diskFailure) throw Error('写入失败'); disk = structuredClone(value) } }

const source = (await readFile(new URL('../src/components/TaskEditSheet.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]

async function editor({ storeApi = null, task = { id: 'parent' }, modal = null, repeatRule = '{"kind":"none"}' } = {}) {
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
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    window: { addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
    defineProps: () => props,
    defineEmits: () => (...event) => events.push(event),
    defineExpose: () => {},
    uni: { $on() {}, $off() {}, showModal: options => modal ? modal(options) : options.success({ confirm: confirmed }) }
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
  const module = new vm.SourceTextModule(`${source}\nexport { draft, advancedRule, advancedRuleDescription, selectRepeatKind, flushDraft, requestClose, discardAndClose, remove, save, changeStatus, dirty, error, reminderWarning, moveSubtaskTo, cancelSubtaskDrag, dragIndex, drag, dragScrollTop, sheetOffset, swipe, startSheetSwipe, moveSheetSwipe, endSheetSwipe, cancelSheetSwipe, saveOnHide };`, { context })
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
    ...module.namespace, props, writes, events, toasts,
    setFailure: value => { fail = value },
    setHold: value => { hold = value },
    setConfirmed: value => { confirmed = value },
    release: result => release(result),
    close: () => { props.visible = false; callbacks.forEach(callback => callback()) }
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
    '../api/store': { findTask() {}, saveTask() {} },
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

test('未修改的已有事项可通过遮罩和保存关闭', async () => {
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

test('下拉距离、速度阈值及释放点击抑制', async () => {
  for (const fast of [false, true]) {
    const ui = await editor()
    try {
      ui.startSheetSwipe(touch(0), true)
      ui.moveSheetSwipe(touch(fast ? 45 : 120))
      if (fast) { ui.swipe.velocity = 1; ui.swipe.lastTime = Date.now() }
      assert.equal(ui.sheetOffset.value, fast ? 45 : 120)
      await ui.endSheetSwipe({ touches: [], preventDefault() {} })
      assert.equal(ui.events.filter(event => event[0] === 'close').length, 1)
      assert.equal(ui.swipe.blockClick, true)
    } finally { ui.close() }
  }
})

test('短距离、水平滑动、滚动未到顶部、多指及取消均回弹', async () => {
  const ui = await editor()
  try {
    ui.startSheetSwipe(touch(0), true)
    ui.moveSheetSwipe(touch(25))
    ui.swipe.velocity = 0
    await ui.endSheetSwipe({ touches: [] })
    assert.equal(ui.sheetOffset.value, 0)
    ui.dragScrollTop.value = 30
    ui.startSheetSwipe(touch(0), true)
    ui.moveSheetSwipe(touch(150))
    assert.equal(ui.sheetOffset.value, 0)
    ui.dragScrollTop.value = 0
    ui.startSheetSwipe(touch(0), true)
    ui.moveSheetSwipe(touch(10, 40))
    assert.equal(ui.swipe.tracking, false)
    ui.startSheetSwipe(touch(0))
    ui.moveSheetSwipe(touch(80))
    ui.startSheetSwipe({ touches: [{}, {}] })
    assert.equal(ui.sheetOffset.value, 0)
    ui.startSheetSwipe(touch(0))
    ui.moveSheetSwipe(touch(80))
    ui.cancelSheetSwipe()
    assert.equal(ui.sheetOffset.value, 0)
    ui.startSheetSwipe(touch(0))
    ui.moveSheetSwipe(touch(80))
    ui.saveOnHide()
    assert.equal(ui.sheetOffset.value, 0)
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
  } finally { ui.close() }
})

test('下拉保存失败回弹并保留草稿，重试后关闭', async () => {
  const ui = await editor()
  try {
    ui.draft.notes = '保留输入'
    ui.setFailure(true)
    ui.startSheetSwipe(touch(0))
    ui.moveSheetSwipe(touch(150))
    await ui.endSheetSwipe({ touches: [], preventDefault() {} })
    assert.equal(ui.sheetOffset.value, 0)
    assert.equal(ui.draft.notes, '保留输入')
    assert.match(ui.error.value, /写入失败/)
    assert.equal(ui.events.some(event => event[0] === 'close'), false)
    ui.setFailure(false)
    assert.equal(await ui.requestClose(), true)
  } finally { ui.close() }
})

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
  let confirmation
  let modalCount = 0
  const item = realStore.saveTask({ title: '原事项' })
  const ui = await editor({ storeApi: realStore, task: { id: item.id }, modal: options => { modalCount++; confirmation = options } })
  try {
    ui.draft.notes = '本机输入'
    remoteTask(item.id, { title: '远端更新' })
    assert.equal(await ui.flushDraft(true), false)
    await ui.save()
    assert.equal(modalCount, 0)
    const closing = ui.discardAndClose()
    ui.draft.notes = '确认期间继续编辑'
    confirmation.success({ confirm: true })
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
  let confirmation
  const item = realStore.saveTask({ title: '原事项' })
  const ui = await editor({ storeApi: realStore, task: { id: item.id }, modal: options => { confirmation = options } })
  try {
    ui.draft.notes = '旧草稿'
    remoteTask(item.id, { title: '远端事项' })
    assert.equal(await ui.flushDraft(true), false)
    const closing = ui.discardAndClose()
    ui.props.visible = false
    await vue.nextTick()
    ui.props.task = null
    ui.props.visible = true
    await vue.nextTick()
    ui.draft.title = '新草稿'
    confirmation.success({ confirm: true })
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
