<template>
  <view v-if="visible && !suspended" class="adjust-sheet">
    <view class="adjust-header">
      <text class="adjust-name">{{ current?.title || '' }}</text>
    </view>
    <scroll-view class="adjust-body" scroll-y>
      <view class="adjust-row">
        <text class="row-label">◷ 日期</text>
        <picker v-if="!isRepeatSource" mode="date" :value="draft.plannedDate || ''" :disabled="locked" @change="setDate">
          <view class="row-value">{{ draft.plannedDate || '未设置' }} ›</view>
        </picker>
        <text v-else class="row-value is-disabled">{{ draft.plannedDate || '未设置' }}</text>
      </view>
      <text v-if="isRepeatSource" class="adjust-hint">重复事项的当次日期请在规划页调整；修改分类会影响整个重复规则。</text>
      <text v-else-if="occurrence" class="adjust-hint">只调整 {{ occurrence.date }} 这一次，重复规则和其他日期保持不变。</text>
      <text class="field-label">分类</text>
      <view class="option-grid">
        <view :class="['option-chip', draft.categoryId === null ? 'active' : '']" @click="setCategory(null)"><text>未分类</text></view>
        <view v-for="cat in categories" :key="cat.id" :class="['option-chip', draft.categoryId === cat.id ? 'active' : '']" :style="draft.categoryId === cat.id ? { borderColor: cat.color, background: cat.color, color: '#fff' } : {}" @click="setCategory(cat.id)">
          <text>{{ cat.name }}</text>
        </view>
      </view>
      <text v-if="error" class="adjust-error" role="alert">{{ error }}</text>
    </scroll-view>
    <view v-if="confirming" class="confirm-panel" role="alert">
      <text class="confirm-title">放弃未保存的调整？</text>
      <text class="adjust-hint">关闭后，本次日期和分类的调整将不会保存。</text>
      <view class="confirm-actions">
        <button class="adjust-cancel" @click="continueEditing">继续编辑</button>
        <button class="discard-button" @click="discardAndClose">放弃调整</button>
      </view>
    </view>
    <view class="adjust-footer">
      <button class="adjust-cancel" :disabled="locked" @click="requestClose">取消</button>
      <button class="adjust-save" :disabled="locked || !current" @click="save">{{ busy ? '保存中' : '保存' }}</button>
    </view>
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { findTask, getTaskSnapshot, saveTask } from '../api/store'
import { parseOccurrenceId, parseRepeatRule } from '../utils/occurrence'
import { toast } from '../utils/platform'
import { reminderSaveMessage } from '../api/reminders'

const props = defineProps({
  visible: { type: Boolean, default: false },
  suspended: { type: Boolean, default: false },
  task: { type: Object, default: null },
  categories: { type: Array, default: () => [] }
})

const emit = defineEmits(['close', 'saved'])

const current = ref(null)
const busy = ref(false)
const confirming = ref(false)
const error = ref('')
const closing = ref(false)
let generation = 0
let confirmationGeneration = 0
let confirmationDraft = ''
let expectedSnapshot = null
let snapshotReady = false
const draft = reactive({ plannedDate: '', categoryId: null })
const initial = { plannedDate: '', categoryId: null }

const locked = computed(() => busy.value || confirming.value || closing.value || props.suspended)
const occurrence = computed(() => current.value?.id ? parseOccurrenceId(current.value.id) : null)
const isRepeatSource = computed(() => !occurrence.value && Boolean(current.value) && parseRepeatRule(current.value.repeatRule).kind !== 'none')

watch(
  () => props.visible,
  (visible) => {
    generation++
    confirming.value = false
    closing.value = false
    if (!visible) return
    busy.value = false
    error.value = ''
    let task = props.task
    expectedSnapshot = null
    snapshotReady = false
    try {
      task = props.task?.id ? findTask(props.task.id) : null
      expectedSnapshot = props.task?.id ? getTaskSnapshot(props.task.id) : null
      if (!task || !expectedSnapshot) throw new Error('事项已更改或删除，请保留草稿并重新打开')
      snapshotReady = true
    } catch (cause) { error.value = cause.message || String(cause) }
    current.value = task
    initial.plannedDate = task?.plannedDate || ''
    initial.categoryId = task?.categoryId ?? null
    draft.plannedDate = initial.plannedDate
    draft.categoryId = initial.categoryId
  },
  { immediate: true, flush: 'sync' }
)
watch(() => props.suspended, () => {
  generation++
  confirming.value = false
}, { flush: 'sync' })
onBeforeUnmount(() => { generation++ })

function changed() {
  return draft.plannedDate !== initial.plannedDate || draft.categoryId !== initial.categoryId
}

function setDate(event) {
  if (!locked.value) draft.plannedDate = event.detail.value
}

function setCategory(id) {
  if (!locked.value) draft.categoryId = id
}

function requestClose() {
  if (!props.visible || locked.value) return false
  if (changed()) {
    confirmationGeneration = generation
    confirmationDraft = JSON.stringify(draft)
    confirming.value = true
    return false
  }
  closing.value = true
  emit('close')
  return true
}

function continueEditing() {
  confirming.value = false
}

function discardAndClose() {
  if (!confirming.value || busy.value || closing.value || props.suspended || !props.visible) return
  if (confirmationGeneration !== generation || confirmationDraft !== JSON.stringify(draft)) {
    confirming.value = false
    error.value = '草稿已发生变化，请重新确认是否放弃'
    return
  }
  confirming.value = false
  closing.value = true
  emit('close')
}

// 页面返回失败时解锁，保留尚未放弃的草稿供用户重试。
function resumeAfterCloseFailure(message) {
  closing.value = false
  if (message) error.value = message
}

function save() {
  if (locked.value || !props.visible || !current.value) return
  if (!changed()) { closing.value = true; emit('close'); return }
  if (!snapshotReady) { if (!error.value) error.value = '无法读取事项，请保留草稿并重新打开'; return }
  busy.value = true
  error.value = ''
  try {
    const saved = saveTask({
      id: current.value.id,
      ...(isRepeatSource.value ? {} : { plannedDate: draft.plannedDate || null }),
      categoryId: draft.categoryId
    }, undefined, { expectedSnapshot })
    initial.plannedDate = draft.plannedDate
    initial.categoryId = draft.categoryId
    expectedSnapshot = saved.taskSnapshot
    snapshotReady = Boolean(expectedSnapshot)
    current.value = saved
    closing.value = true
    emit('saved', saved)
    emit('close')
    void notifyReminder(saved)
  } catch (cause) {
    error.value = cause?.message || String(cause)
  } finally { busy.value = false }
}

async function notifyReminder(saved) {
  try {
    const result = await saved?.reminderPromise
    const message = reminderSaveMessage(result)
    if (message) toast(message)
  } catch (cause) {
    toast(`事项已保存，提醒排程失败：${cause.message || cause}`)
  }
}

defineExpose({ requestClose, resumeAfterCloseFailure })
</script>

<style scoped>
.adjust-sheet {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  background: var(--panel);
}

.adjust-header {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  flex: 0 0 auto;
  padding: 28rpx 32rpx 20rpx;
  border-bottom: 2rpx solid var(--line);
}

.adjust-title {
  color: #26282d;
  font-size: 32rpx;
  font-weight: 600;
}

.adjust-name {
  overflow: hidden;
  color: var(--muted);
  font-size: 26rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.adjust-body {
  flex: 1;
  min-height: 0;
  height: 0;
  box-sizing: border-box;
  padding: 8rpx 32rpx 24rpx;
}

.adjust-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 26rpx 0 16rpx;
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

.row-value.is-disabled {
  color: #a7b0ba;
}

.adjust-hint {
  display: block;
  margin-top: 12rpx;
  color: #929daa;
  font-size: 23rpx;
  line-height: 1.6;
}

.field-label {
  display: block;
  padding: 28rpx 0 4rpx;
  color: #767b83;
  font-size: 28rpx;
}

.option-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  padding: 12rpx 0 8rpx;
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

.adjust-error {
  display: block;
  margin-top: 12rpx;
  color: var(--danger);
  font-size: 24rpx;
  line-height: 1.6;
}

.adjust-footer {
  display: flex;
  gap: 20rpx;
  flex: 0 0 auto;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid var(--line);
}

.adjust-footer button {
  flex: 1;
  margin: 0;
  font-size: 28rpx;
  line-height: 80rpx;
}

.adjust-footer button::after {
  border: 0;
}

.adjust-cancel {
  border-radius: 16rpx;
  background: #eef4fa;
  color: #526b84;
}

.adjust-save {
  border-radius: 16rpx;
  background: var(--blue);
  color: #fff;
  font-weight: 600;
}

.confirm-panel {
  flex: 0 0 auto;
  margin: 16rpx 32rpx;
  padding: 24rpx;
  border: 2rpx solid var(--line);
  border-radius: 16rpx;
  background: #f7f9fc;
}

.confirm-title { color: #26282d; font-size: 28rpx; font-weight: 600; }
.confirm-actions { display: flex; gap: 20rpx; margin-top: 20rpx; }
.confirm-actions button { flex: 1; margin: 0; font-size: 28rpx; line-height: 80rpx; }
.confirm-actions button::after { border: 0; }
.discard-button { border-radius: 16rpx; background: #fff0ef; color: #b33c35; }
</style>
