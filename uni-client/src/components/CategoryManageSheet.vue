<template>
  <transition name="page">
    <view v-if="visible" class="manage-page">
      <view class="manage-topbar">
        <view class="topbar-back" @click="requestClose"><text>‹</text></view>
        <view class="topbar-center">
          <text class="topbar-title">分类管理</text>
          <text class="topbar-sub">长按拖动排序</text>
        </view>
        <view class="topbar-spacer" />
      </view>

      <view v-if="loadError" class="storage-error panel"><text>本机数据暂时无法读取</text><text class="storage-error-detail">{{ loadError }}</text><button @click="reload">重试读取</button></view>
      <template v-else>
      <scroll-view class="manage-scroll" scroll-y>
        <view
          v-for="(cat, index) in list"
          :key="cat.id"
          :class="['cat-row', dragIndex === index ? 'dragging' : '']"
          @click="startEdit(cat)"
          @longpress="onDragStart(index)"
          @touchmove="onDragMove"
          @touchend="onDragEnd"
          @touchcancel="cancelDrag"
        >
          <image class="cat-icon" :src="iconSrc(cat)" mode="aspectFit" />
          <text class="cat-name">{{ cat.name }}</text>
          <text class="cat-count">{{ taskCount(cat.id) }}</text>
        </view>
        <view v-if="!list.length" class="cat-empty"><text>还没有分类，点击下方添加</text></view>
      </scroll-view>

      <view class="manage-footer">
        <view class="add-btn" @click="startEdit(null)"><text>＋ 添加</text></view>
      </view>

      <!-- 编辑/新增弹层 -->
      <transition name="sheet">
        <view v-if="editing" class="sheet-layer" @click="editing = false">
          <view class="sheet edit-sheet" @click.stop>
            <view class="sheet-header">
              <view class="sheet-cancel" @click="editing = false">取消</view>
              <text class="sheet-title">{{ draft.id ? '编辑分类' : '新增分类' }}</text>
              <view class="sheet-save" @click="save">保存</view>
            </view>
            <scroll-view class="sheet-body" scroll-y>
              <input class="cat-name-input" v-model="draft.name" placeholder="分类名称" maxlength="12" />
              <view class="field-label">颜色</view>
              <view class="color-grid">
                <view v-for="color in palette" :key="color" :class="['color-dot', draft.color === color ? 'active' : '']" :style="{ background: color }" @click="draft.color = color" />
              </view>
              <view class="field-label">图标</view>
              <view class="icon-grid">
                <view v-for="icon in iconNames" :key="icon" :class="['icon-chip', draft.icon === icon ? 'active' : '']" @click="draft.icon = icon">
                  <image class="icon-chip-img" :src="iconSrcFor(icon, draft.color)" mode="aspectFit" />
                </view>
              </view>
              <view v-if="draft.id" class="cat-delete-btn" @click="confirmRemove"><text>删除此分类</text></view>
            </scroll-view>
          </view>
        </view>
      </transition>
      </template>
    </view>
  </transition>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { getCategories, saveCategory, removeCategory, reorderCategories, listTasks } from '../api/store'
import { toast } from '../utils/platform'

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'changed'])

const list = ref([])
const loadError = ref('')
const taskCounts = ref({})
const submitting = ref(false)
const editing = ref(false)
const draft = reactive({ id: '', name: '', color: '#2996f6', icon: 'monitor' })
const dragIndex = ref(-1)

const palette = ['#2996f6', '#7299d5', '#12bd75', '#ff8545', '#f6b93b', '#a567e6', '#e65f7b', '#5bc8c8', '#8a96a3']
const iconNames = ['monitor', 'bookmark', 'flower', 'star', 'heart', 'bolt', 'dot', 'triangle', 'diamond', 'music', 'sun', 'sparkle']

watch(
  () => props.visible,
  (visible) => {
    dragIndex.value = -1
    editing.value = false
    if (visible) reload()
  },
  { immediate: true }
)

function reload() {
  try {
    const categories = getCategories().map(cat => ({ ...cat }))
    const counts = {}
    listTasks().forEach(task => { if (!task.parentTaskId) counts[task.categoryId] = (counts[task.categoryId] || 0) + 1 })
    list.value = categories
    taskCounts.value = counts
    loadError.value = ''
    return true
  } catch (error) {
    loadError.value = error.message || String(error)
    return false
  }
}

function requestClose() {
  if (submitting.value) return
  if (dragIndex.value >= 0) cancelDrag()
  if (editing.value) { editing.value = false; return }
  emit('close')
}
defineExpose({ requestClose })

function iconSrc(cat) {
  return iconSrcFor(cat.icon, cat.color)
}

function iconSrcFor(icon, color) {
  const name = iconNames.includes(icon) ? icon : 'dot'
  const hex = (color || '#8a96a3').replace('#', '')
  return `/static/category/${name}-${hex}.png`
}

function taskCount(categoryId) {
  return taskCounts.value[categoryId] || 0
}

function startEdit(cat) {
  if (submitting.value || dragIndex.value >= 0 || loadError.value) return
  editing.value = true
  Object.assign(draft, cat
    ? { id: cat.id, name: cat.name, color: cat.color, icon: cat.icon }
    : { id: '', name: '', color: palette[list.value.length % palette.length], icon: iconNames[list.value.length % iconNames.length] })
}

function save() {
  if (submitting.value) return
  const name = draft.name.trim()
  if (!name) { toast('请填写分类名称'); return }
  submitting.value = true
  try {
    saveCategory({ id: draft.id, name, color: draft.color, icon: draft.icon })
    if (!reload()) return
    editing.value = false
    toast('已保存', 'success')
    emit('changed')
  } catch (error) { toast(error.message || String(error)); reload() }
  finally { submitting.value = false }
}

function confirmRemove() {
  if (submitting.value) return
  submitting.value = true
  const id = draft.id
  uni.showModal({
    title: '删除分类',
    content: `删除「${draft.name}」后，该分类下的事项将变为未分类。`,
    success: (res) => {
      if (!res.confirm) return
      try {
        removeCategory(id)
        if (!reload()) return
        editing.value = false
        toast('已删除')
        emit('changed')
      } catch (error) { toast(error.message || String(error)); reload() }
    },
    fail: () => toast('无法打开确认窗口，请重试'),
    complete: () => { submitting.value = false }
  })
}

// 拖动排序
function onDragStart(index) {
  if (submitting.value || editing.value || loadError.value) return
  dragIndex.value = index
}

function onDragMove(event) {
  if (dragIndex.value < 0) return
  const touch = event.touches?.[0]
  if (!touch) return
  const y = touch.clientY - 160 // 减去 topbar 高度
  const targetIndex = Math.max(0, Math.min(list.value.length - 1, Math.floor(y / 56)))
  if (targetIndex !== dragIndex.value) {
    const moved = list.value.splice(dragIndex.value, 1)[0]
    list.value.splice(targetIndex, 0, moved)
    dragIndex.value = targetIndex
  }
}

function onDragEnd() {
  if (dragIndex.value < 0) return
  dragIndex.value = -1
  try {
    reorderCategories(list.value.map((cat) => cat.id))
    if (reload()) emit('changed')
  } catch (error) { toast(error.message || String(error)); reload() }
}

function cancelDrag() {
  dragIndex.value = -1
  reload()
}
</script>

<style scoped>
.page-enter-active,
.page-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
  transform: translateX(40rpx);
}

.manage-page {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
}

.manage-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28rpx;
  padding-top: env(safe-area-inset-top);
  background: var(--panel);
  border-bottom: 2rpx solid var(--line);
  flex: 0 0 auto;
}

.topbar-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 96rpx;
  color: #3d4a58;
  font-size: 56rpx;
}

.topbar-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
}

.topbar-title {
  color: #26282d;
  font-size: 34rpx;
  font-weight: 600;
}

.topbar-sub {
  color: var(--muted);
  font-size: 22rpx;
}

.topbar-spacer {
  width: 72rpx;
}

.manage-scroll {
  flex: 1;
  min-height: 0;
  padding: 0 32rpx;
}

.cat-row {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 28rpx 0;
  border-bottom: 2rpx solid var(--line);
  background: var(--canvas);
}

.cat-row.dragging {
  opacity: 0.6;
  background: #eef4fb;
}

.cat-icon {
  width: 56rpx;
  height: 56rpx;
  flex: 0 0 56rpx;
}

.cat-name {
  flex: 1;
  min-width: 0;
  color: #26282d;
  font-size: 32rpx;
  font-weight: 500;
}

.cat-count {
  color: #b3b9c0;
  font-size: 30rpx;
}

.cat-empty {
  padding: 120rpx 0;
  color: #b3b7bd;
  font-size: 28rpx;
  text-align: center;
}

.manage-footer {
  flex: 0 0 auto;
  padding: 24rpx 32rpx calc(24rpx + env(safe-area-inset-bottom));
  background: var(--panel);
  border-top: 2rpx solid var(--line);
}

.add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28rpx 0;
  color: #3d4a58;
  font-size: 32rpx;
  font-weight: 500;
}

/* 编辑弹层 */
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
  z-index: 1100;
  inset: 0;
  display: flex;
  align-items: flex-end;
  background: rgba(30, 44, 61, 0.45);
}

.sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 80vh;
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

.sheet-cancel {
  min-width: 96rpx;
  color: var(--muted);
  font-size: 30rpx;
}

.sheet-body {
  flex: 1;
  min-height: 0;
  padding: 16rpx 32rpx 48rpx;
}

.cat-name-input {
  width: 100%;
  height: 100rpx;
  border-bottom: 2rpx solid var(--line);
  font-size: 32rpx;
  font-weight: 500;
}

.field-label {
  padding: 32rpx 0 16rpx;
  color: #767b83;
  font-size: 28rpx;
}

.color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 24rpx;
}

.color-dot {
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  border: 6rpx solid transparent;
}

.color-dot.active {
  border-color: #292b2f;
}

.icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.icon-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 84rpx;
  height: 84rpx;
  border: 2rpx solid var(--line);
  border-radius: 18rpx;
  background: #fff;
}

.icon-chip.active {
  border-color: var(--blue);
  background: #eef4fd;
}

.icon-chip-img {
  width: 56rpx;
  height: 56rpx;
}

.cat-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 48rpx;
  padding: 24rpx 0;
  border-radius: 18rpx;
  background: #fdf1f0;
  color: var(--danger);
  font-size: 30rpx;
}
</style>
