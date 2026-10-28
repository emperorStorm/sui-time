<template>
  <transition name="sheet">
    <view v-if="visible" class="sheet-layer" @click="requestClose">
      <view class="sheet" @click.stop>
      <view class="sheet-header">
        <view v-if="draft.id" class="sheet-delete" @click="remove">删除</view>
        <view v-else class="sheet-delete spacer" />
        <text class="sheet-title">{{ draft.id ? '编辑事项' : '新建事项' }}</text>
        <view class="sheet-save" @click="save">{{ saving ? '保存中' : '保存' }}</view>
      </view>
      <scroll-view :class="['sheet-body', { 'is-busy': actionBusy }]" scroll-y :scroll-into-view="scrollTarget" :scroll-with-animation="false">
        <input class="title-input" v-model="draft.title" placeholder="输入事项名称" :maxlength="Math.max(120, draft.title.length)" @blur="flushDraft()" />
        <view class="sheet-row">
          <text class="row-label">◷ 日期</text>
          <picker mode="date" :value="draft.plannedDate || ''" @change="onDateChange">
            <view class="row-value">{{ draft.plannedDate || '未设置' }} ›</view>
          </picker>
        </view>
        <view class="option-grid time-types"><button v-for="[value, label] in [['all_day', '全天'], ['point', '时间点'], ['range', '时间段']]" :key="value" :class="['option-chip', { active: draft.scheduleKind === value }]" @click="setTime({ scheduleKind: value })">{{ label }}</button></view>
        <view v-if="draft.scheduleKind !== 'all_day'" class="sheet-row"><text class="row-label">开始时间</text><picker mode="time" :value="draft.plannedTime || '09:00'" @change="setTime({ plannedTime: $event.detail.value })"><view class="row-value">{{ draft.plannedTime || '请选择' }} ›</view></picker></view>
        <view v-if="draft.scheduleKind === 'range'" class="sheet-row"><text class="row-label">结束时间</text><picker mode="time" :value="draft.plannedEndTime || '10:00'" @change="setTime({ plannedEndTime: $event.detail.value })"><view class="row-value">{{ draft.plannedEndTime || '请选择' }} ›</view></picker></view>
        <button class="clear-time" @click="setTime({ plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day' })">清除日期与时间</button>
        <template v-if="canRemind"><view class="sheet-row"><text class="row-label">♧ 是否提醒</text><switch :checked="draft.reminderOffsets.length > 0" color="#2996f6" @change="draft.reminderOffsets = $event.detail.value ? [0] : []" /></view><view v-if="draft.reminderOffsets.length" class="option-grid"><button v-for="[value, label] in reminderOptions" :key="value" :class="['option-chip', { active: draft.reminderOffsets.includes(value) }]" @click="toggleOffset(value)">{{ label }}</button></view><text class="permission-hint">{{ permissionMessage }}</text><view v-if="permissions.supported" class="permission-actions"><button v-if="!permissions.notifications" @click="allowNotifications">允许系统通知</button><button v-if="!permissions.exactAlarm" @click="androidSettings('alarm')">允许准时提醒</button><button @click="androidSettings('notifications')">通知设置</button><button v-if="permissions.notifications" @click="testReminder">测试通知</button></view></template>
        <view class="sheet-row">
          <text class="row-label">⌁ 重复</text>
        </view>
        <view class="option-grid">
          <view v-for="kind in repeatKinds" :key="kind" :class="['option-chip', draft.repeatKind === kind ? 'active' : '']" @click="!occurrence && (draft.repeatKind = kind)">
            <text>{{ repeatLabel(kind) }}</text>
          </view>
        </view>
        <view class="sheet-row">
          <text class="row-label">⚑ 优先级</text>
        </view>
        <view class="option-grid">
          <view v-for="[value, label] in priorities" :key="value" :class="['option-chip', draft.priority === value ? 'active' : '']" @click="draft.priority = value">
            <text>{{ label }}</text>
          </view>
        </view>
        <view class="sheet-row">
          <text class="row-label">▦ 分类</text>
        </view>
        <view class="option-grid">
          <view :class="['option-chip', draft.categoryId === null ? 'active' : '']" @click="draft.categoryId = null"><text>未分类</text></view>
          <view v-for="cat in categories" :key="cat.id" :class="['option-chip', draft.categoryId === cat.id ? 'active' : '']" :style="draft.categoryId === cat.id ? { borderColor: cat.color, background: cat.color, color: '#fff' } : {}" @click="draft.categoryId = cat.id">
            <text>{{ cat.icon }} {{ cat.name }}</text>
          </view>
        </view>
        <template v-if="!occurrence">
          <view class="subtask-add" @click="addSubtask()"><text>＋ 添加子事项</text></view>
          <view v-for="(subtask, index) in draft.subtasks" :key="subtask.id" :id="`subtask-${subtask.id}`" class="subtask-row">
            <button v-if="draft.repeatKind === 'none'" :class="['subtask-check', { done: subtask.status === 'done' }]" :aria-label="subtask.status === 'done' ? '恢复子事项' : '完成子事项'" @click="toggleSubtask(subtask)">{{ subtask.status === 'done' ? '✓' : '○' }}</button>
            <input v-model="subtask.title" :focus="focusedChild === subtask.id" @focus="focusedChild = subtask.id" @blur="flushDraft()" @confirm="addSubtask(index + 1)" placeholder="子事项" :maxlength="Math.max(120, subtask.title.length)" confirm-type="next" />
            <view class="subtask-order"><button :disabled="index === 0" aria-label="上移子事项" @click="moveSubtask(index, -1)">↑</button><button :disabled="index === draft.subtasks.length - 1" aria-label="下移子事项" @click="moveSubtask(index, 1)">↓</button></view>
            <button class="subtask-remove" aria-label="删除子事项" @click="removeSubtask(index)">×</button>
          </view>
        </template>
        <text v-if="occurrence" class="permission-hint">正在编辑 {{ occurrence.date }} 的当次事项，重复规则和源子事项保持不变。</text>
        <textarea class="note-area" v-model="draft.notes" auto-height :maxlength="Math.max(1000, draft.notes.length)" @blur="flushDraft()" placeholder="备注：记录一些细节，未来的自己会感谢你。" />
      </scroll-view>
      <view class="sheet-footer">
        <view class="save-feedback" aria-live="polite"><text :class="{ 'save-error': error }">{{ error || reminderWarning || (saving ? '正在保存…' : dirty ? '有未保存的修改' : draft.id ? '已保存' : '填写后保存') }}</text><button v-if="error" @click="flushDraft(true)">重试</button></view>
        <view v-if="draft.id && (occurrence || draft.repeatKind === 'none')" class="occurrence-status"><button :disabled="actionBusy" @click="changeStatus('todo')">恢复待办</button><button :disabled="actionBusy" @click="changeStatus('done')">{{ occurrence ? '完成本次' : '完成事项' }}</button><button :disabled="actionBusy" @click="changeStatus('failed')">标记失败</button></view>
      </view>
      </view>
    </view>
  </transition>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { getCategories, getNewTaskDefaults, saveTask, removeTask, findTask, listChildren } from '../api/store'
import { parseOccurrenceId, parseRepeatRule, repeatLabel } from '../utils/occurrence'
import { applyTaskTime, hasReminderTime, priorities, reminderOptions } from '../utils/task'
import { todayString } from '../utils/date'
import { reminderState, sendReminderTest } from '../api/reminders'
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
let saveTimer
let pendingSave = null
let pendingGeneration = 0
const focusedChild = ref('')
const scrollTarget = ref('')
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

watch(
  () => props.visible,
  (visible) => {
    clearTimeout(saveTimer)
    generation++
    if (!visible) return
    initializing = true
    dirty.value = false
    revision = 0
    reminderWarning.value = ''
    error.value = ''; focusedChild.value = ''; scrollTarget.value = ''; permissions.value = reminderState()
    categories.value = getCategories()
    const source = props.task
    newSession = !source?.id
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
  const result = await promise
  if (session !== generation) return
  reminderWarning.value = result.error ? `事项已保存，提醒排程失败：${result.error}` : result.supported && canRemind.value && draft.reminderOffsets.length && (!result.notifications || !result.exactAlarm) ? '事项已保存，需开启通知和准时提醒权限' : ''
}

async function drainDraft(session) {
  saving.value = true
  try {
    while (props.visible && session === generation && dirty.value) {
      const version = revision
      const saved = saveTask(taskInput(), occurrence.value ? undefined : draft.subtasks.map(child => ({ ...child })), { rememberDefaults: newSession })
      initializing = true
      draft.id = occurrence.value ? draft.id : saved.id
      initializing = false
      if (revision === version) dirty.value = false
      error.value = ''
      emit('saved', saved)
      await updateReminders(session, saved.reminderPromise)
    }
    return session === generation
  } catch (cause) {
    if (session === generation) error.value = cause.message || String(cause)
    return false
  } finally {
    saving.value = false
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
  pendingSave = drainDraft(session)
  try { return await pendingSave }
  finally { pendingSave = null }
}

async function requestClose() {
  if (actionBusy.value) return false
  if (!draft.id && !dirty.value) { emit('close'); return true }
  if (!await flushDraft(true)) return false
  emit('close')
  return true
}

async function save() {
  if (actionBusy.value) return
  if (!draft.id && !dirty.value) { error.value = '请先填写事项名称'; return }
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
      content: occurrence.value ? '确定删除本次事项吗？' : '确定删除该事项及其子事项吗？',
      success: resolve,
      fail: () => resolve({ confirm: false })
    }))
    if (!result.confirm || session !== generation) return
    if (pendingSave) await pendingSave
    if (session !== generation) return
    removeTask(draft.id)
    dirty.value = false
    toast('已删除')
    emit('saved', null)
    emit('close')
  } catch (cause) { error.value = cause.message || String(cause) }
  finally { actionBusy.value = false }
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
    if (!await flushDraft(true)) return
    if (status === 'done' && !occurrence.value && draft.subtasks.filter(child => child.title.trim()).length >= 2) {
      const result = await new Promise(resolve => uni.showModal({ title: '完成全部子事项？', content: '确认后将同时完成该事项及全部子事项。', success: resolve, fail: () => resolve({ confirm: false }) }))
      if (!result.confirm || session !== generation) return
    }
    const saved = saveTask(taskInput(), occurrence.value ? undefined : draft.subtasks.map(child => ({ ...child })), { status, rememberDefaults: newSession })
    dirty.value = false
    error.value = ''
    emit('saved', saved)
    await updateReminders(session, saved.reminderPromise)
    if (session === generation) emit('close')
  } catch (cause) { error.value = cause.message || String(cause) }
  finally { actionBusy.value = false }
}

function refreshPermissions() { if (props.visible) permissions.value = reminderState() }
function saveOnHide() { if (props.visible) void flushDraft() }
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
.sheet-footer { flex: 0 0 auto; padding: 12rpx 32rpx; border-top: 2rpx solid var(--line); }
.save-feedback { display: flex; align-items: center; justify-content: space-between; min-height: 36rpx; color: var(--muted); font-size: 23rpx; overflow-wrap: anywhere; }
.save-feedback .save-error { margin: 0; }
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
.permission-actions button, .occurrence-status button { font-size: 23rpx; color: var(--blue); background: #f1f7ff; padding: 4rpx 16rpx; }
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
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 104rpx;
  padding: 0 24rpx;
  border-bottom: 2rpx solid var(--line);
  flex: 0 0 auto;
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 600;
}

.sheet-save {
  min-width: 96rpx;
  color: var(--blue);
  font-size: 30rpx;
  font-weight: 600;
  text-align: right;
}

.sheet-delete {
  min-width: 96rpx;
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
  color: #767b83;
  font-size: 28rpx;
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
  border: 2rpx solid var(--line);
  border-radius: 999rpx;
  background: #fff;
  color: #62666d;
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
  gap: 16rpx;
  padding: 12rpx 0;
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
