<template>
  <view class="page tasks-page">
    <view class="topbar">
      <view class="topbar-menu" @click="onMenu">
        <text class="menu-icon">≡</text>
        <view v-if="ready && todoCount" class="menu-badge"><text>{{ todoCount > 99 ? '99+' : todoCount }}</text></view>
      </view>
      <view class="topbar-title">本周事项 <text class="title-arrow">▾</text></view>
      <view class="topbar-action" @click="onMore"><text>···</text></view>
    </view>

    <view v-if="loadError" class="storage-error panel"><text>本机数据暂时无法读取</text><text class="storage-error-detail">{{ loadError }}</text><button @click="load">重试读取</button></view>
    <template v-else-if="ready">
    <scroll-view class="filter-bar" scroll-x>
      <view :class="['filter-chip', 'chip-all', filter === 'all' ? 'active' : '']" @click="filter = 'all'"><text>全部</text></view>
      <view v-for="cat in categories" :key="cat.id" :class="['filter-chip', 'chip-cat', filter === cat.id ? 'active' : '']" :style="{ background: cat.color, '--chip-color': cat.color }" @click="filter = cat.id">
        <text>{{ cat.name }}</text>
      </view>
      <view class="filter-chip chip-add" @click="manageVisible = true"><text>＋</text></view>
    </scroll-view>

    <view class="search-tools">
      <view class="search-row"><input v-model="searchInput" class="search-input" placeholder="搜索标题或备注" /><button class="date-toggle" @click="dateExpanded = !dateExpanded">日期筛选 {{ dateExpanded ? '▴' : '▾' }}</button></view>
      <text v-if="appliedRange.startDate || appliedRange.endDate" class="range-summary">生效：{{ appliedRange.startDate || '不限' }} 至 {{ appliedRange.endDate || '不限' }}</text>
      <view v-if="dateExpanded" class="date-panel">
        <view class="date-inputs"><picker mode="date" :value="pendingStart" @change="pendingStart = $event.detail.value"><view>开始：{{ pendingStart || '不限' }}</view></picker><picker mode="date" :value="pendingEnd" @change="pendingEnd = $event.detail.value"><view>结束：{{ pendingEnd || '不限' }}</view></picker></view>
        <view class="date-actions"><button @click="applyDates">应用</button><button @click="clearDates">清除日期</button></view>
        <text v-if="dateError" class="date-error">{{ dateError }}</text>
        <text class="date-hint">重复事项按起始日期筛选，当次安排请到规划页查看</text>
      </view>
    </view>

    <scroll-view class="task-scroll" scroll-y>
      <view v-if="groups.length" class="shell">
        <view v-for="group in groups" :key="group.label" class="task-group panel">
          <view class="group-header" @click="toggleGroup(group.label)">
            <text class="group-label">{{ group.label }}</text>
            <view class="group-right">
              <text class="group-count">{{ group.items.length }}</text>
              <text :class="['group-arrow', isCollapsed(group.label) ? 'collapsed' : '']">∧</text>
            </view>
          </view>
          <template v-if="!isCollapsed(group.label)">
            <view v-for="task in group.items" :key="task.id" class="task-item" @click="openEdit(task)">
              <view :class="['task-check', task.status === 'done' ? 'done' : '']" :style="checkStyle(task)" @click.stop="toggle(task)">
                <text v-if="task.status === 'done'">✓</text>
              </view>
              <view class="task-main">
                <text :class="['task-title', task.status === 'done' ? 'is-done' : '']"><text class="task-priority">{{ taskMark(task) }}</text>{{ task.title }}</text>
                <text class="task-meta">{{ metaOf(task) }}</text>
              </view>
              <text class="task-chevron">⌄</text>
            </view>
          </template>
        </view>
      </view>
      <view v-else class="list-empty">
        <text>{{ hasConditions ? '没有符合条件的事项' : '暂时没有事项' }}</text>
        <button v-if="hasConditions" class="clear-filters" @click="clearFilters">清除搜索与日期条件</button>
      </view>
    </scroll-view>

    <view class="fab" @click="openEdit(null)"><text>＋</text></view>

    <TaskEditSheet ref="taskSheet" :visible="sheetVisible" :task="editingTask" @close="closeSheet" @saved="reload" />
    <CategoryManageSheet ref="categorySheet" :visible="manageVisible" @close="manageVisible = false" @changed="onCategoriesChanged" />
    </template>
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onShow, onBackPress } from '@dcloudio/uni-app'
import TaskEditSheet from '../../components/TaskEditSheet.vue'
import CategoryManageSheet from '../../components/CategoryManageSheet.vue'
import { getCategories, listTasks, setTaskStatus, getSettings, getHideCompleted, toggleGroupCollapsed } from '../../api/store'
import { repeatLabel } from '../../utils/occurrence'
import { occursOn } from '../../utils/occurrence'
import { compareTasks, matchesTaskFilter, taskMark, validateTaskDateRange } from '../../utils/task'
import { shortDate, weekday, todayString } from '../../utils/date'
import { toast } from '../../utils/platform'

const categories = ref([])
const ready = ref(false)
const loadError = ref('')
const taskSheet = ref(null)
const categorySheet = ref(null)
const toggling = ref(false)
const filter = ref('all')
const allTasks = ref([])
const sheetVisible = ref(false)
const editingTask = ref(null)
const manageVisible = ref(false)
const collapsedGroups = ref([])
const hideCompleted = ref(true)
const searchInput = ref('')
const searchQuery = ref('')
const dateExpanded = ref(false)
const pendingStart = ref('')
const pendingEnd = ref('')
const dateError = ref('')
const appliedRange = ref({ startDate: '', endDate: '' })
const hasConditions = computed(() => Boolean(searchInput.value.trim() || appliedRange.value.startDate || appliedRange.value.endDate || filter.value !== 'all'))
let searchTimer
watch(searchInput, value => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { searchQuery.value = value.trim() }, 180)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

function applyDates() {
  try {
    validateTaskDateRange(pendingStart.value, pendingEnd.value)
    appliedRange.value = { startDate: pendingStart.value, endDate: pendingEnd.value }
    dateError.value = ''
  } catch (error) { dateError.value = error.message }
}
function clearDates() {
  pendingStart.value = ''; pendingEnd.value = ''; dateError.value = ''
  appliedRange.value = { startDate: '', endDate: '' }
}
function clearFilters() {
  searchInput.value = ''; searchQuery.value = ''
  clearTimeout(searchTimer)
  clearDates()
}

const todoCount = computed(() => allTasks.value.filter((task) => !task.parentTaskId && task.status !== 'done').length)

function onCategoriesChanged() {
  load()
}

const groups = computed(() => {
  const conditions = { query: searchQuery.value, ...appliedRange.value, categoryId: filter.value, hideCompleted: hideCompleted.value }
  const source = allTasks.value.filter(task => matchesTaskFilter(task, conditions))
  const today = todayString()
  const bucket = { '今天': [], '7天内': [], '稍后': [] }
  source.forEach((task) => {
    if (task.parentTaskId) return
    if (occursOnToday(task, today)) bucket['今天'].push(task)
    else if (isWithinWeek(task.plannedDate, today)) bucket['7天内'].push(task)
    else bucket['稍后'].push(task)
  })
  return Object.keys(bucket).map((label) => ({ label, items: bucket[label].sort(compareTasks) })).filter((group) => group.items.length)
})

onShow(load)
onBackPress(() => {
  if (sheetVisible.value) { taskSheet.value?.requestClose(); return true }
  if (manageVisible.value) { categorySheet.value?.requestClose(); return true }
  return false
})

function load() {
  try {
    const tasks = listTasks().map(task => ({ ...task }))
    const cats = getCategories().map(cat => ({ ...cat }))
    const nextSettings = { ...getSettings() }
    allTasks.value = tasks
    categories.value = cats
    hideCompleted.value = getHideCompleted('tasks')
    collapsedGroups.value = [...(nextSettings.collapsedGroups || [])]
    if (filter.value !== 'all' && !cats.some(cat => cat.id === filter.value)) filter.value = 'all'
    loadError.value = ''
    ready.value = true
    return true
  } catch (error) {
    loadError.value = error.message || String(error)
    ready.value = false
    return false
  }
}

function isCollapsed(label) {
  return collapsedGroups.value.includes(label)
}

function toggleGroup(label) {
  try { collapsedGroups.value = [...toggleGroupCollapsed(label)] }
  catch (error) { toast(error.message || String(error)); load() }
}

function occursOnToday(task, today) {
  return occursOn(task, today)
}

function isWithinWeek(plannedDate, today) {
  return Boolean(plannedDate && plannedDate > today && plannedDate <= addDays(today, 7))
}

function parseKind(repeatRule) {
  try {
    return JSON.parse(repeatRule || '{}').kind || 'none'
  } catch {
    return 'none'
  }
}

function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + amount)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function colorOf(task) {
  return categories.value.find(cat => cat.id === task.categoryId)?.color || '#8b98a8'
}

function checkStyle(task) {
  const color = colorOf(task)
  return task.status === 'done' ? { borderColor: color, background: color } : { borderColor: color }
}

function metaOf(task) {
  const parts = []
  if (task.plannedDate) {
    parts.push(task.plannedDate === todayString() ? '今天' : `${shortDate(task.plannedDate)} ${weekday(task.plannedDate)}`)
  }
  const kind = parseKind(task.repeatRule)
  if (kind !== 'none') parts.push(`↻ ${repeatLabel(kind)}`)
  if (task.plannedTime) parts.push(task.plannedTime)
  const children = allTasks.value.filter(child => child.parentTaskId === task.id && child.title?.trim())
  if (children.length) {
    const done = children.filter((child) => child.status === 'done').length
    parts.push(`子任务${done}/${children.length}`)
  }
  return parts.join(' ')
}

async function toggle(task) {
  if (toggling.value || sheetVisible.value || loadError.value) return
  if (parseKind(task.repeatRule) !== 'none') { toast('请在规划月历中更新当次事项状态'); return }
  toggling.value = true
  try {
    const current = listTasks().find(item => item.id === task.id)
    if (!current) throw new Error('事项不存在')
    const children = listTasks().filter(child => child.parentTaskId === current.id && child.title?.trim())
    if (!current.parentTaskId && current.status !== 'done' && children.length >= 2) {
      const confirmed = await new Promise((resolve, reject) => uni.showModal({
        title: '完成父事项', content: '完成后将同时完成所有子事项，是否继续？',
        success: result => resolve(result.confirm), fail: reject
      }))
      if (!confirmed) return
    }
    await setTaskStatus(current.id, current.status === 'done' ? 'todo' : 'done')
    load()
  } catch (error) { toast(error.message || String(error)); load() }
  finally { toggling.value = false }
}

function openEdit(task) {
  if (toggling.value || sheetVisible.value || !ready.value || !load()) return
  editingTask.value = task ? allTasks.value.find(item => item.id === task.id) : null
  if (task && !editingTask.value) { toast('事项不存在'); return }
  sheetVisible.value = true
}

function closeSheet() {
  sheetVisible.value = false
  editingTask.value = null
}

function reload() {
  load()
}

function onMenu() {
  toast('菜单功能敬请期待')
}

function onMore() {
  toast('更多功能敬请期待')
}
</script>

<style scoped>
.search-tools { flex: 0 0 auto; padding: 16rpx 28rpx; background: var(--panel); font-size: 24rpx; }
.search-row, .date-inputs, .date-actions { display: flex; align-items: center; gap: 16rpx; }
.search-input { flex: 1; min-width: 0; height: 64rpx; padding: 0 16rpx; background: #f4f7fa; border-radius: 10rpx; font-size: 26rpx; }
.search-tools button, .clear-filters { margin: 0; padding: 0 16rpx; line-height: 64rpx; font-size: 24rpx; color: var(--blue); background: #f1f7ff; }
.search-tools button::after, .clear-filters::after { border: 0; }
.date-toggle { flex-shrink: 0; }
.date-panel { margin-top: 16rpx; }
.date-inputs { align-items: stretch; }
.date-inputs picker { flex: 1; min-width: 0; padding: 12rpx 0; }
.date-inputs picker view { overflow-wrap: anywhere; }
.date-actions { margin-top: 8rpx; }
.range-summary, .date-hint, .date-error { display: block; margin-top: 12rpx; line-height: 1.5; overflow-wrap: anywhere; }
.range-summary { color: var(--blue); }
.date-hint { color: var(--muted); font-size: 22rpx; }
.date-error { color: var(--danger); }
.clear-filters { margin: 24rpx auto; width: fit-content; }
.filter-bar, .task-scroll { width: 100%; box-sizing: border-box; }
.task-priority { display: inline-block; min-width: 44rpx; margin-right: 8rpx; color: #97a6b9; font-size: 23rpx; }
.tasks-page {
  display: flex;
  flex-direction: column;
}

.topbar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28rpx;
}

.topbar-menu {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
}

.menu-icon {
  color: #3d4a58;
  font-size: 44rpx;
  font-weight: 600;
}

.menu-badge {
  position: absolute;
  top: 6rpx;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32rpx;
  height: 32rpx;
  padding: 0 8rpx;
  border-radius: 999rpx;
  background: #f5533f;
  color: #fff;
  font-size: 20rpx;
  font-weight: 600;
}

.topbar-title {
  flex: 1;
  color: #26282d;
  font-size: 34rpx;
  font-weight: 600;
  text-align: center;
}

.title-arrow {
  color: #8a96a3;
  font-size: 28rpx;
}

.topbar-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  color: #3d4a58;
  font-size: 36rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
}

.filter-bar {
  flex: 0 0 auto;
  white-space: nowrap;
  padding: 16rpx 28rpx;
  background: var(--panel);
  border-bottom: 2rpx solid var(--line);
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 56rpx;
  margin-right: 2rpx;
  padding: 0 28rpx;
  border-radius: 10rpx;
  color: #fff;
  font-size: 26rpx;
  font-weight: 400;
}

.filter-chip.chip-cat,
.filter-chip.chip-add {
  position: relative;
  border-radius: 12rpx 12rpx 4rpx 12rpx;
}

.filter-chip.chip-cat::after,
.filter-chip.chip-add::after {
  content: '';
  position: absolute;
  right: 8rpx;
  bottom: -8rpx;
  border-left: 10rpx solid transparent;
  border-right: 0 solid transparent;
  border-top: 12rpx solid var(--chip-color, #a8cff0);
}

.filter-chip.chip-all {
  background: transparent;
  color: #26282d;
  padding: 0 20rpx;
  margin-right: 12rpx;
}

.filter-chip.chip-all.active {
  color: #26282d;
  font-weight: 600;
}

.filter-chip.chip-add {
  background: #a8cff0;
  padding: 0 24rpx;
  font-size: 32rpx;
}

.task-scroll {
  flex: 1;
  min-height: 0;
  padding: 28rpx 28rpx 40rpx;
}

.task-group {
  margin-bottom: 28rpx;
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 16rpx;
}

.group-label {
  color: #26282d;
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
}

.group-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.group-count {
  color: #b8bdc4;
  font-size: 26rpx;
}

.group-arrow {
  color: #c4c9cf;
  font-size: 26rpx;
  transition: transform 0.2s ease;
}

.group-arrow.collapsed {
  transform: rotate(180deg);
}

.task-item {
  display: flex;
  align-items: center;
  gap: 22rpx;
  padding: 26rpx 32rpx;
}

.task-item + .task-item {
  border-top: 1rpx solid var(--line);
}

.task-item:active {
  background: #f6f9fc;
}

.task-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42rpx;
  height: 42rpx;
  flex: 0 0 42rpx;
  border: 2.5rpx solid var(--blue);
  border-radius: 50%;
  color: #fff;
  font-size: 24rpx;
}

.task-main {
  flex: 1;
  min-width: 0;
}

.task-title {
  display: block;
  overflow: hidden;
  color: #2e3136;
  font-size: 30rpx;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-title.is-done {
  color: #b8bdc4;
  font-weight: 400;
  text-decoration: line-through;
}

.task-meta {
  display: block;
  margin-top: 8rpx;
  overflow: hidden;
  color: #b8bdc4;
  font-size: 24rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-chevron {
  color: #d3d7dc;
  font-size: 30rpx;
}

.list-empty {
  padding: 120rpx 0;
  color: #b3b7bd;
  text-align: center;
}

.fab {
  position: fixed;
  right: 36rpx;
  bottom: calc(150rpx + env(safe-area-inset-bottom));
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: #4aa7f8;
  color: #fff;
  font-size: 52rpx;
  font-weight: 300;
  box-shadow: 0 12rpx 28rpx rgba(48, 147, 231, 0.32);
}

.fab:active {
  transform: scale(0.94);
}
</style>
