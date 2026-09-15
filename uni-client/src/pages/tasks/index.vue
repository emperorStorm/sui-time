<template>
  <view class="page tasks-page">
    <view class="topbar">
      <view class="topbar-menu" @click="onMenu">
        <text class="menu-icon">≡</text>
        <view v-if="todoCount" class="menu-badge"><text>{{ todoCount > 99 ? '99+' : todoCount }}</text></view>
      </view>
      <view class="topbar-title">本周事项 <text class="title-arrow">▾</text></view>
      <view class="topbar-action" @click="onMore"><text>···</text></view>
    </view>

    <scroll-view class="filter-bar" scroll-x>
      <view :class="['filter-chip', 'chip-all', filter === 'all' ? 'active' : '']" @click="filter = 'all'"><text>全部</text></view>
      <view v-for="cat in categories" :key="cat.id" :class="['filter-chip', 'chip-cat', filter === cat.id ? 'active' : '']" :style="{ background: cat.color, '--chip-color': cat.color }" @click="filter = cat.id">
        <text>{{ cat.name }}</text>
      </view>
      <view class="filter-chip chip-add" @click="manageVisible = true"><text>＋</text></view>
    </scroll-view>

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
                <text :class="['task-title', task.status === 'done' ? 'is-done' : '']">{{ task.title }}</text>
                <text class="task-meta">{{ metaOf(task) }}</text>
              </view>
              <text class="task-chevron">⌄</text>
            </view>
          </template>
        </view>
      </view>
      <view v-else class="list-empty">
        <text>暂时没有事项</text>
      </view>
    </scroll-view>

    <view class="fab" @click="openEdit(null)"><text>＋</text></view>

    <TaskEditSheet :visible="sheetVisible" :task="editingTask" @close="closeSheet" @saved="reload" />
    <CategoryManageSheet :visible="manageVisible" @close="manageVisible = false" @changed="onCategoriesChanged" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import TaskEditSheet from '../../components/TaskEditSheet.vue'
import CategoryManageSheet from '../../components/CategoryManageSheet.vue'
import { getCategories, listTasks, setTaskStatus, getSettings, categoryById, toggleGroupCollapsed, listChildren } from '../../api/store'
import { repeatLabel } from '../../utils/occurrence'
import { shortDate, weekday, todayString } from '../../utils/date'
import { toast } from '../../utils/platform'

const categories = ref(getCategories())
const filter = ref('all')
const allTasks = ref([])
const sheetVisible = ref(false)
const editingTask = ref(null)
const manageVisible = ref(false)
const collapsedGroups = ref(getSettings().collapsedGroups || [])

const todoCount = computed(() => allTasks.value.filter((task) => !task.parentTaskId && task.status !== 'done').length)

function onCategoriesChanged() {
  categories.value = getCategories()
  if (filter.value !== 'all' && !categories.value.some((cat) => cat.id === filter.value)) filter.value = 'all'
}

const groups = computed(() => {
  const hideCompleted = getSettings().hideCompleted
  const source = (filter.value === 'all' ? allTasks.value : allTasks.value.filter((task) => task.categoryId === filter.value))
    .filter((task) => !hideCompleted || task.status !== 'done')
  const today = todayString()
  const bucket = { '今天': [], '7天内': [], '稍后': [] }
  source.forEach((task) => {
    if (task.parentTaskId) return
    if (occursOnToday(task, today)) bucket['今天'].push(task)
    else if (isWithinWeek(task.plannedDate, today)) bucket['7天内'].push(task)
    else bucket['稍后'].push(task)
  })
  return Object.keys(bucket).map((label) => ({ label, items: bucket[label] })).filter((group) => group.items.length)
})

onShow(load)

function load() {
  allTasks.value = [...listTasks()]
  categories.value = [...getCategories()]
  collapsedGroups.value = getSettings().collapsedGroups || []
}

function isCollapsed(label) {
  return collapsedGroups.value.includes(label)
}

function toggleGroup(label) {
  collapsedGroups.value = toggleGroupCollapsed(label)
}

function occursOnToday(task, today) {
  if (!task.plannedDate) return false
  if (task.plannedDate === today) return true
  const rule = parseKind(task.repeatRule)
  if (rule === 'none' || rule === 'daily') return rule === 'daily'
  if (rule === 'weekly') return dayOf(task.plannedDate) === dayOf(today)
  if (rule === 'monthly') return dayNum(task.plannedDate) === dayNum(today)
  if (rule === 'yearly') return monthDay(task.plannedDate) === monthDay(today)
  return false
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

function dayOf(value) { return new Date(`${value}T12:00:00`).getDay() }
function dayNum(value) { return new Date(`${value}T12:00:00`).getDate() }
function monthDay(value) {
  const date = new Date(`${value}T12:00:00`)
  return `${date.getMonth() + 1}/${date.getDate()}`
}
function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + amount)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function colorOf(task) {
  return categoryById(task.categoryId)?.color || '#8b98a8'
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
  const children = listChildren(task.id)
  if (children.length) {
    const done = children.filter((child) => child.status === 'done').length
    parts.push(`子任务${done}/${children.length}`)
  }
  return parts.join(' ')
}

function toggle(task) {
  setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done')
  load()
}

function openEdit(task) {
  editingTask.value = task
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
