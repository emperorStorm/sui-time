<template>
  <view class="page tasks-page">
    <view class="topbar">
      <view class="topbar-title">事项</view>
      <view class="topbar-action" @click="resetToday">↻</view>
    </view>

    <scroll-view class="filter-bar" scroll-x>
      <view :class="['filter-chip', 'chip-all', filter === 'all' ? 'active' : '']" @click="filter = 'all'"><text>全部</text></view>
      <view v-for="cat in categories" :key="cat.id" :class="['filter-chip', filter === cat.id ? 'active' : '']" :style="{ background: cat.color }" @click="filter = cat.id">
        <text>{{ cat.name }}</text>
      </view>
    </scroll-view>

    <scroll-view class="task-scroll" scroll-y>
      <view v-if="groups.length" class="shell">
        <view v-for="group in groups" :key="group.label" class="task-group panel">
          <view class="group-header">
            <text class="group-label">{{ group.label }}</text>
            <text class="group-count">{{ group.items.length }}</text>
          </view>
          <view v-for="task in group.items" :key="task.id" class="task-item" @click="openEdit(task)">
            <view :class="['task-check', task.status === 'done' ? 'done' : '']" :style="{ borderColor: colorOf(task) }" @click.stop="toggle(task)">
              <text v-if="task.status === 'done'">✓</text>
            </view>
            <view class="task-main">
              <text :class="['task-title', task.status === 'done' ? 'is-done' : '']">{{ task.title }}</text>
              <text class="task-meta">{{ metaOf(task) }}</text>
            </view>
            <text class="task-chevron">›</text>
          </view>
        </view>
      </view>
      <view v-else class="list-empty">
        <text>暂时没有事项</text>
      </view>
    </scroll-view>

    <view class="fab" @click="openEdit(null)"><text>＋</text></view>

    <TaskEditSheet :visible="sheetVisible" :task="editingTask" @close="closeSheet" @saved="reload" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import TaskEditSheet from '../../components/TaskEditSheet.vue'
import { getCategories, listTasks, setTaskStatus, getSettings, categoryById } from '../../api/store'
import { repeatLabel } from '../../utils/occurrence'
import { shortDate, weekday, todayString } from '../../utils/date'
import { toast } from '../../utils/platform'

const categories = ref(getCategories())
const filter = ref('all')
const allTasks = ref([])
const sheetVisible = ref(false)
const editingTask = ref(null)

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

function metaOf(task) {
  const parts = []
  if (task.plannedDate) {
    parts.push(task.plannedDate === todayString() ? '今天' : `${shortDate(task.plannedDate)} ${weekday(task.plannedDate)}`)
  }
  const kind = parseKind(task.repeatRule)
  if (kind !== 'none') parts.push(repeatLabel(kind))
  if (task.plannedTime) parts.push(task.plannedTime)
  if (task.parentTaskId) {
    const parent = allTasks.value.find((item) => item.id === task.parentTaskId)
    if (parent) parts.push(`子任务·${parent.title}`)
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

function resetToday() {
  filter.value = 'all'
  load()
  toast('已刷新')
}
</script>

<style scoped>
.tasks-page {
  display: flex;
  flex-direction: column;
}

.filter-bar {
  flex: 0 0 auto;
  white-space: nowrap;
  padding: 20rpx 28rpx;
  background: var(--panel);
  border-bottom: 2rpx solid var(--line);
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 60rpx;
  margin-right: 16rpx;
  padding: 0 30rpx;
  border-radius: 999rpx;
  color: #fff;
  font-size: 26rpx;
}

.filter-chip.chip-all {
  background: #eceef2;
  color: #4a4e54;
}

.filter-chip.chip-all.active {
  background: var(--blue);
  color: #fff;
}

.task-scroll {
  flex: 1;
  min-height: 0;
  padding: 24rpx 28rpx 40rpx;
}

.task-group {
  margin-bottom: 24rpx;
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx 12rpx;
}

.group-label {
  font-size: 30rpx;
  font-weight: 700;
}

.group-count {
  color: var(--muted);
  font-size: 24rpx;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 32rpx;
}

.task-item + .task-item {
  border-top: 2rpx solid var(--line);
}

.task-item:active {
  background: #f4f8fd;
}

.task-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
  border: 3rpx solid var(--blue);
  border-radius: 50%;
  color: #fff;
  font-size: 26rpx;
}

.task-check.done {
  background: var(--blue);
  border-color: var(--blue);
}

.task-main {
  flex: 1;
  min-width: 0;
}

.task-title {
  display: block;
  overflow: hidden;
  color: #393c41;
  font-size: 30rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-title.is-done {
  color: var(--muted);
  text-decoration: line-through;
}

.task-meta {
  display: block;
  margin-top: 6rpx;
  overflow: hidden;
  color: #a5a9ae;
  font-size: 24rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-chevron {
  color: #c4c9cf;
  font-size: 36rpx;
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
  font-size: 56rpx;
  box-shadow: 0 10rpx 24rpx rgba(48, 147, 231, 0.4);
}

.fab:active {
  transform: scale(0.94);
}
</style>
