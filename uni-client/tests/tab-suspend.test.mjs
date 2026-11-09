import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as vue from 'vue'

async function harness() {
  const listeners = new Map()
  const hooks = []
  const disposers = []
  const uni = {
    $on(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback) },
    $off(name, callback) { listeners.get(name)?.delete(callback) },
    $emit(name, value) { for (const callback of listeners.get(name) || []) callback(value) }
  }
  const context = vm.createContext({ uni })
  const source = await readFile(new URL('../src/utils/main-tab.js', import.meta.url), 'utf8')
  const module = new vm.SourceTextModule(source, { context })
  await module.link(async (name) => new vm.SyntheticModule(
    name === 'vue' ? ['onBeforeUnmount'] : ['onTabItemTap', 'onUnload'],
    function () {
      if (name === 'vue') this.setExport('onBeforeUnmount', callback => disposers.push(callback))
      else {
        this.setExport('onTabItemTap', callback => hooks.push(callback))
        this.setExport('onUnload', callback => disposers.push(callback))
      }
    }, { context }
  ))
  await module.evaluate()
  return { api: module.namespace, hooks, disposers }
}

test('目标 tab 点击广播给其他页面，同 tab 不挂起，释放后不再响应', async () => {
  const { api, hooks, disposers } = await harness()
  const left = []
  api.useMainTabTap('pages/tasks/index', () => left.push('tasks'))
  api.useMainTabTap('pages/planning/index', () => left.push('planning'))
  hooks[0]({ pagePath: '/pages/tasks/index' })
  assert.deepEqual(left, ['planning'])
  left.length = 0
  hooks[1]({ pagePath: 'pages/planning/index' })
  assert.deepEqual(left, ['tasks'])
  left.length = 0
  hooks[0]({})
  assert.deepEqual(left, [])
  disposers.forEach(dispose => dispose())
  hooks[1]({ pagePath: 'pages/planning/index' })
  assert.deepEqual(left, [])
})

test('分类管理挂起保留草稿并使旧确认失效', async () => {
  const file = await readFile(new URL('../src/components/CategoryManageSheet.vue', import.meta.url), 'utf8')
  const source = file.split('<script setup>')[1].split('</script>')[0]
  const props = vue.reactive({ visible: true, suspended: false })
  const modals = [], removed = []
  const callbacks = []
  const category = { id: 'a', name: '原分类', color: '#2996f6', icon: 'monitor' }
  const context = vm.createContext({ setTimeout, clearTimeout, defineProps: () => props, defineEmits: () => () => {}, defineExpose() {}, uni: { showModal: options => modals.push(options) } })
  const modules = {
    vue: { ...vue, onBeforeUnmount: fn => callbacks.push(fn) },
    '../api/store': { getCategories: () => [category], listTasks: () => [], saveCategory() {}, removeCategory: id => removed.push(id), reorderCategories() {} },
    '../utils/platform': { toast() {} }
  }
  const module = new vm.SourceTextModule(`${source}\nexport { startEdit, draft, editing, closeEdit, confirmRemove, submitting };`, { context })
  await module.link(name => new vm.SyntheticModule(Object.keys(modules[name]), function () { for (const [key, value] of Object.entries(modules[name])) this.setExport(key, value) }, { context }))
  await module.evaluate()
  const ui = module.namespace
  ui.startEdit(category)
  ui.draft.name = '保留草稿'
  const closing = ui.closeEdit()
  props.suspended = true
  modals[0].success({ confirm: true })
  assert.equal(await closing, false)
  assert.equal(ui.draft.name, '保留草稿')
  assert.equal(ui.editing.value, true)
  props.suspended = false
  ui.confirmRemove()
  props.suspended = true
  modals[1].success({ confirm: true })
  modals[1].complete()
  assert.deepEqual(removed, [])
  assert.equal(ui.draft.name, '保留草稿')
  assert.equal(ui.submitting.value, false)
  callbacks.forEach(fn => fn())
})

test('跨页面草稿可独立保留并在释放后注销', async () => {
  const { api, disposers } = await harness()
  let task = true
  let planning = true
  api.registerTabDrafts('tasks', '事项', () => task)
  api.registerTabDrafts('planning', '规划', () => planning)
  assert.equal(api.pendingTabDraft(), '事项')
  task = false
  assert.equal(api.pendingTabDraft(), '规划')
  planning = false
  assert.equal(api.pendingTabDraft(), '')
  disposers.forEach(dispose => dispose())
  planning = true
  assert.equal(api.pendingTabDraft(), '')
})
