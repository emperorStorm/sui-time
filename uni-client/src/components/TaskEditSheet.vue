<template>
  <transition name="sheet">
    <view v-if="visible" class="sheet-layer" @click="emit('close')">
      <view class="sheet" @click.stop>
      <view class="sheet-header">
        <view v-if="draft.id" class="sheet-delete" @click="remove">删除</view>
        <view v-else class="sheet-delete spacer" />
        <text class="sheet-title">{{ draft.id ? '编辑事项' : '新建事项' }}</text>
        <view class="sheet-save" @click="save">保存</view>
      </view>
      <scroll-view class="sheet-body" scroll-y>
        <input class="title-input" v-model="draft.title" placeholder="输入事项名称" maxlength="80" />
        <view class="sheet-row">
          <text class="row-label">◷ 日期</text>
          <picker mode="date" :value="draft.plannedDate || ''" @change="onDateChange">
            <view class="row-value">{{ draft.plannedDate || '未设置' }}</view>
          </picker>
        </view>
        <view class="sheet-row">
          <text class="row-label">⌁ 重复</text>
        </view>
        <view class="option-grid">
          <view v-for="kind in repeatKinds" :key="kind" :class="['option-chip', draft.repeatKind === kind ? 'active' : '']" @click="draft.repeatKind = kind">
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
          <view v-for="cat in categories" :key="cat.id" :class="['option-chip', draft.categoryId === cat.id ? 'active' : '']" :style="draft.categoryId === cat.id ? { borderColor: cat.color, background: cat.color, color: '#fff' } : {}" @click="draft.categoryId = cat.id">
            <text>{{ cat.icon }} {{ cat.name }}</text>
          </view>
        </view>
        <view class="subtask-add" @click="addSubtask"><text>＋ 添加子任务</text></view>
        <view v-for="(subtask, index) in draft.subtasks" :key="index" class="subtask-row">
          <view class="subtask-remove" @click="removeSubtask(index)"><text>×</text></view>
          <input v-model="draft.subtasks[index]" placeholder="子任务" maxlength="60" />
        </view>
        <textarea class="note-area" v-model="draft.notes" placeholder="备注：记录一些细节，未来的自己会感谢你。" maxlength="500" />
      </scroll-view>
      </view>
    </view>
  </transition>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { getCategories, saveTask, removeTask, saveChildren, findTask, listChildren } from '../api/store'
import { repeatLabel } from '../utils/occurrence'
import { toast } from '../utils/platform'

const props = defineProps({
  visible: { type: Boolean, default: false },
  task: { type: Object, default: null },
  presetDate: { type: String, default: '' }
})

const emit = defineEmits(['close', 'saved'])

const categories = ref(getCategories())
const repeatKinds = ['none', 'daily', 'weekly', 'monthly', 'yearly']
const priorities = [
  ['urgent_important', '重要且紧急'],
  ['important_not_urgent', '重要不紧急'],
  ['urgent_not_important', '不重要紧急'],
  ['not_urgent_not_important', '不重要不紧急']
]

const draft = reactive({
  id: '',
  title: '',
  categoryId: categories.value[0]?.id || '',
  plannedDate: '',
  repeatKind: 'none',
  priority: 'not_urgent_not_important',
  subtasks: [],
  notes: ''
})

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    categories.value = getCategories()
    const source = props.task
    if (source && source.id) {
      const loaded = findTask(source.id)
      Object.assign(draft, {
        id: source.id,
        title: loaded?.title || '',
        categoryId: loaded?.categoryId || categories.value[0]?.id || '',
        plannedDate: loaded?.plannedDate || '',
        repeatKind: parseRepeatKind(loaded?.repeatRule),
        priority: loaded?.priority || 'not_urgent_not_important',
        subtasks: listChildren(source.id).map((child) => child.title),
        notes: loaded?.notes || ''
      })
    } else {
      Object.assign(draft, {
        id: '',
        title: '',
        categoryId: categories.value[0]?.id || '',
        plannedDate: props.presetDate || '',
        repeatKind: 'none',
        priority: 'not_urgent_not_important',
        subtasks: [],
        notes: ''
      })
    }
  }
)

function parseRepeatKind(repeatRule) {
  try {
    const rule = JSON.parse(repeatRule || '{}')
    return ['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(rule.kind) ? rule.kind : 'none'
  } catch {
    return 'none'
  }
}

function onDateChange(event) {
  draft.plannedDate = event.detail.value
}

function addSubtask() {
  draft.subtasks.push('')
}

function removeSubtask(index) {
  draft.subtasks.splice(index, 1)
}

function save() {
  const title = draft.title.trim()
  if (!title) {
    toast('请先填写事项名称')
    return
  }
  const input = {
    ...(draft.id ? { id: draft.id } : {}),
    title,
    categoryId: draft.categoryId || null,
    plannedDate: draft.plannedDate || null,
    plannedTime: null,
    plannedEndTime: null,
    scheduleKind: 'all_day',
    priority: draft.priority,
    repeatRule: JSON.stringify({ kind: draft.repeatKind }),
    occurrenceOverrides: '{}',
    reminderOffsets: [],
    parentTaskId: null,
    failureReason: null,
    notes: draft.notes
  }
  const saved = saveTask(input)
  const titles = draft.subtasks.map((item) => item.trim()).filter(Boolean)
  if (titles.length) saveChildren(saved.id, titles)
  toast('已保存', 'success')
  emit('saved', saved)
  emit('close')
}

function remove() {
  uni.showModal({
    title: '删除事项',
    content: '确定删除该事项及其子任务吗？',
    success: (res) => {
      if (!res.confirm) return
      removeTask(draft.id)
      toast('已删除')
      emit('saved', null)
      emit('close')
    }
  })
}
</script>

<style scoped>
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
  max-height: 88vh;
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
