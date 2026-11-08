<template>
  <transition name="sheet">
    <view v-if="visible" class="sheet-layer" :style="{ backgroundColor: `rgba(30, 44, 61, ${0.45 * (1 - Math.min(sheetOffset / 400, 1))})` }" @click="requestClose">
      <view :class="['sheet', { 'is-swiping': swipe.active }]" :style="{ '--sheet-offset': `${sheetOffset}px` }" @click.stop @touchmove="moveSheetSwipe" @touchend="endSheetSwipe" @touchcancel="cancelSheetSwipe">
      <view class="sheet-header" @touchstart="startSheetSwipe">
        <view class="sheet-grab" aria-hidden="true" />
        <view class="header-actions"><button class="sheet-close" aria-label="关闭" @touchstart.stop @click="requestClose">×</button><view v-if="draft.id" class="sheet-delete" @touchstart.stop @click="remove">删除</view></view>
        <text class="sheet-title">{{ draft.id ? '编辑事项' : '新建事项' }}</text>
        <view class="sheet-save" @touchstart.stop @click="save">{{ saving ? '保存中' : '保存' }}</view>
      </view>
      <scroll-view :class="['sheet-body', { 'is-busy': actionBusy }]" scroll-y :scroll-into-view="scrollTarget" :scroll-top="dragScrollTop" :scroll-with-animation="false" @scroll="onSubtaskScroll" @touchstart="startSheetSwipe($event, true)">
        <input @touchstart.stop class="title-input" v-model="draft.title" placeholder="输入事项名称" :maxlength="Math.max(120, draft.title.length)" @blur="flushDraft()" />
        <view class="sheet-row">
          <text class="row-label">◷ 日期</text>
          <picker @touchstart.stop mode="date" :value="draft.plannedDate || ''" @change="onDateChange">
            <view class="row-value">{{ draft.plannedDate || '未设置' }} ›</view>
          </picker>
        </view>
        <view @touchstart.stop class="option-grid time-types"><button v-for="[value, label] in [['all_day', '全天'], ['point', '时间点'], ['range', '时间段']]" :key="value" :class="['option-chip', { active: draft.scheduleKind === value }]" @click="setTime({ scheduleKind: value })">{{ label }}</button></view>
        <view v-if="draft.scheduleKind !== 'all_day'" class="sheet-row"><text class="row-label">开始时间</text><picker @touchstart.stop mode="time" :value="draft.plannedTime || '09:00'" @change="setTime({ plannedTime: $event.detail.value })"><view class="row-value">{{ draft.plannedTime || '请选择' }} ›</view></picker></view>
        <view v-if="draft.scheduleKind === 'range'" class="sheet-row"><text class="row-label">结束时间</text><picker @touchstart.stop mode="time" :value="draft.plannedEndTime || '10:00'" @change="setTime({ plannedEndTime: $event.detail.value })"><view class="row-value">{{ draft.plannedEndTime || '请选择' }} ›</view></picker></view>
        <button @touchstart.stop class="clear-time" @click="setTime({ plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day' })">清除日期与时间</button>
        <template v-if="canRemind"><view class="sheet-row"><text class="row-label">♧ 是否提醒</text><switch @touchstart.stop :checked="draft.reminderOffsets.length > 0" color="#2996f6" @change="draft.reminderOffsets = $event.detail.value ? [0] : []" /></view><view v-if="draft.reminderOffsets.length" @touchstart.stop class="option-grid"><button v-for="[value, label] in reminderOptions" :key="value" :class="['option-chip', { active: draft.reminderOffsets.includes(value) }]" @click="toggleOffset(value)">{{ label }}</button></view><text class="permission-hint">{{ permissionMessage }}</text><view v-if="permissions.supported" @touchstart.stop class="permission-actions"><button v-if="!permissions.notifications" @click="allowNotifications">允许系统通知</button><button v-if="!permissions.exactAlarm" @click="androidSettings('alarm')">允许准时提醒</button><button @click="androidSettings('notifications')">通知设置</button><button v-if="permissions.notifications" @click="testReminder">测试通知</button></view></template>
        <view class="sheet-row">
          <text class="row-label">⌁ 重复</text>
        </view>
        <text v-if="advancedRule" class="permission-hint">当前规则：{{ advancedRuleDescription }}。{{ occurrence ? '当次编辑不能更改规则。' : '现有设置将保留；选择下方基本规则时需确认替换。' }}</text>
        <view @touchstart.stop class="option-grid">
          <view v-for="kind in repeatKinds" :key="kind" :class="['option-chip', !advancedRule && draft.repeatKind === kind ? 'active' : '']" @click="selectRepeatKind(kind)">
            <text>{{ repeatLabel(kind) }}</text>
          </view>
        </view>
        <view class="sheet-row">
          <text class="row-label">⚑ 优先级</text>
        </view>
        <view @touchstart.stop class="option-grid">
          <view v-for="[value, label] in priorities" :key="value" :class="['option-chip', draft.priority === value ? 'active' : '']" @click="draft.priority = value">
            <text>{{ label }}</text>
          </view>
        </view>
        <view class="sheet-row">
          <text class="row-label">▦ 分类</text>
        </view>
        <view @touchstart.stop class="option-grid">
          <view :class="['option-chip', draft.categoryId === null ? 'active' : '']" @click="draft.categoryId = null"><text>未分类</text></view>
          <view v-for="cat in categories" :key="cat.id" :class="['option-chip', draft.categoryId === cat.id ? 'active' : '']" :style="draft.categoryId === cat.id ? { borderColor: cat.color, background: cat.color, color: '#fff' } : {}" @click="draft.categoryId = cat.id">
            <text>{{ cat.name }}</text>
          </view>
        </view>
        <template v-if="!occurrence">
          <view @touchstart.stop class="subtask-add" @click="addSubtask()"><text>＋ 添加子事项</text></view>
          <view v-for="(subtask, index) in draft.subtasks" :key="subtask.id" :id="`subtask-${subtask.id}`" :class="['subtask-row', { 'is-dragging': dragIndex === index }]">
            <view class="subtask-drag" :class="{ active: dragIndex === index }" role="button" aria-label="长按拖动排序" @touchstart="recordSubtaskTouch" @longpress="startSubtaskDrag(index)" @touchmove.stop="moveSubtaskDrag" @touchend="landSubtaskDrag" @touchcancel="cancelSubtaskDrag">⋮⋮</view>
            <button @touchstart.stop v-if="draft.repeatKind === 'none'" :class="['subtask-check', { done: subtask.status === 'done' }]" :aria-label="subtask.status === 'done' ? '恢复子事项' : '完成子事项'" @click="toggleSubtask(subtask)">{{ subtask.status === 'done' ? '✓' : '○' }}</button>
            <input @touchstart.stop v-model="subtask.title" :focus="focusedChild === subtask.id" @focus="focusedChild = subtask.id" @blur="flushDraft()" @confirm="addSubtask(index + 1)" placeholder="子事项" :maxlength="Math.max(120, subtask.title.length)" confirm-type="next" />
            <view @touchstart.stop class="subtask-order"><button :disabled="index === 0" aria-label="上移子事项" @click="moveSubtask(index, -1)">↑</button><button :disabled="index === draft.subtasks.length - 1" aria-label="下移子事项" @click="moveSubtask(index, 1)">↓</button></view>
            <button @touchstart.stop class="subtask-remove" aria-label="删除子事项" @click="removeSubtask(index)">×</button>
          </view>
        </template>
        <text v-if="occurrence" class="permission-hint">正在编辑 {{ occurrence.date }} 的当次事项，重复规则和源子事项保持不变。</text>
        <textarea @touchstart.stop class="note-area" v-model="draft.notes" auto-height :maxlength="Math.max(1000, draft.notes.length)" @blur="flushDraft()" placeholder="备注：记录一些细节，未来的自己会感谢你。" />
      </scroll-view>
      <view v-if="swipe.blockClick" class="swipe-click-blocker" @touchstart.stop @click.stop.prevent />
      <view class="sheet-footer" @touchstart="startSheetSwipe">
        <view class="save-feedback" aria-live="polite"><text :class="{ 'save-error': error }">{{ error || reminderWarning || (saving ? '正在保存…' : dirty ? '有未保存的修改' : draft.id ? '已保存' : '填写后保存') }}</text><view v-if="error" class="save-error-actions"><button @touchstart.stop @click="flushDraft(true)">重试</button><button @touchstart.stop @click="discardAndClose">放弃并关闭</button></view></view>
        <view v-if="draft.id && (occurrence || draft.repeatKind === 'none')" class="occurrence-status" @touchstart.stop><button :disabled="actionBusy" @click="changeStatus('todo')">恢复待办</button><button :disabled="actionBusy" @click="changeStatus('done')">{{ occurrence ? '完成本次' : '完成事项' }}</button><button :disabled="actionBusy" @click="changeStatus('failed')">标记失败</button></view>
      </view>
      </view>
    </view>
  </transition>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { getCategories, getNewTaskDefaults, saveTask, removeTask, findTask, listChildren, getTaskSnapshot } from '../api/store'
import { parseOccurrenceId, parseRepeatRule, repeatLabel } from '../utils/occurrence'
import { applyTaskTime, hasReminderTime, priorities, reminderOptions } from '../utils/task'
import { todayString } from '../utils/date'
import { reminderState, reminderSaveMessage, sendReminderTest } from '../api/reminders'
import { androidSettings, requestNotificationPermission } from '../api/android'
import { toast } from '../utils/platform'

const props = defineProps({
  visible: { type: Boolean, default: false },
  task: { type: Object, default: null },
  presetDate: { type: String, default: '' }
})

const emit = defineEmits(['close', 'saved'])

const categories = ref(getCategories())
const repeatKinds = ['none', 'daily', 'weekly', 'monthly', 'yearly']
const permissions = ref(reminderState())
const error = ref('')
const saving = ref(false)
const actionBusy = ref(false)
const dirty = ref(false)
const reminderWarning = ref('')
let initializing = false
let revision = 0
let generation = 0
let newSession = false
let expectedSnapshot = null
let conflict = false
let saveTimer
let pendingSave = null
let pendingGeneration = 0
let pendingClose = null
let reminderToken = 0
let swipeBlockTimer
let closeEmitted = false
const sheetOffset = ref(0)
const swipe = reactive({ tracking: false, active: false, startX: 0, startY: 0, lastY: 0, lastTime: 0, velocity: 0, blockClick: false })
const focusedChild = ref('')
const scrollTarget = ref('')
const instance = getCurrentInstance()
const dragIndex = ref(-1)
const dragScrollTop = ref(0)
const drag = { rows: [], bodyTop: 0, bodyBottom: 0, maxScroll: 0, startScrollTop: 0, startY: 0, y: 0, timer: null, token: 0, snapshot: [], touching: false }
const occurrence = computed(() => draft.id ? parseOccurrenceId(draft.id) : null)
const canRemind = computed(() => hasReminderTime(draft))
const permissionMessage = computed(() => !permissions.value.supported ? '仅安卓客户端支持系统提醒。' : permissions.value.error || (!permissions.value.notifications ? '已设置，需允许系统通知后才能送达。' : !permissions.value.exactAlarm ? '已设置，需允许精确闹钟后才能准时排程。' : '最多三个提醒；展示和声音受通知渠道、免打扰及省电设置影响。'))

const draft = reactive({
  id: '',
  title: '',
  categoryId: categories.value[0]?.id || '',
  plannedDate: '',
  plannedTime: null,
  plannedEndTime: null,
  scheduleKind: 'all_day',
  reminderOffsets: [],
  repeatRule: '{"kind":"none"}',
  occurrenceOverrides: '{}',
  repeatKind: 'none',
  priority: 'not_urgent_not_important',
  subtasks: [],
  notes: ''
})

const advancedRule = computed(() => {
  try {
    const rule = JSON.parse(draft.repeatRule || '{}')
    return !repeatKinds.includes(rule.kind) || Object.keys(rule).some(key => key !== 'kind') ? rule : null
  } catch { return { kind: '未知' } }
})

const advancedRuleDescription = computed(() => {
  const rule = advancedRule.value
  if (!rule) return ''
  const parts = [repeatLabel(rule.kind, rule.interval)]
  if (rule.kind !== 'every_days' && rule.interval != null) parts.push(`间隔：${rule.interval}`)
  if (rule.endMode === 'date') parts.push(`截止日期：${rule.endDate || '未设置'}`)
  else if (rule.endMode === 'count') parts.push(`重复次数：${rule.count ?? '未设置'}`)
  else if (rule.endMode === 'never') parts.push('永不结束')
  return parts.join('；')
})

async function selectRepeatKind(kind) {
  if (occurrence.value || actionBusy.value) return
  if (!advancedRule.value) { draft.repeatKind = kind; return }
  const session = generation
  const original = draft.repeatRule
  actionBusy.value = true
  try {
    const result = await new Promise(resolve => uni.showModal({
      title: '替换高级重复规则？',
      content: `将用“${repeatLabel(kind)}”替换当前完整重复规则，包括间隔、结束条件等设置。此操作不能自动恢复。`,
      confirmText: '替换', success: resolve, fail: () => resolve({ confirm: false })
    }))
    if (result.confirm && session === generation && props.visible && !closeEmitted && draft.repeatRule === original) {
      draft.repeatRule = JSON.stringify({ kind })
      draft.repeatKind = kind
    }
  } finally { if (session === generation) actionBusy.value = false }
}

watch(
  () => props.visible,
  (visible) => {
    clearTimeout(saveTimer)
    generation++
    pendingClose = null
    closeEmitted = false
    saving.value = false
    actionBusy.value = false
    swipe.tracking = false
    swipe.active = false
    cancelSubtaskDrag()
    dragScrollTop.value = 0
    if (!visible) return
    sheetOffset.value = 0
    clearTimeout(swipeBlockTimer)
    swipe.blockClick = false
    initializing = true
    dirty.value = false
    revision = 0
    reminderWarning.value = ''
    error.value = ''; focusedChild.value = ''; scrollTarget.value = ''; permissions.value = reminderState()
    categories.value = getCategories()
    const source = props.task
    newSession = !source?.id
    expectedSnapshot = source?.id ? getTaskSnapshot(source.id) : null
    conflict = !!source?.id && !expectedSnapshot
    if (conflict) error.value = '事项已在其他位置更改或删除，请关闭后重新打开'
    if (source && source.id) {
      const loaded = findTask(source.id)
      Object.assign(draft, {
        id: source.id,
        title: loaded?.title || '',
        categoryId: loaded?.categoryId ?? null,
        plannedDate: loaded?.plannedDate || '',
        plannedTime: loaded?.plannedTime || null,
        plannedEndTime: loaded?.plannedEndTime || null,
        scheduleKind: loaded?.scheduleKind || (loaded?.plannedTime ? 'point' : 'all_day'),
        reminderOffsets: [...(loaded?.reminderOffsets || [])],
        repeatRule: loaded?.repeatRule || '{"kind":"none"}',
        occurrenceOverrides: loaded?.occurrenceOverrides || '{}',
        repeatKind: parseRepeatKind(loaded?.repeatRule),
        priority: loaded?.priority || 'not_urgent_not_important',
        subtasks: listChildren(source.id).map(child => ({ ...child })),
        notes: loaded?.notes || ''
      })
    } else {
      const defaults = getNewTaskDefaults()
      Object.assign(draft, {
        id: '',
        title: '',
        categoryId: defaults.categoryId,
        plannedDate: props.presetDate || '',
        plannedTime: null,
        plannedEndTime: null,
        scheduleKind: 'all_day',
        reminderOffsets: [],
        repeatRule: '{"kind":"none"}',
        occurrenceOverrides: '{}',
        repeatKind: 'none',
        priority: defaults.priority,
        subtasks: [],
        notes: ''
      })
    }
    initializing = false
  }
)

watch(draft, () => {
  if (initializing || !props.visible) return
  revision++
  dirty.value = true
  clearTimeout(saveTimer)
  if (draft.id && !error.value) saveTimer = setTimeout(() => { void flushDraft() }, 650)
}, { deep: true, flush: 'sync' })

function parseRepeatKind(repeatRule) {
  try {
    const rule = JSON.parse(repeatRule || '{}')
    return rule.kind || 'none'
  } catch {
    return 'none'
  }
}

function onDateChange(event) {
  setTime({ plannedDate: event.detail.value })
}

function startSheetSwipe(event, inBody = false) {
  if (event.touches?.length !== 1) { cancelSheetSwipe(); return }
  if (actionBusy.value || pendingClose || dragIndex.value >= 0 || drag.touching || (inBody && dragScrollTop.value > 0)) return
  const touch = event.touches[0]
  swipe.tracking = true
  swipe.active = false
  swipe.startX = touch.clientX
  swipe.startY = swipe.lastY = touch.clientY
  swipe.lastTime = Date.now()
  swipe.velocity = 0
}

function moveSheetSwipe(event) {
  if (!swipe.tracking) return
  if (event.touches?.length !== 1) { cancelSheetSwipe(); return }
  const touch = event.touches[0]
  const dx = touch.clientX - swipe.startX
  const dy = touch.clientY - swipe.startY
  if (!swipe.active && (dy < -8 || Math.abs(dx) > Math.max(12, dy))) { cancelSheetSwipe(); return }
  if (!swipe.active && dy > 8) { swipe.active = true; swipe.blockClick = true }
  if (!swipe.active) return
  event.preventDefault?.()
  const now = Date.now()
  const elapsed = now - swipe.lastTime
  if (elapsed > 0) swipe.velocity = (touch.clientY - swipe.lastY) / elapsed
  swipe.lastY = touch.clientY
  swipe.lastTime = now
  sheetOffset.value = Math.max(0, dy)
}

async function endSheetSwipe(event) {
  if (!swipe.tracking) return
  if (event.touches?.length) { cancelSheetSwipe(); return }
  const active = swipe.active
  const shouldClose = active && (sheetOffset.value >= 110 || (sheetOffset.value >= 35 && swipe.velocity >= 0.6 && Date.now() - swipe.lastTime < 120))
  swipe.tracking = false
  swipe.active = false
  if (active) {
    releaseSwipeBlock()
    event.preventDefault?.()
  }
  if (shouldClose) {
    const session = generation
    const closed = await requestClose()
    if (!closed && session === generation) sheetOffset.value = 0
  } else sheetOffset.value = 0
}

function cancelSheetSwipe() {
  if (swipe.active) releaseSwipeBlock()
  swipe.tracking = false
  swipe.active = false
  sheetOffset.value = 0
}

function releaseSwipeBlock() {
  clearTimeout(swipeBlockTimer)
  swipeBlockTimer = setTimeout(() => { swipe.blockClick = false }, 600)
}

async function addSubtask(index = draft.subtasks.length) {
  const child = { id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: '', status: 'todo' }
  draft.subtasks.splice(index, 0, child)
  focusedChild.value = ''; scrollTarget.value = ''
  await nextTick()
  focusedChild.value = child.id
  scrollTarget.value = `subtask-${child.id}`
}

function removeSubtask(index) {
  draft.subtasks.splice(index, 1)
}

function moveSubtask(index, offset) {
  const target = index + offset
  if (target < 0 || target >= draft.subtasks.length) return
  const children = [...draft.subtasks]
  ;[children[index], children[target]] = [children[target], children[index]]
  draft.subtasks = children
}

function moveSubtaskTo(from, to) {
  if (from === to || from < 0 || to < 0 || from >= draft.subtasks.length || to >= draft.subtasks.length) return
  const children = [...draft.subtasks]
  const [moved] = children.splice(from, 1)
  children.splice(to, 0, moved)
  draft.subtasks = children
}

function recordSubtaskTouch(event) {
  const touch = event.touches?.[0]
  if (!touch || dragIndex.value >= 0) return
  drag.touching = true
  drag.startY = touch.clientY
  drag.y = touch.clientY
}

function startSubtaskDrag(index) {
  if (dragIndex.value >= 0 || actionBusy.value) return
  // 长按前手指已明显移动时按滚动处理，不启动拖动
  if (Math.abs(drag.y - drag.startY) > 12) return
  if (typeof uni === 'undefined' || typeof uni.createSelectorQuery !== 'function') return
  const token = ++drag.token
  const query = uni.createSelectorQuery().in(instance?.proxy)
  query.select('.sheet-body').boundingClientRect()
  query.select('.sheet-body').scrollOffset()
  query.selectAll('.subtask-row').boundingClientRect()
  query.exec((result) => {
    if (token !== drag.token || !props.visible || dragIndex.value >= 0) return
    const [body, offset, rows] = result || []
    if (!body || !Array.isArray(rows) || rows.length < 2) return
    drag.rows = rows.map(row => ({ top: row.top, bottom: row.bottom }))
    drag.bodyTop = body.top
    drag.bodyBottom = body.bottom
    drag.maxScroll = Math.max(0, (offset?.scrollHeight || body.height) - body.height)
    drag.startScrollTop = offset?.scrollTop || 0
    dragScrollTop.value = drag.startScrollTop
    drag.snapshot = draft.subtasks.map(item => item.id)
    dragIndex.value = index
    drag.timer = setInterval(autoScrollSubtasks, 30)
    uni.hideKeyboard?.()
  })
}

function moveSubtaskDrag(event) {
  const touch = event.touches?.[0]
  if (!touch) return
  drag.y = touch.clientY
  if (dragIndex.value < 0) return
  event.preventDefault?.()
  updateDragIndex()
}

function updateDragIndex() {
  if (dragIndex.value < 0 || !drag.rows.length) return
  const shift = dragScrollTop.value - drag.startScrollTop
  let target = drag.rows.length - 1
  for (let index = 0; index < drag.rows.length; index++) {
    const row = drag.rows[index]
    if (drag.y < row.top - shift + (row.bottom - row.top) / 2) { target = index; break }
  }
  if (target === dragIndex.value) return
  moveSubtaskTo(dragIndex.value, target)
  dragIndex.value = target
}

function autoScrollSubtasks() {
  if (dragIndex.value < 0) return
  const edge = 44
  let delta = 0
  if (drag.y < drag.bodyTop + edge) delta = -Math.min(8, Math.ceil((drag.bodyTop + edge - drag.y) / 4))
  else if (drag.y > drag.bodyBottom - edge) delta = Math.min(8, Math.ceil((drag.y - (drag.bodyBottom - edge)) / 4))
  if (!delta) return
  const next = Math.max(0, Math.min(drag.maxScroll, dragScrollTop.value + delta))
  if (next === dragScrollTop.value) return
  dragScrollTop.value = next
  updateDragIndex()
}

function onSubtaskScroll(event) {
  if (dragIndex.value >= 0) return
  const top = event.detail?.scrollTop
  if (typeof top === 'number' && top !== dragScrollTop.value) dragScrollTop.value = top
}

function landSubtaskDrag() {
  drag.touching = false
  if (dragIndex.value < 0) return
  stopSubtaskDrag()
  void flushDraft()
}

function cancelSubtaskDrag() {
  if (dragIndex.value >= 0) {
    const order = new Map(drag.snapshot.map((id, index) => [id, index]))
    draft.subtasks = [...draft.subtasks].sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }
  stopSubtaskDrag()
}

function stopSubtaskDrag() {
  drag.touching = false
  drag.token++
  clearInterval(drag.timer)
  drag.timer = null
  drag.rows = []
  drag.snapshot = []
  dragIndex.value = -1
}

function toggleSubtask(child) {
  child.status = child.status === 'done' ? 'todo' : 'done'
  void flushDraft()
}

function taskInput() {
  const rule = parseRepeatRule(draft.repeatRule)
  return {
    ...(draft.id ? { id: draft.id } : {}),
    title: draft.title.trim(),
    categoryId: draft.categoryId || null,
    plannedDate: draft.plannedDate || null,
    plannedTime: draft.plannedTime,
    plannedEndTime: draft.plannedEndTime,
    scheduleKind: draft.scheduleKind,
    priority: draft.priority,
    repeatRule: draft.repeatKind === rule.kind ? draft.repeatRule : JSON.stringify({ kind: draft.repeatKind }),
    occurrenceOverrides: draft.occurrenceOverrides,
    reminderOffsets: [...draft.reminderOffsets],
    parentTaskId: null,
    notes: draft.notes
  }
}

async function updateReminders(session, promise) {
  const token = ++reminderToken
  const needsReminder = canRemind.value && draft.reminderOffsets.length > 0
  let result
  try { result = await promise }
  catch (cause) { result = { error: cause?.message || String(cause) } }
  if (token !== reminderToken) return
  const warning = reminderSaveMessage(result, needsReminder)
  if (session === generation && props.visible && !closeEmitted) reminderWarning.value = warning
  else if (warning) toast(warning)
}

async function drainDraft(session) {
  saving.value = true
  try {
    while (props.visible && session === generation && dirty.value) {
      const version = revision
      const options = { rememberDefaults: newSession }
      if (draft.id) options.expectedSnapshot = expectedSnapshot
      const saved = saveTask(taskInput(), occurrence.value ? undefined : draft.subtasks.map(child => ({ ...child })), options)
      expectedSnapshot = saved.taskSnapshot
      conflict = false
      initializing = true
      draft.id = occurrence.value ? draft.id : saved.id
      initializing = false
      if (revision === version) dirty.value = false
      error.value = ''
      emit('saved', saved)
      void updateReminders(session, saved.reminderPromise)
    }
    return session === generation
  } catch (cause) {
    if (session === generation) {
      conflict = cause.code === 'TASK_CONFLICT'
      error.value = cause.message || String(cause)
    }
    return false
  } finally {
    if (session === generation) saving.value = false
  }
}

async function flushDraft(required = false) {
  clearTimeout(saveTimer)
  if (!props.visible || initializing) return false
  if (pendingSave) {
    const current = generation
    const previous = pendingGeneration
    const result = await pendingSave
    if (current !== generation) return false
    return previous !== current || (result && dirty.value) ? flushDraft(required) : result
  }
  if (!draft.title.trim()) {
    if (required || draft.id) error.value = '请先填写事项名称'
    return false
  }
  if (!dirty.value) return true
  const session = generation
  pendingGeneration = session
  const operation = drainDraft(session)
  pendingSave = operation
  try {
    const result = await operation
    if (pendingSave === operation) pendingSave = null
    if (session !== generation || !result) return false
    return dirty.value ? flushDraft(required) : true
  } finally { if (pendingSave === operation) pendingSave = null }
}

function requestClose() {
  if (actionBusy.value || closeEmitted) return Promise.resolve(false)
  return finishClose()
}

async function confirmDiscard(session) {
  const version = revision
  const result = await new Promise(resolve => uni.showModal({
    title: '放弃未保存的修改？',
    content: '当前草稿将被丢弃，本机已保存的内容不会更改。确定放弃并关闭吗？',
    success: resolve,
    fail: () => resolve({ confirm: false })
  }))
  if (!result.confirm || session !== generation || revision !== version || !props.visible || closeEmitted) return false
  clearTimeout(saveTimer)
  dirty.value = false
  closeEmitted = true
  emit('close')
  return true
}

function discardAndClose() {
  if (actionBusy.value || closeEmitted) return Promise.resolve(false)
  if (pendingClose) return pendingClose
  const operation = confirmDiscard(generation)
  pendingClose = operation
  void operation.finally(() => { if (pendingClose === operation) pendingClose = null })
  return operation
}

function finishClose() {
  if (pendingClose) return pendingClose
  const session = generation
  const operation = (async () => {
    cancelSubtaskDrag()
    if (conflict) return confirmDiscard(session)
    if ((draft.id || dirty.value) && !draft.title.trim()) {
      const version = revision
      const result = await new Promise(resolve => uni.showModal({
        title: '放弃未保存的修改？',
        content: '事项名称不能为空，当前修改无法保存。放弃修改并关闭吗？已保存的内容会保留。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      }))
      if (session !== generation || revision !== version || !props.visible) return false
      if (!result.confirm) { error.value = '请先填写事项名称'; return false }
      dirty.value = false
      closeEmitted = true
      emit('close')
      return true
    }
    if (draft.id || dirty.value) {
      do {
        if (!await flushDraft(true) || session !== generation || !props.visible) return false
      } while (dirty.value)
    }
    if (session !== generation || !props.visible) return false
    if (reminderWarning.value) toast(reminderWarning.value)
    closeEmitted = true
    emit('close')
    return true
  })()
  pendingClose = operation
  void operation.finally(() => { if (pendingClose === operation) pendingClose = null })
  return operation
}

async function save() {
  if (actionBusy.value || conflict) return
  if (!draft.title.trim()) { error.value = '请先填写事项名称'; return }
  await requestClose()
}

async function remove() {
  if (actionBusy.value) return
  actionBusy.value = true
  clearTimeout(saveTimer)
  const session = generation
  try {
    const result = await new Promise(resolve => uni.showModal({
      title: '删除事项',
      content: (occurrence.value ? '确定删除本次事项吗？' : '确定删除该事项及其子事项吗？') + (dirty.value ? '未保存的草稿也将被放弃。' : ''),
      success: resolve,
      fail: () => resolve({ confirm: false })
    }))
    if (!result.confirm || session !== generation) return
    if (pendingSave) await pendingSave
    if (session !== generation) return
    removeTask(draft.id, { expectedSnapshot })
    dirty.value = false
    toast('已删除')
    emit('saved', null)
    emit('close')
  } catch (cause) {
    if (session === generation) { conflict = cause.code === 'TASK_CONFLICT'; error.value = cause.message || String(cause) }
  } finally { if (session === generation) actionBusy.value = false }
}

function setTime(patch) {
  const next = { ...patch }
  if (next.scheduleKind && next.scheduleKind !== 'all_day') {
    if (!draft.plannedDate) next.plannedDate = todayString()
    if (!draft.plannedTime) next.plannedTime = '09:00'
    if (next.scheduleKind === 'range' && !draft.plannedEndTime) {
      const start = draft.plannedTime || next.plannedTime
      next.plannedEndTime = start < '23:00' ? `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:${start.slice(3)}` : start < '23:59' ? '23:59' : null
    }
  }
  applyTaskTime(draft, next)
}
function toggleOffset(value) {
  if (draft.reminderOffsets.includes(value)) draft.reminderOffsets = draft.reminderOffsets.filter(offset => offset !== value)
  else if (draft.reminderOffsets.length < 3) draft.reminderOffsets = [...draft.reminderOffsets, value].sort((a, b) => a - b)
  else toast('最多选择三个提醒')
}
async function allowNotifications() { await requestNotificationPermission(); permissions.value = reminderState(); if (!permissions.value.notifications) androidSettings('notifications') }
function testReminder() { try { sendReminderTest(); toast('测试通知已提交，请查看通知栏') } catch (cause) { error.value = cause.message || String(cause) } }
async function changeStatus(status) {
  if (actionBusy.value) return
  actionBusy.value = true
  const session = generation
  try {
    if (!await flushDraft(true) || session !== generation || !props.visible) return
    if (status === 'done' && !occurrence.value && draft.subtasks.filter(child => child.title.trim()).length >= 2) {
      const result = await new Promise(resolve => uni.showModal({ title: '完成全部子事项？', content: '确认后将同时完成该事项及全部子事项。', success: resolve, fail: () => resolve({ confirm: false }) }))
      if (!result.confirm || session !== generation) return
    }
    const version = revision
    const saved = saveTask(taskInput(), occurrence.value ? undefined : draft.subtasks.map(child => ({ ...child })), { status, rememberDefaults: newSession, expectedSnapshot })
    expectedSnapshot = saved.taskSnapshot
    conflict = false
    if (revision === version) dirty.value = false
    error.value = ''
    emit('saved', saved)
    void updateReminders(session, saved.reminderPromise)
    if (session === generation) await finishClose()
  } catch (cause) {
    if (session === generation) { conflict = cause.code === 'TASK_CONFLICT'; error.value = cause.message || String(cause) }
  } finally { if (session === generation) actionBusy.value = false }
}

function refreshPermissions() { if (props.visible) permissions.value = reminderState() }
function saveOnHide() { cancelSheetSwipe(); if (props.visible) void flushDraft() }
function saveOnVisibilityChange() {
  // #ifdef H5
  if (document.visibilityState === 'hidden') saveOnHide()
  // #endif
}
onShow(refreshPermissions)
onHide(saveOnHide)
uni.$on('reminder-permissions', refreshPermissions)
onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  clearTimeout(swipeBlockTimer)
  stopSubtaskDrag()
  generation++
  uni.$off('reminder-permissions', refreshPermissions)
})
// #ifdef H5
if (typeof window !== 'undefined') {
  window.addEventListener('focus', refreshPermissions)
  window.addEventListener('blur', saveOnHide)
  document.addEventListener('visibilitychange', saveOnVisibilityChange)
}
onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshPermissions)
  window.removeEventListener('blur', saveOnHide)
  document.removeEventListener('visibilitychange', saveOnVisibilityChange)
})
// #endif
defineExpose({ requestClose, flushDraft })
</script>

<style scoped>
.sheet-body.is-busy { pointer-events: none; }
.sheet-footer { flex: 0 0 auto; padding: 16rpx 32rpx 12rpx; border-top: 2rpx solid #e7eef7; background: #f8fbff; }
.save-feedback { display: flex; align-items: center; justify-content: space-between; min-height: 36rpx; color: var(--muted); font-size: 23rpx; overflow-wrap: anywhere; }
.save-feedback .save-error { margin: 0; }
.save-error-actions { display: flex; flex-shrink: 0; }
.save-feedback button { flex-shrink: 0; margin: 0 0 0 16rpx; padding: 0 20rpx; font-size: 24rpx; color: var(--blue); }
.subtask-check { flex: 0 0 52rpx; width: 52rpx; margin: 0; padding: 0; background: transparent; color: var(--green); line-height: 64rpx; font-size: 34rpx; }
.subtask-check.done { color: var(--green); }
.subtask-order { display: flex; gap: 4rpx; }
.subtask-order button { margin: 0; padding: 0; width: 48rpx; line-height: 64rpx; font-size: 28rpx; color: var(--blue); background: #f1f7ff; }
.subtask-order button[disabled] { opacity: .35; }
.subtask-remove { flex-shrink: 0; margin: 0; padding: 0; line-height: 44rpx; }
.subtask-row button::after, .save-feedback button::after { border: 0; }
.time-types .option-chip, .permission-actions button { margin: 0; }
.option-grid button { margin: 0; line-height: 1.5; }
.option-chip::after, .clear-time::after, .permission-actions button::after { border: 0; }
.clear-time { background: transparent; font-size: 24rpx; color: #929daa; margin: 8rpx 0; text-align: right; }
.permission-hint, .save-error { display: block; font-size: 24rpx; line-height: 1.7; color: #929daa; margin: 12rpx 0 20rpx; }
.save-error { color: var(--danger); }
.permission-actions, .occurrence-status { display: flex; flex-wrap: wrap; gap: 12rpx; margin-bottom: 20rpx; }
.permission-actions button, .occurrence-status button { flex: 1 1 auto; margin: 0; border-radius: 16rpx; font-size: 23rpx; color: #277ac4; background: #eaf4ff; padding: 8rpx 16rpx; }
.occurrence-status button:nth-child(2) { background: #176ab7; color: #fff; font-weight: 600; }
.occurrence-status button:nth-child(3) { background: #fff0ef; color: #9f4245; }
.occurrence-status button::after { border: 0; }
.occurrence-status button[disabled] { opacity: .45; }
.save-feedback { color: #647b93; }
.save-feedback .save-error { color: var(--danger); }
.header-actions { display: flex; align-items: center; min-width: 144rpx; gap: 12rpx; }
.sheet-close { width: 60rpx; height: 60rpx; margin: 0; padding: 0; border-radius: 50%; background: #eef5fc; color: #55728e; font-size: 40rpx; line-height: 56rpx; }
.sheet-close::after { border: 0; }
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.28s ease;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.28s ease;
}

.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}

.sheet-layer {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: flex;
  align-items: flex-end;
  background: rgba(30, 44, 61, 0.45);
}

.sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 88vh;
  max-height: 88vh;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 32rpx 32rpx 0 0;
  background: var(--panel);
  padding-bottom: env(safe-area-inset-bottom);
  transform: translateY(var(--sheet-offset, 0px));
  transition: transform 0.28s ease;
  box-shadow: 0 -12rpx 48rpx rgba(34, 74, 115, .12);
}

.sheet.is-swiping { transition: none; }
.swipe-click-blocker { position: absolute; inset: 0; z-index: 10; }

.sheet-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 104rpx;
  padding: 0 24rpx;
  border-bottom: 2rpx solid #e7eef7;
  background: #fbfdff;
  flex: 0 0 auto;
}

.sheet-grab {
  position: absolute;
  top: 8rpx;
  left: 50%;
  width: 64rpx;
  height: 6rpx;
  border-radius: 999rpx;
  background: #bacbdb;
  transform: translateX(-50%);
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 600;
}

.sheet-save {
  min-width: 144rpx;
  color: var(--blue);
  font-size: 30rpx;
  font-weight: 600;
  text-align: right;
}

.sheet-delete {
  min-width: 64rpx;
  color: var(--danger);
  font-size: 28rpx;
}

.sheet-delete.spacer {
  opacity: 0;
}

.sheet-body {
  flex: 1;
  box-sizing: border-box;
  width: 100%;
  padding: 0 32rpx 40rpx;
  min-height: 0;
}

.title-input {
  width: 100%;
  height: 100rpx;
  border-bottom: 2rpx solid var(--line);
  color: #292b2f;
  font-size: 34rpx;
  font-weight: 600;
}

.sheet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx 0 16rpx;
  border-bottom: 2rpx solid var(--line);
}

.row-label {
  color: #536b83;
  font-size: 28rpx;
  font-weight: 600;
}

.row-value {
  color: #4d5156;
  font-size: 28rpx;
}

.option-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  padding: 20rpx 0 8rpx;
}

.option-chip {
  padding: 14rpx 28rpx;
  border: 2rpx solid #dce8f5;
  border-radius: 999rpx;
  background: #f7faff;
  color: #526b84;
  font-size: 26rpx;
}

.option-chip.active {
  border-color: var(--blue);
  background: var(--blue);
  color: #fff;
}

.subtask-add {
  padding: 30rpx 0;
  border-top: 2rpx solid var(--line);
  border-bottom: 2rpx solid var(--line);
  color: var(--green);
  font-size: 28rpx;
}

.subtask-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 0;
}

.subtask-row.is-dragging {
  background: #eef4fb;
}

.subtask-drag {
  display: flex;
  flex: 0 0 40rpx;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 64rpx;
  color: #b3bdc8;
  font-size: 24rpx;
  letter-spacing: -4rpx;
  user-select: none;
}

.subtask-drag.active {
  color: var(--blue);
}

.subtask-row input {
  flex: 1;
  min-width: 0;
  height: 68rpx;
  border-bottom: 2rpx solid #edf0f2;
  font-size: 28rpx;
}

.subtask-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  background: #f1f3f4;
  color: #9da5ad;
  font-size: 26rpx;
}

.note-area {
  width: 100%;
  min-height: 160rpx;
  margin-top: 20rpx;
  padding: 20rpx 0;
  color: #3d4a58;
  font-size: 28rpx;
  line-height: 1.7;
}
</style>
