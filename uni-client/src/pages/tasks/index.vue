<template>
  <view class="page tasks-page">
    <view class="topbar">
      <view class="topbar-title">事项</view>
      <view v-if="ready" class="task-summary" role="status" :aria-label="`待办 ${todoCount} 项`"><text>待办</text><text>{{ todoCount > 99 ? '99+' : todoCount }}</text></view>
    </view>

    <view v-if="ready" class="today-overview" role="status" :aria-label="`${todayLabel} ${todayWeekday}，已完成 ${todayDoneCount} 项，共 ${todayTasks.length} 项`">
      <view class="today-overview-date"><text>{{ todayLabel }}</text><text class="today-overview-weekday">{{ todayWeekday }}</text></view>
      <view class="today-progress">
        <view class="today-progress-label"><text>{{ todayTasks.length ? `已完成 ${todayDoneCount}/${todayTasks.length}` : '今天暂无安排' }}</text><text v-if="todayTasks.length">{{ todayProgress }}%</text></view>
        <view v-if="todayTasks.length" class="today-progress-track"><view class="today-progress-value" :style="{ width: `${todayProgress}%` }"></view></view>
      </view>
    </view>
    <view v-if="sheetSuspended || manageSuspended" class="draft-actions" role="status">
      <button v-if="sheetSuspended" @click="sheetSuspended = false">继续编辑事项草稿</button>
      <button v-if="manageSuspended" @click="manageSuspended = false">继续分类管理</button>
    </view>
    <view v-if="loadError" class="storage-error panel"><text>本机数据暂时无法读取</text><text class="storage-error-detail">{{ loadError }}</text><button @click="load">重试读取</button></view>
    <template v-else-if="ready">
    <view v-if="showReminderStatus" class="reminder-status" role="status">
      <button class="reminder-status-toggle" role="button" tabindex="0" :aria-expanded="reminderExpanded" @click="reminderExpanded = !reminderExpanded" @keydown.enter.prevent="reminderExpanded = !reminderExpanded" @keydown.space.prevent="reminderExpanded = !reminderExpanded">系统提醒：{{ reminderSummary(reminder) }} {{ reminderExpanded ? '▴' : '▾' }}</button>
      <scroll-view v-if="reminderExpanded" scroll-y class="reminder-status-detail">
        <text v-if="reminder.warnings.length && reminder.warningsStale">以下为上次已知的受影响事项，重新排程后更新：</text>
        <text v-for="item in reminder.warnings" :key="item.id">{{ item.title || '未命名事项' }}（{{ repeatLabel(item.kind) }}）</text>
        <button v-if="reminder.supported && !reminder.notifications" @click="openReminderSettings('notifications')">打开通知设置</button>
        <button v-if="reminder.supported && !reminder.exactAlarm" @click="openReminderSettings('alarm')">打开准时提醒设置</button>
        <button @click="retryReminders">重新同步提醒</button>
      </scroll-view>
    </view>
    <scroll-view class="filter-bar" scroll-x>
      <view :class="['filter-chip', 'chip-all', filter === 'all' ? 'active' : '']" role="button" tabindex="0" :aria-pressed="filter === 'all'" @click="filter = 'all'" @keydown.enter.prevent="filter = 'all'" @keydown.space.prevent="filter = 'all'"><text>全部</text></view>
      <view v-for="cat in categories" :key="cat.id" :class="['filter-chip', 'chip-cat', filter === cat.id ? 'active' : '']" :style="{ background: cat.color, '--chip-color': cat.color }" role="button" tabindex="0" :aria-pressed="filter === cat.id" @click="filter = cat.id" @keydown.enter.prevent="filter = cat.id" @keydown.space.prevent="filter = cat.id">
        <text>{{ cat.name }}</text>
      </view>
      <view class="filter-chip chip-add" role="button" tabindex="0" aria-label="管理分类" @click="openCategories" @keydown.enter.prevent="openCategories" @keydown.space.prevent="openCategories"><text>＋</text></view>
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

    <scroll-view class="task-scroll" scroll-y refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="refresh" @scroll="taskTouchMoved = true">
      <view v-if="groups.length" class="shell">
        <view v-for="group in groups" :key="group.label" class="task-group panel">
          <view class="group-header" role="button" tabindex="0" :aria-expanded="!isCollapsed(group.label)" @click="toggleGroup(group.label)" @keydown.enter.prevent="toggleGroup(group.label)" @keydown.space.prevent="toggleGroup(group.label)">
            <text class="group-label">{{ group.label }}</text>
            <view class="group-right">
              <text class="group-count">{{ group.items.length }}</text>
              <text :class="['group-arrow', isCollapsed(group.label) ? 'collapsed' : '']">∧</text>
            </view>
          </view>
          <template v-if="!isCollapsed(group.label)">
            <view v-for="task in group.items" :key="task.id" class="task-item" role="button" tabindex="0" :aria-label="`编辑事项 ${task.title}`" @click="!taskTouchMoved && openEdit(task)" @touchstart="taskTouchMoved = false" @pointerdown="taskTouchMoved = false" @touchmove="taskTouchMoved = true" @touchcancel="taskTouchMoved = true" @keydown.enter.prevent="openEdit(task)" @keydown.space.prevent="openEdit(task)">
              <button class="task-check-target" role="button" tabindex="0" :aria-label="`${task.status === 'done' ? '恢复待办' : '完成事项'} ${task.title}`" @click.stop="!taskTouchMoved && toggle(task)" @keydown.enter.stop.prevent="toggle(task)" @keydown.space.stop.prevent="toggle(task)">
                <view :class="['task-check', task.status === 'done' ? 'done' : '']" :style="checkStyle(task)"><text v-if="task.status === 'done'">✓</text></view>
              </button>
              <view class="task-main">
                <text :class="['task-title', task.status === 'done' ? 'is-done' : '']"><text class="task-priority">{{ taskMark(task) }}</text>{{ task.title }}</text>
                <text class="task-meta">{{ metaOf(task) }}</text>
              </view>
            </view>
          </template>
        </view>
      </view>
      <view v-else class="list-empty">
        <text>{{ hasConditions ? '没有符合条件的事项' : '暂时没有事项' }}</text>
        <button v-if="hasConditions" class="clear-filters" @click="clearFilters">清除搜索与日期条件</button>
      </view>
    </scroll-view>

    <button class="fab" role="button" tabindex="0" aria-label="新增事项" @click="openEdit(null)" @keydown.enter.prevent="openEdit(null)" @keydown.space.prevent="openEdit(null)">＋</button>

    </template>
    <CategoryManageSheet v-if="ready || manageVisible" ref="categorySheet" :visible="manageVisible" :suspended="manageSuspended" @close="closeManage" @changed="onCategoriesChanged" />
    <TaskEditSheet v-if="ready || sheetVisible" ref="taskSheet" :visible="sheetVisible" :suspended="sheetSuspended" :task="editingTask" @close="closeSheet" @saved="reload" />
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onShow, onBackPress, onUnload } from '@dcloudio/uni-app'
import TaskEditSheet from '../../components/TaskEditSheet.vue'
import CategoryManageSheet from '../../components/CategoryManageSheet.vue'
import { getCategories, listTasks, setTaskStatus, getSettings, getHideCompleted, toggleGroupCollapsed } from '../../api/store'
import { repeatLabel, parseRepeatRule } from '../../utils/occurrence'
import { reminderState, reminderSummary, subscribeReminderState, syncTaskReminders } from '../../api/reminders'
import { androidSettings } from '../../api/android'
import { occursOn } from '../../utils/occurrence'
import { compareTasks, matchesTaskFilter, taskMark, validateTaskDateRange } from '../../utils/task'
import { shortDate, weekday, todayString } from '../../utils/date'
import { toast } from '../../utils/platform'
import { usePullSync } from '../../utils/pull-sync.js'
import { useMainTabTap, registerTabDrafts, pendingTabDraft } from '../../utils/main-tab.js'

const sheetSuspended = ref(false)
const manageSuspended = ref(false)
registerTabDrafts('pages/tasks/index', '事项', () => sheetSuspended.value || manageSuspended.value)
useMainTabTap('pages/tasks/index', () => {
  if (sheetVisible.value) sheetSuspended.value = true
  if (manageVisible.value) manageSuspended.value = true
})
function draftBlocked() {
  const page = pendingTabDraft()
  if (!page) return false
  toast(`请返回${page}页，继续处理已保留的草稿`)
  return true
}
function openCategories() {
  if (draftBlocked() || sheetVisible.value || manageVisible.value) return
  manageVisible.value = true
}
function closeManage() { manageVisible.value = false; manageSuspended.value = false }

const { refreshing, refresh } = usePullSync(load)
const reminder = ref(reminderState())
const reminderExpanded = ref(false)
const showReminderStatus = computed(() => Boolean(reminder.value.error || reminder.value.warnings.length || (reminder.value.supported && (!reminder.value.notifications || !reminder.value.exactAlarm))))
const unsubscribeReminder = subscribeReminderState(state => { reminder.value = state })
onBeforeUnmount(unsubscribeReminder)
onUnload(unsubscribeReminder)
function openReminderSettings(kind) {
  try { androidSettings(kind) } catch (error) { toast(error.message || String(error)) }
}
async function retryReminders() {
  try { await syncTaskReminders(listTasks()) } catch (error) { toast(error.message || String(error)) }
}

const categories = ref([])
const ready = ref(false)
const loadError = ref('')
const taskSheet = ref(null)
const categorySheet = ref(null)
let taskTouchMoved = false
const toggling = ref(false)
const filter = ref('all')
const allTasks = ref([])
const today = ref(todayString())
const todayLabel = computed(() => {
  const [, month, day] = today.value.split('-')
  return `${Number(month)}月${Number(day)}日`
})
const todayWeekday = computed(() => weekday(today.value))
const todayTasks = computed(() => allTasks.value.filter(task => !task.parentTaskId && occursOnToday(task, today.value)))
const todayDoneCount = computed(() => todayTasks.value.filter(task => task.status === 'done').length)
const todayProgress = computed(() => todayTasks.value.length ? Math.round(todayDoneCount.value / todayTasks.value.length * 100) : 0)
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

const todoCount = computed(() => allTasks.value.filter(task => !task.parentTaskId && (task.status || 'todo') === 'todo').length)

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

onShow(() => { today.value = todayString(); load(); reminder.value = reminderState() })
function refreshStore() { load() }
uni.$on('store-refresh', refreshStore)
const releaseStoreRefresh = () => uni.$off('store-refresh', refreshStore)
onUnload(releaseStoreRefresh)
onBeforeUnmount(releaseStoreRefresh)
onBackPress(() => {
  if (sheetVisible.value && !sheetSuspended.value) { taskSheet.value?.requestClose(); return true }
  if (manageVisible.value && !manageSuspended.value) { categorySheet.value?.requestClose(); return true }
  return false
})

function load() {
  today.value = todayString()
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
  const rule = parseRepeatRule(task.repeatRule)
  if (rule.kind !== 'none') parts.push(`↻ ${repeatLabel(rule.kind, rule.interval)}`)
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
  if (draftBlocked()) return
  if (toggling.value || sheetVisible.value || manageVisible.value || !ready.value || !load()) return
  editingTask.value = task ? allTasks.value.find(item => item.id === task.id) : null
  if (task && !editingTask.value) { toast('事项不存在'); return }
  sheetVisible.value = true
}

function closeSheet() {
  sheetVisible.value = false
  sheetSuspended.value = false
  editingTask.value = null
}

function reload() {
  load()
}

</script>

<style scoped>
.draft-actions { flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 12rpx; padding: 12rpx 28rpx; background: #eef6ff; }
.draft-actions button { margin: 0; color: #176ab7; background: #fff; font-size: 24rpx; line-height: 64rpx; }
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
  height: calc(100vh - var(--window-bottom, 0px));
  min-height: 0;
  padding-bottom: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 28rpx;
  padding-right: 28rpx;
}

.topbar-title {
  flex: 1;
  color: var(--ink);
  font-size: 34rpx;
  font-weight: 600;
}

.task-summary {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 12rpx 20rpx;
  border-radius: 999rpx;
  background: var(--blue-soft);
  color: var(--blue);
  font-size: 23rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.today-overview {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 24rpx;
  min-height: 104rpx;
  padding: 12rpx 32rpx;
  background: var(--panel);
  border-bottom: 1rpx solid var(--line);
  animation: today-fade-in 280ms ease-out both;
}

.today-overview-date {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  color: var(--ink);
  font-size: 32rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.today-overview-weekday {
  color: var(--muted);
  font-size: 23rpx;
  font-weight: 400;
}

.today-progress {
  flex: 1;
  min-width: 0;
  animation: today-fade-in 360ms 60ms ease-out both;
}

.today-progress-label {
  display: flex;
  justify-content: space-between;
  gap: 12rpx;
  color: var(--muted);
  font-size: 23rpx;
  font-variant-numeric: tabular-nums;
}

.today-progress-track {
  height: 8rpx;
  margin-top: 12rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: #e8eef4;
}

.today-progress-value {
  height: 100%;
  border-radius: inherit;
  background: var(--blue);
  transition: width 240ms ease-out;
}

@keyframes today-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .today-overview, .today-progress, .task-scroll { animation: none; }
  .today-progress-value { transition: none; }
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
  height: 0;
  min-height: 0;
  padding: 28rpx 28rpx 40rpx;
  animation: today-fade-in 320ms 70ms ease-out both;
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

.task-check-target {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 96rpx;
  width: 96rpx;
  min-height: 96rpx;
  margin: -16rpx;
  padding: 0;
  background: transparent;
}
.task-check-target::after { border: 0; }
.task-item:focus-visible, .group-header:focus-visible, .filter-chip:focus-visible, .task-check-target:focus-visible, .fab:focus-visible { outline: 4rpx solid #79a9d7; outline-offset: -4rpx; }

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
  margin: 0;
  padding: 0;
  line-height: 112rpx;
  border-radius: 50%;
  background: #4aa7f8;
  color: #fff;
  font-size: 52rpx;
  font-weight: 300;
  box-shadow: 0 12rpx 28rpx rgba(48, 147, 231, 0.32);
}

.fab::after { border: 0; }
.fab:active {
  transform: scale(0.94);
}
</style>
