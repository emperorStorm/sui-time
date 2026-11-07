<template>
  <transition name="page">
    <view v-if="visible" class="manage-page">
      <view class="manage-topbar">
        <button class="topbar-back" aria-label="返回" @click="requestClose">‹</button>
        <view class="topbar-center">
          <text class="topbar-title">分类管理</text>
          <text class="topbar-sub">长按拖动排序</text>
        </view>
        <view class="topbar-spacer" />
      </view>

      <view v-if="loadError" class="storage-error panel"><text>本机数据暂时无法读取</text><text class="storage-error-detail">{{ loadError }}</text><button @click="reload">重试读取</button></view>
      <template v-else>
      <scroll-view class="manage-scroll" scroll-y @scroll="onDragScroll">
        <view
          v-for="(cat, index) in list"
          :key="cat.id"
          :class="['cat-row', dragIndex === index ? 'dragging' : '']"
          @click="startEdit(cat)"
          @touchstart="onTouchStart(index, $event)"
          @longpress="onDragStart(index)"
          @touchmove="onDragMove"
          @touchend="onDragEnd"
          @touchcancel="cancelDrag"
        >
          <image class="cat-icon" :src="iconSrc(cat)" mode="aspectFit" />
          <text class="cat-name">{{ cat.name }}</text>
          <text class="cat-count">{{ taskCount(cat.id) }}</text>
          <view class="cat-order" @click.stop @touchstart.stop>
            <button role="button" :tabindex="index === 0 || submitting ? -1 : 0" :aria-label="`上移${cat.name}`" :disabled="index === 0 || submitting" @click.stop="moveCategory(index, -1)" @keydown.enter.stop.prevent="moveCategory(index, -1)" @keydown.space.stop.prevent="moveCategory(index, -1)">↑</button>
            <button role="button" :tabindex="index === list.length - 1 || submitting ? -1 : 0" :aria-label="`下移${cat.name}`" :disabled="index === list.length - 1 || submitting" @click.stop="moveCategory(index, 1)" @keydown.enter.stop.prevent="moveCategory(index, 1)" @keydown.space.stop.prevent="moveCategory(index, 1)">↓</button>
          </view>
        </view>
        <view v-if="!list.length" class="cat-empty"><text>还没有分类，点击下方添加</text></view>
      </scroll-view>

      <view class="manage-footer">
        <button class="add-btn" @click="startEdit(null)">＋ 添加分类</button>
      </view>

      <!-- 编辑/新增弹层 -->
      <transition name="sheet">
        <view v-if="editing" class="sheet-layer" @click="closeEdit">
          <view class="sheet edit-sheet" @click.stop>
            <view class="sheet-header">
              <button class="sheet-cancel" :disabled="submitting || confirmingClose" @click="closeEdit">取消</button>
              <text class="sheet-title">{{ draft.id ? '编辑分类' : '新增分类' }}</text>
              <button class="sheet-save" :disabled="submitting || confirmingClose" @click="save">保存</button>
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
import { getCurrentInstance, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
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
const confirmingClose = ref(false)
let editGeneration = 0
let editBaseline = ''
const draft = reactive({ id: '', name: '', color: '#2996f6', icon: 'monitor' })
const dragIndex = ref(-1)
const instance = getCurrentInstance()
const drag = {
  token: 0, revision: 0, pending: false, ending: false, touching: false,
  touchIndex: -1, startY: 0, y: 0, moved: false, snapshot: [], blockClick: false, clickTimer: null
}

const palette = ['#2996f6', '#7299d5', '#12bd75', '#ff8545', '#f6b93b', '#a567e6', '#e65f7b', '#5bc8c8', '#8a96a3']
const iconNames = ['monitor', 'bookmark', 'flower', 'star', 'heart', 'bolt', 'dot', 'triangle', 'diamond', 'music', 'sun', 'sparkle']

watch(
  () => props.visible,
  (visible) => {
    editGeneration++
    confirmingClose.value = false
    cancelDrag()
    editing.value = false
    if (visible) reload()
  },
  { immediate: true, flush: 'sync' }
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
  if (submitting.value || confirmingClose.value) return
  if (dragIndex.value >= 0) cancelDrag()
  if (editing.value) { void closeEdit(); return }
  emit('close')
}

async function closeEdit() {
  if (!editing.value || submitting.value || confirmingClose.value) return false
  const session = editGeneration
  const current = JSON.stringify(draft)
  if (current !== editBaseline) {
    confirmingClose.value = true
    try {
      const result = await new Promise((resolve, reject) => uni.showModal({
        title: '放弃未保存的分类修改？',
        content: '关闭后，本次修改将不会保存。',
        confirmText: '放弃',
        success: resolve,
        fail: reject
      }))
      if (!result.confirm || session !== editGeneration || !editing.value || JSON.stringify(draft) !== current) return false
    } catch {
      if (session === editGeneration) toast('确认窗口无法打开，请重试')
      return false
    } finally { if (session === editGeneration) confirmingClose.value = false }
  }
  if (session !== editGeneration || !editing.value) return false
  editing.value = false
  return true
}
defineExpose({ requestClose })

function iconSrc(cat) {
  return iconSrcFor(cat.icon, cat.color)
}

function iconSrcFor(icon, color) {
  const name = iconNames.includes(icon) ? icon : 'dot'
  const normalized = typeof color === 'string' ? color.toLowerCase() : ''
  const hex = (palette.includes(normalized) ? normalized : '#8a96a3').slice(1)
  return `/static/category/${name}-${hex}.png`
}

function taskCount(categoryId) {
  return taskCounts.value[categoryId] || 0
}

function startEdit(cat) {
  if (submitting.value || confirmingClose.value || dragIndex.value >= 0 || drag.blockClick || loadError.value) return
  editGeneration++
  Object.assign(draft, cat
    ? { id: cat.id, name: cat.name, color: cat.color, icon: cat.icon }
    : { id: '', name: '', color: palette[list.value.length % palette.length], icon: iconNames[list.value.length % iconNames.length] })
  editBaseline = JSON.stringify(draft)
  editing.value = true
}

function save() {
  if (submitting.value || confirmingClose.value) return
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
  if (submitting.value || confirmingClose.value) return
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
function moveCategory(index, offset) {
  const target = index + offset
  if (submitting.value || editing.value || loadError.value || dragIndex.value >= 0 || target < 0 || target >= list.value.length) return
  const ids = list.value.map(cat => cat.id)
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  submitting.value = true
  try {
    reorderCategories(ids)
    if (reload()) emit('changed')
  } catch (error) { toast(error.message || String(error)); reload() }
  finally { submitting.value = false }
}

function onTouchStart(index, event) {
  if (event.touches?.length !== 1) { cancelDrag(); return }
  if (dragIndex.value >= 0) return
  const y = event.touches[0].clientY
  if (!Number.isFinite(y)) return
  drag.touching = true
  drag.touchIndex = index
  drag.startY = y
  drag.y = y
  drag.moved = false
}

function onDragStart(index) {
  if (submitting.value || editing.value || loadError.value || dragIndex.value >= 0 ||
      !drag.touching || drag.touchIndex !== index || drag.moved) return
  if (typeof uni === 'undefined' || typeof uni.createSelectorQuery !== 'function') {
    toast('无法获取分类位置，请重试')
    return
  }
  drag.token++
  drag.snapshot = [...list.value]
  drag.ending = false
  drag.blockClick = true
  clearTimeout(drag.clickTimer)
  dragIndex.value = index
}

function onDragMove(event) {
  if (!drag.touching || drag.ending) return
  if (event.touches?.length !== 1) { cancelDrag(); return }
  const y = event.touches[0].clientY
  if (!Number.isFinite(y)) return
  drag.y = y
  if (Math.abs(y - drag.startY) > 12) drag.moved = true
  if (dragIndex.value < 0) return
  event.preventDefault?.()
  queueDragMeasurement()
}

function onDragScroll() {
  if (dragIndex.value >= 0) queueDragMeasurement()
  else if (drag.touching) drag.moved = true
}

function queueDragMeasurement() {
  drag.revision++
  if (drag.pending) return
  drag.pending = true
  const token = drag.token
  nextTick(() => {
    if (token !== drag.token) return
    const revision = drag.revision
    try {
      const query = uni.createSelectorQuery().in(instance?.proxy)
      query.select('.manage-scroll').boundingClientRect()
      query.selectAll('.cat-row').boundingClientRect()
      query.exec((result) => {
        if (token !== drag.token) return
        drag.pending = false
        if (revision !== drag.revision) { queueDragMeasurement(); return }
        const [viewport, rows] = result || []
        if (!viewport || !Number.isFinite(viewport.top) || !Number.isFinite(viewport.bottom) ||
            !Array.isArray(rows) || rows.length !== list.value.length ||
            rows.some(row => !row || !Number.isFinite(row.top) || !Number.isFinite(row.bottom))) {
          cancelDrag()
          toast('无法获取分类位置，请重试')
          return
        }
        // 只比较滚动区域内可见行，坐标与 touch.clientY 同为视口坐标。
        const y = Math.max(viewport.top, Math.min(viewport.bottom, drag.y))
        let target = -1
        let distance = Infinity
        rows.forEach((row, index) => {
          if (row.bottom <= viewport.top || row.top >= viewport.bottom) return
          const nextDistance = Math.abs(y - (row.top + row.bottom) / 2)
          if (nextDistance < distance) { target = index; distance = nextDistance }
        })
        if (target >= 0 && target !== dragIndex.value) {
          const moved = list.value.splice(dragIndex.value, 1)[0]
          list.value.splice(target, 0, moved)
          dragIndex.value = target
        }
        if (drag.ending) commitDrag()
      })
    } catch (error) {
      if (token !== drag.token) return
      cancelDrag()
      toast('无法获取分类位置，请重试')
    }
  })
}

function onDragEnd(event) {
  if (event.touches?.length) { cancelDrag(); return }
  drag.touching = false
  if (dragIndex.value < 0 || drag.ending) return
  const y = event.changedTouches?.[0]?.clientY
  if (Number.isFinite(y) && y !== drag.y) {
    drag.y = y
    queueDragMeasurement()
  }
  drag.ending = true
  if (!drag.pending) commitDrag()
}

function commitDrag() {
  const snapshot = drag.snapshot
  stopDrag()
  try {
    reorderCategories(list.value.map((cat) => cat.id))
    if (reload()) emit('changed')
  } catch (error) {
    list.value = snapshot
    toast(error.message || String(error))
    reload()
  }
}

function cancelDrag() {
  if (dragIndex.value >= 0) list.value = drag.snapshot
  stopDrag()
}

function stopDrag() {
  drag.token++
  drag.pending = false
  drag.ending = false
  drag.touching = false
  drag.touchIndex = -1
  drag.snapshot = []
  dragIndex.value = -1
  if (drag.blockClick) {
    clearTimeout(drag.clickTimer)
    drag.clickTimer = setTimeout(() => { drag.blockClick = false }, 600)
  }
}

onBeforeUnmount(() => {
  editGeneration++
  cancelDrag()
  clearTimeout(drag.clickTimer)
})
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
  padding-top: var(--top-safe-area);
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
  margin: 0;
  padding: 0;
  background: transparent;
  line-height: 96rpx;
  color: #3d4a58;
  font-size: 56rpx;
}
.topbar-back::after { border: 0; }

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
  color: var(--muted);
  font-size: 26rpx;
}

.cat-order { display: flex; flex-shrink: 0; gap: 4rpx; }
.cat-order button { width: 104rpx; min-height: 104rpx; margin: 0; padding: 0; border-radius: 14rpx; background: #eaf3fc; color: var(--blue); font-size: 30rpx; line-height: 104rpx; }
.cat-order button::after { border: 0; }
.cat-order button:focus-visible { outline: 4rpx solid #79a9d7; outline-offset: -4rpx; }
.cat-order button[disabled] { color: #9baabd; background: #f2f5f8; }

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
  width: 100%;
  margin: 0;
  padding: 24rpx 0;
  border-radius: 16rpx;
  background: var(--blue-soft);
  color: var(--blue);
  font-size: 30rpx;
  font-weight: 600;
}
.add-btn::after { border: 0; }

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

.sheet-header button { margin: 0; padding: 0; background: transparent; line-height: 72rpx; }
.sheet-header button::after { border: 0; }
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
