<template>
  <transition name="sheet">
    <view v-if="visible" class="adjust-layer" @click="onBackdrop">
      <view class="adjust-sheet" @click.stop>
        <view class="adjust-header">
          <text class="adjust-title">调整事项</text>
          <text class="adjust-name">{{ current?.title || '' }}</text>
        </view>
        <view class="adjust-body">
          <view class="adjust-row">
            <text class="row-label">◷ 日期</text>
            <picker v-if="!isRepeatSource" mode="date" :value="draft.plannedDate || ''" @change="draft.plannedDate = $event.detail.value">
              <view class="row-value">{{ draft.plannedDate || '未设置' }} ›</view>
            </picker>
            <text v-else class="row-value is-disabled">{{ draft.plannedDate || '未设置' }}</text>
          </view>
          <text v-if="isRepeatSource" class="adjust-hint">重复事项的当次日期请在规划页调整；修改分类会影响整个重复规则。</text>
          <text v-else-if="occurrence" class="adjust-hint">只调整 {{ occurrence.date }} 这一次，重复规则和其他日期保持不变。</text>
          <text class="field-label">分类</text>
          <view class="option-grid">
            <view :class="['option-chip', draft.categoryId === null ? 'active' : '']" @click="draft.categoryId = null"><text>未分类</text></view>
            <view v-for="cat in categories" :key="cat.id" :class="['option-chip', draft.categoryId === cat.id ? 'active' : '']" :style="draft.categoryId === cat.id ? { borderColor: cat.color, background: cat.color, color: '#fff' } : {}" @click="draft.categoryId = cat.id">
              <text>{{ cat.name }}</text>
            </view>
          </view>
          <text v-if="error" class="adjust-error">{{ error }}</text>
        </view>
        <view class="adjust-footer">
          <button class="adjust-cancel" :disabled="busy || confirming" @click="requestClose">取消</button>
          <button class="adjust-save" :disabled="busy || confirming" @click="save">{{ busy ? '保存中' : '保存' }}</button>
        </view>
      </view>
    </view>
  </transition>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { findTask, saveTask } from '../api/store'
import { parseOccurrenceId, parseRepeatRule } from '../utils/occurrence'
import { toast } from '../utils/platform'

const props = defineProps({
  visible: { type: Boolean, default: false },
  task: { type: Object, default: null },
  categories: { type: Array, default: () => [] }
})

const emit = defineEmits(['close', 'saved'])

const current = ref(null)
const busy = ref(false)
const confirming = ref(false)
const error = ref('')
const openedAt = ref(0)
let generation = 0
let closed = false
const draft = reactive({ plannedDate: '', categoryId: null })
const initial = { plannedDate: '', categoryId: null }

const occurrence = computed(() => current.value?.id ? parseOccurrenceId(current.value.id) : null)
const isRepeatSource = computed(() => !occurrence.value && Boolean(current.value) && parseRepeatRule(current.value.repeatRule).kind !== 'none')

watch(
  () => props.visible,
  (visible) => {
    generation++
    confirming.value = false
    closed = false
    if (!visible) return
    busy.value = false
    error.value = ''
    openedAt.value = Date.now()
    let task = props.task
    try { task = (props.task && findTask(props.task.id)) || props.task } catch (cause) { error.value = cause.message || String(cause) }
    current.value = task
    initial.plannedDate = task?.plannedDate || ''
    initial.categoryId = task?.categoryId ?? null
    draft.plannedDate = initial.plannedDate
    draft.categoryId = initial.categoryId
  }
)
onBeforeUnmount(() => { generation++ })

function changed() {
  return draft.plannedDate !== initial.plannedDate || draft.categoryId !== initial.categoryId
}

function onBackdrop() {
  // 长按抬起后浏览器补发的 click 会落在刚挂载的遮罩上，短时间内忽略以免弹层自关
  if (Date.now() - openedAt.value < 400) return
  requestClose()
}

async function requestClose() {
  if (!props.visible || busy.value || confirming.value || closed) return false
  const session = generation
  const snapshot = JSON.stringify(draft)
  if (changed()) {
    confirming.value = true
    try {
      const result = await new Promise((resolve, reject) => uni.showModal({
        title: '放弃未保存的调整？',
        content: '关闭后，本次日期和分类的调整将不会保存。',
        confirmText: '放弃',
        success: resolve,
        fail: reject
      }))
      if (!result.confirm || session !== generation || !props.visible || JSON.stringify(draft) !== snapshot) return false
    } catch {
      if (session === generation) error.value = '确认窗口无法打开，请重试'
      return false
    } finally { if (session === generation) confirming.value = false }
  }
  if (session !== generation || !props.visible) return false
  closed = true
  emit('close')
  return true
}

async function save() {
  if (busy.value || confirming.value || closed || !current.value) return
  if (!changed()) { closed = true; emit('close'); return }
  busy.value = true
  error.value = ''
  try {
    const saved = saveTask({
      id: current.value.id,
      ...(isRepeatSource.value ? {} : { plannedDate: draft.plannedDate || null }),
      categoryId: draft.categoryId
    })
    busy.value = false
    closed = true
    emit('saved', saved)
    emit('close')
    void notifyReminder(saved)
  } catch (cause) {
    error.value = cause.message || String(cause)
    busy.value = false
  }
}

async function notifyReminder(saved) {
  try {
    const result = await saved?.reminderPromise
    if (result?.error) toast(`事项已保存，提醒排程失败：${result.error}`)
  } catch (cause) {
    toast(`事项已保存，提醒排程失败：${cause.message || cause}`)
  }
}

defineExpose({ requestClose })
</script>

<style scoped>
.adjust-layer {
  position: fixed;
  z-index: 1200;
  inset: 0;
  display: flex;
  align-items: flex-end;
  background: rgba(30, 44, 61, 0.45);
}

.adjust-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 76vh;
  overflow: hidden;
  border-radius: 32rpx 32rpx 0 0;
  background: var(--panel);
  box-shadow: 0 -12rpx 48rpx rgba(34, 74, 115, 0.12);
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
  padding: 8rpx 32rpx 24rpx;
  overflow-y: auto;
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

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.28s ease;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-active .adjust-sheet,
.sheet-leave-active .adjust-sheet {
  transition: transform 0.28s ease;
}

.sheet-enter-from .adjust-sheet,
.sheet-leave-to .adjust-sheet {
  transform: translateY(100%);
}
</style>
