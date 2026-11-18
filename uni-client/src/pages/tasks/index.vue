<template>
  <view class="page tasks-page">
    <view class="topbar">
      <view class="title-toggle" role="button" tabindex="0" aria-haspopup="true" :aria-expanded="filtersOpen" aria-controls="task-filter-panel" @click="toggleFilterPanel" @keydown.enter.prevent="toggleFilterPanel" @keydown.space.prevent="toggleFilterPanel">
        <text class="title-text">{{ filterTitle }}</text>
        <text :class="['title-caret', filtersOpen ? 'open' : '']" aria-hidden="true">▾</text>
      </view>
    </view>

    <view v-if="filtersOpen" class="filter-mask" aria-hidden="true" @click="filtersOpen = false"></view>
    <view v-if="filtersOpen" id="task-filter-panel" class="filter-panel panel" role="dialog" aria-modal="true" aria-labelledby="filter-time-title" @click.stop @keydown.esc.stop.prevent="filtersOpen = false">
      <text id="filter-time-title" class="filter-section-title">按时间</text>
      <view class="filter-options" role="radiogroup" aria-labelledby="filter-time-title">
        <view v-for="opt in timeOptions" :key="opt.value" class="filter-option" role="radio" tabindex="0" :aria-checked="taskFilters.time === opt.value" :class="{ active: taskFilters.time === opt.value }" @click="selectTime(opt.value)" @keydown.enter.prevent="selectTime(opt.value)" @keydown.space.prevent="selectTime(opt.value)"><text>{{ opt.label }}</text></view>
      </view>
      <text class="filter-section-title">按类型</text>
      <view class="filter-options" role="group" aria-label="按类型">
        <view v-for="opt in typeOptions" :key="opt.value" class="filter-option" role="checkbox" tabindex="0" :aria-checked="taskFilters.types.includes(opt.value)" :class="{ active: taskFilters.types.includes(opt.value) }" @click="toggleType(opt.value)" @keydown.enter.prevent="toggleType(opt.value)" @keydown.space.prevent="toggleType(opt.value)"><text>{{ opt.label }}</text></view>
      </view>
      <view class="filter-panel-footer">
        <button class="filter-reset" @click="resetTaskFilters">恢复默认</button>
        <button class="filter-done" @click="filtersOpen = false">完成</button>
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
      <view class="filter-track">
        <view :class="['filter-chip', 'chip-all', activeCategory === 'all' ? 'active' : '']" :style="allChipStyle" role="button" tabindex="0" :aria-pressed="activeCategory === 'all'" @click="selectCategory('all')" @keydown.enter.prevent="selectCategory('all')" @keydown.space.prevent="selectCategory('all')"><text>全部</text></view>
        <view v-for="cat in categories" :key="cat.id" :class="['filter-chip', 'chip-cat', activeCategory === cat.id ? 'active' : '']" :style="chipStyle(cat)" role="button" tabindex="0" :aria-pressed="activeCategory === cat.id" @click="selectCategory(cat.id)" @keydown.enter.prevent="selectCategory(cat.id)" @keydown.space.prevent="selectCategory(cat.id)">
          <text>{{ cat.name }}</text>
        </view>
        <view class="filter-chip chip-add" role="button" tabindex="0" aria-label="管理分类" @click="openCategories" @keydown.enter.prevent="openCategories" @keydown.space.prevent="openCategories"><text>＋</text></view>
      </view>
    </scroll-view>

    <scroll-view class="task-scroll" scroll-y refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="refresh" @scroll="taskTouchMoved = true">
      <view :class="['task-stage', slideState]">
      <view v-if="groups.length" class="shell">
        <view v-for="group in groups" :key="group.label" class="task-group panel">
          <view class="group-header" :class="{ static: group.date }" :role="group.date ? undefined : 'button'" :tabindex="group.date ? undefined : 0" :aria-expanded="group.date ? undefined : !isCollapsed(group.label)" @click="onGroupHeader(group)" @keydown.enter.prevent="onGroupHeader(group)" @keydown.space.prevent="onGroupHeader(group)">
            <text class="group-label">{{ group.label }}</text>
            <view class="group-right">
              <text class="group-count">{{ group.items.length }}</text>
              <text v-if="!group.date" :class="['group-arrow', isCollapsed(group.label) ? 'collapsed' : '']">∧</text>
            </view>
          </view>
          <template v-if="group.date || !isCollapsed(group.label)">
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
        <button v-if="hasConditions" class="clear-filters" @click="clearFilters">清除筛选条件</button>
      </view>
      </view>
    </scroll-view>

    <button class="fab" role="button" tabindex="0" aria-label="新增事项" @click="openEdit(null)" @keydown.enter.prevent="openEdit(null)" @keydown.space.prevent="openEdit(null)">＋</button>

    </template>
    <CategoryManageSheet v-if="ready || manageVisible" ref="categorySheet" :visible="manageVisible" :suspended="manageSuspended" @close="closeManage" @changed="onCategoriesChanged" />
    <TaskEditSheet v-if="ready || sheetVisible" ref="taskSheet" :visible="sheetVisible" :suspended="sheetSuspended" :task="editingTask" @close="closeSheet" @saved="reload" />
    <DiagPanel />
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { onShow, onBackPress, onUnload } from '@dcloudio/uni-app'
import TaskEditSheet from '../../components/TaskEditSheet.vue'
import CategoryManageSheet from '../../components/CategoryManageSheet.vue'
import DiagPanel from '../../components/DiagPanel.vue'
import { getCategories, listTasks, setTaskStatus, getSettings, getHideCompleted, toggleGroupCollapsed, getTaskFilters, setTaskFilters } from '../../api/store'
import { repeatLabel, parseRepeatRule } from '../../utils/occurrence'
import { reminderState, reminderSummary, subscribeReminderState, syncTaskReminders } from '../../api/reminders'
import { androidSettings } from '../../api/android'
import { occursOn } from '../../utils/occurrence'
import { compareTasks, matchesTaskFilter, matchesTaskTypeFilter, occurrenceDateInRange, taskMark, timeRangeFor, TASK_FILTER_TYPES, defaultTaskFilters } from '../../utils/task'
import { addDays, shortDate, weekday, todayString } from '../../utils/date'
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
const activeCategory = ref('all')
const slideState = ref('')
let slideTimer

const ALL_CATEGORY_COLOR = '#465b88'

function mixHex(color, target, ratio) {
  const match = /^#?([0-9a-f]{6})$/i.exec(typeof color === 'string' ? color : '')
  if (!match) return null
  const value = parseInt(match[1], 16)
  const base = parseInt(target.slice(1), 16)
  const channel = shift => Math.round((((value >> shift) & 255) * (1 - ratio)) + (((base >> shift) & 255) * ratio))
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}
function tintOf(color) { return mixHex(color, '#ffffff', 0.85) || '#eef2f7' }
function shadeOf(color) { return mixHex(color, '#000000', 0.35) || '#25384c' }

const allChipStyle = computed(() => activeCategory.value === 'all'
  ? { background: tintOf(ALL_CATEGORY_COLOR), color: shadeOf(ALL_CATEGORY_COLOR) }
  : { background: ALL_CATEGORY_COLOR, color: '#fff' })

function chipStyle(cat) {
  const active = activeCategory.value === cat.id
  const background = active ? tintOf(cat.color) : cat.color
  return { background, color: active ? shadeOf(cat.color) : '#fff', '--chip-color': background }
}
const allTasks = ref([])
const today = ref(todayString())
const sheetVisible = ref(false)
const editingTask = ref(null)
const manageVisible = ref(false)
const collapsedGroups = ref([])
const hideCompleted = ref(true)
const filtersOpen = ref(false)
const taskFilters = ref(defaultTaskFilters())
const timeOptions = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今日' },
  { value: 'tomorrow', label: '明日' },
  { value: 'three_days', label: '3日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' }
]
const typeOptions = [
  { value: 'schedule', label: '日程' },
  { value: 'list', label: '清单' },
  { value: 'repeat', label: '重复' }
]
const timeTitles = { all: '全部事项', today: '今日事项', tomorrow: '明日事项', three_days: '3日事项', week: '本周事项', month: '本月事项' }
const filterTitle = computed(() => timeTitles[taskFilters.value.time] || timeTitles.week)
const timeRange = computed(() => timeRangeFor(taskFilters.value.time, today.value))
const hasConditions = computed(() => filter.value !== 'all' || taskFilters.value.time !== 'all' || taskFilters.value.types.length < TASK_FILTER_TYPES.length)

function toggleFilterPanel() {
  if (!ready.value || loadError.value) return
  filtersOpen.value = !filtersOpen.value
}
function persistTaskFilters(next) {
  const previous = taskFilters.value
  taskFilters.value = next
  try { taskFilters.value = setTaskFilters(next) }
  catch (error) { taskFilters.value = previous; toast(error.message || String(error)) }
}
function selectTime(value) {
  if (taskFilters.value.time === value) return
  persistTaskFilters({ ...taskFilters.value, time: value })
}
function toggleType(value) {
  const types = taskFilters.value.types
  if (types.includes(value)) {
    if (types.length === 1) { toast('至少保留一种类型'); return }
    persistTaskFilters({ ...taskFilters.value, types: types.filter(type => type !== value) })
    return
  }
  persistTaskFilters({ ...taskFilters.value, types: [...types, value] })
}
function resetTaskFilters() {
  persistTaskFilters(defaultTaskFilters())
}
function clearFilters() {
  resetSlide()
  activeCategory.value = 'all'
  filter.value = 'all'
  persistTaskFilters({ time: 'all', types: [...TASK_FILTER_TYPES] })
}

function categoryOrder(id) {
  if (id === 'all') return 0
  return categories.value.findIndex(cat => cat.id === id) + 1
}

function resetSlide() {
  clearTimeout(slideTimer)
  slideState.value = ''
}

function selectCategory(id) {
  if (id === activeCategory.value) return
  const current = categoryOrder(activeCategory.value)
  const next = categoryOrder(id)
  if (next < 1 && id !== 'all') return
  activeCategory.value = id
  const forward = next > current
  clearTimeout(slideTimer)
  slideState.value = forward ? 'slide-out-left' : 'slide-out-right'
  slideTimer = setTimeout(() => {
    filter.value = id
    slideState.value = forward ? 'slide-in-right' : 'slide-in-left'
    slideTimer = setTimeout(() => { slideState.value = '' }, 24)
  }, 150)
}

function onCategoriesChanged() {
  load()
}

const groups = computed(() => {
  const source = allTasks.value.filter(task =>
    matchesTaskFilter(task, { categoryId: filter.value, hideCompleted: hideCompleted.value })
    && matchesTaskTypeFilter(task, taskFilters.value.types))
  const range = timeRange.value
  return range ? dateGroups(source, range) : allViewGroups(source)
})

function allViewGroups(source) {
  const bucket = { '今天': [], '7天内': [], '稍后': [] }
  source.forEach((task) => {
    if (task.parentTaskId) return
    if (occursOnToday(task, today.value)) bucket['今天'].push(task)
    else if (isWithinWeek(task.plannedDate, today.value)) bucket['7天内'].push(task)
    else bucket['稍后'].push(task)
  })
  return Object.keys(bucket).map((label) => ({ label, items: bucket[label].sort(compareTasks) })).filter((group) => group.items.length)
}

function dateGroups(source, range) {
  const buckets = new Map()
  source.forEach((task) => {
    const date = occurrenceDateInRange(task, range.startDate, range.endDate, today.value)
    if (!date) return
    if (!buckets.has(date)) buckets.set(date, [])
    buckets.get(date).push(task)
  })
  return [...buckets.keys()].sort().map((date) => ({
    label: dateGroupLabel(date),
    date,
    items: buckets.get(date).sort((a, b) => compareTasks({ ...a, plannedDate: date }, { ...b, plannedDate: date }))
  }))
}

function dateGroupLabel(date) {
  if (date === today.value) return '今天'
  if (date === addDays(today.value, 1)) return '明天'
  if (date === addDays(today.value, 2)) return '后天'
  return `${shortDate(date)} ${weekday(date)}`
}

function onGroupHeader(group) {
  if (group.date) return
  toggleGroup(group.label)
}

onShow(() => { today.value = todayString(); filtersOpen.value = false; load(); reminder.value = reminderState() })
function refreshStore() { load() }
uni.$on('store-refresh', refreshStore)
const releaseStoreRefresh = () => uni.$off('store-refresh', refreshStore)
onUnload(releaseStoreRefresh)
onBeforeUnmount(releaseStoreRefresh)
onBeforeUnmount(() => { clearTimeout(slideTimer) })
onBackPress(() => {
  if (filtersOpen.value) { filtersOpen.value = false; return true }
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
    taskFilters.value = getTaskFilters()
    if (filter.value !== 'all' && !cats.some(cat => cat.id === filter.value)) { filter.value = 'all'; resetSlide() }
    if (activeCategory.value !== 'all' && !cats.some(cat => cat.id === activeCategory.value)) activeCategory.value = 'all'
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
.clear-filters { margin: 24rpx auto; width: fit-content; padding: 0 20rpx; line-height: 64rpx; font-size: 24rpx; color: var(--blue); background: #f1f7ff; }
.clear-filters::after { border: 0; }
.filter-bar, .task-scroll { width: 100%; box-sizing: border-box; }
.task-priority { display: inline-block; min-width: 40rpx; margin-right: 6rpx; color: #97a6b9; font-size: 22rpx; }
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
  justify-content: center;
  box-sizing: content-box;
  height: 92rpx;
  padding: var(--top-safe-area) 28rpx 0;
}

.title-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  max-width: 100%;
  padding: 0 24rpx;
  border-radius: 999rpx;
  color: var(--ink);
  font-size: 30rpx;
  font-weight: 600;
}

.title-toggle:active {
  background: var(--blue-soft);
}

.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-caret {
  color: var(--muted);
  font-size: 20rpx;
  transition: transform 0.2s ease;
}

.title-caret.open {
  transform: rotate(180deg);
}

.filter-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(22, 34, 52, 0.18);
}

.filter-panel {
  position: fixed;
  top: calc(var(--top-safe-area) + 98rpx);
  left: 50%;
  z-index: 101;
  width: calc(100% - 56rpx);
  max-width: 640rpx;
  padding: 20rpx 24rpx 12rpx;
  box-sizing: border-box;
  transform: translateX(-50%);
}

.filter-section-title {
  display: block;
  margin: 12rpx 0 10rpx;
  color: var(--muted);
  font-size: 22rpx;
}

.filter-section-title:first-child {
  margin-top: 0;
}

.filter-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.filter-option {
  display: flex;
  flex: 0 0 calc((100% - 24rpx) / 3);
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 64rpx;
  border-radius: 12rpx;
  background: #f4f7fa;
  color: #4a5a6b;
  font-size: 26rpx;
}

.filter-option.active {
  background: var(--blue-soft);
  color: var(--blue);
  font-weight: 600;
}

.title-toggle:focus-visible,
.filter-option:focus-visible {
  outline: 4rpx solid #79a9d7;
  outline-offset: -4rpx;
}

.filter-panel-footer {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}

.filter-panel-footer button {
  flex: 1;
  margin: 0;
  line-height: 68rpx;
  font-size: 26rpx;
}

.filter-panel-footer button::after { border: 0; }
.filter-reset { color: var(--muted); background: #f4f7fa; }
.filter-done { color: #fff; background: var(--blue); }

@keyframes today-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .task-scroll { animation: none; }
  .task-stage,
  .filter-chip { transition: none; }
}

.filter-bar {
  flex: 0 0 auto;
  white-space: nowrap;
  padding: 8rpx 24rpx 6rpx;
  background: var(--panel);
  border-bottom: 2rpx solid var(--line);
  -webkit-overflow-scrolling: touch;
}

.filter-track {
  display: flex;
  align-items: flex-start;
}

.filter-chip {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 56rpx;
  margin-right: 0;
  padding: 0 24rpx;
  border-radius: 10rpx;
  color: #fff;
  font-size: 26rpx;
  font-weight: 400;
  white-space: nowrap;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.filter-chip.chip-cat,
.filter-chip.chip-add {
  position: relative;
  border-radius: 6rpx 6rpx 0 11rpx;
}

.filter-chip.chip-cat {
  min-width: 166rpx;
}

.filter-chip.chip-all + .filter-chip {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.filter-chip:last-child {
  border-top-right-radius: 12rpx;
  border-bottom-right-radius: 12rpx;
}

.filter-chip.chip-cat::after {
  content: '';
  position: absolute;
  right: -11rpx;
  bottom: 0;
  width: 11rpx;
  height: 11rpx;
  background: var(--chip-color, #a8cff0);
  pointer-events: none;
}

.filter-chip.chip-cat.active {
  font-weight: 600;
}

.filter-chip.chip-all {
  color: #fff;
  padding: 0 20rpx;
  margin-right: 0;
  border-radius: 10rpx 0 0 10rpx;
}

.filter-chip.chip-all.active {
  font-weight: 600;
}

.filter-chip.chip-add {
  min-width: 166rpx;
  background: #a8cff0;
  padding: 0;
  font-size: 28rpx;
}

.task-stage {
  width: 100%;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.task-stage.slide-out-left {
  opacity: 0;
  transform: translateX(-100%);
  transition-duration: 0.15s;
}

.task-stage.slide-out-right {
  opacity: 0;
  transform: translateX(100%);
  transition-duration: 0.15s;
}

.task-stage.slide-in-right {
  opacity: 0;
  transform: translateX(100%);
  transition: none;
}

.task-stage.slide-in-left {
  opacity: 0;
  transform: translateX(-100%);
  transition: none;
}

.task-scroll {
  flex: 1;
  height: 0;
  min-height: 0;
  padding: 16rpx 24rpx 32rpx;
  animation: today-fade-in 320ms 70ms ease-out both;
}

.task-group {
  margin-bottom: 16rpx;
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 24rpx 8rpx;
}

.group-header.static {
  cursor: default;
}

.group-label {
  color: #26282d;
  font-size: 28rpx;
  font-weight: 600;
  letter-spacing: 0;
}

.group-right {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.group-count {
  color: #b8bdc4;
  font-size: 24rpx;
}

.group-arrow {
  color: #c4c9cf;
  font-size: 24rpx;
  transition: transform 0.2s ease;
}

.group-arrow.collapsed {
  transform: rotate(180deg);
}

.task-item {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 16rpx 24rpx;
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
  flex: 0 0 88rpx;
  width: 88rpx;
  min-height: 88rpx;
  margin: -12rpx;
  padding: 0;
  background: transparent;
}
.task-check-target::after { border: 0; }
.task-item:focus-visible, .group-header:focus-visible, .filter-chip:focus-visible, .task-check-target:focus-visible, .fab:focus-visible { outline: 4rpx solid #79a9d7; outline-offset: -4rpx; }

.task-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36rpx;
  height: 36rpx;
  flex: 0 0 36rpx;
  border: 2.5rpx solid var(--blue);
  border-radius: 50%;
  color: #fff;
  font-size: 20rpx;
}

.task-main {
  flex: 1;
  min-width: 0;
}

.task-title {
  display: block;
  overflow: hidden;
  color: #2e3136;
  font-size: 28rpx;
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
  margin-top: 4rpx;
  overflow: hidden;
  color: #b8bdc4;
  font-size: 22rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-empty {
  padding: 80rpx 0;
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
