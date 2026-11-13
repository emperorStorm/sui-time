<template>
  <view class="page planning-page">
    <view class="topbar">
      <view class="topbar-title">规划</view>
      <view class="topbar-action" role="button" tabindex="0" :aria-label="viewMode === 'week' ? '回到本周' : '回到今天'" @click="resetView" @keydown.enter.prevent="resetView" @keydown.space.prevent="resetView">↻</view>
    </view>

    <view v-if="sheetSuspended || recordSuspended" class="draft-actions" role="status">
      <button v-if="sheetSuspended" @click="sheetSuspended = false">继续编辑事项草稿</button>
      <button v-if="recordSuspended" @click="recordSuspended = false">继续编辑纪念备注</button>
    </view>
    <view v-if="loadError" class="storage-error panel"><text>本机数据暂时无法读取</text><text class="storage-error-detail">{{ loadError }}</text><button @click="reload">重试读取</button></view>
    <template v-else-if="ready">
    <view class="view-tabs" role="tablist">
      <view role="tab" tabindex="0" :aria-selected="viewMode === 'week'" :class="['view-tab', { active: viewMode === 'week' }]" @click="switchView('week')" @keydown.enter.prevent="switchView('week')" @keydown.space.prevent="switchView('week')">周</view>
      <view role="tab" tabindex="0" :aria-selected="viewMode === 'month'" :class="['view-tab', { active: viewMode === 'month' }]" @click="switchView('month')" @keydown.enter.prevent="switchView('month')" @keydown.space.prevent="switchView('month')">月</view>
    </view>
    <view class="status-filters" role="group" aria-label="筛选事项状态">
      <view v-for="[value, label] in statusOptions" :key="value" role="button" tabindex="0" :aria-pressed="statusFilter === value" :class="['status-filter', { active: statusFilter === value }]" @click="statusFilter = value" @keydown.enter.prevent="statusFilter = value" @keydown.space.prevent="statusFilter = value">{{ label }}</view>
    </view>

    <scroll-view class="month-scroll" scroll-y refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="refresh">
      <view class="month-head">
        <text class="month-title">{{ viewMode === 'week' ? weekTitle(days) : monthTitle(anchor) }}</text>
        <view class="month-nav">
          <view class="month-nav-btn" role="button" tabindex="0" :aria-label="viewMode === 'week' ? '上一周' : '上个月'" @click="shift(-1)" @keydown.enter.prevent="shift(-1)" @keydown.space.prevent="shift(-1)">‹</view>
          <view class="month-nav-btn" role="button" tabindex="0" :aria-label="viewMode === 'week' ? '下一周' : '下个月'" @click="shift(1)" @keydown.enter.prevent="shift(1)" @keydown.space.prevent="shift(1)">›</view>
        </view>
      </view>

      <template v-if="viewMode === 'month'">
        <view class="month-weekdays">
          <text v-for="label in ['一', '二', '三', '四', '五', '六', '日']" :key="label">{{ label }}</text>
        </view>

        <view class="month-grid">
          <view v-for="date in days" :key="date" :class="['month-day', { 'is-today': date === today, 'is-selected': date === selectedDate, 'is-muted': !inMonth(date) }]" role="button" tabindex="0" :aria-label="`${date}，${dayData[date].count} 项`" @click="selectedDate = date" @keydown.enter.prevent="selectedDate = date" @keydown.space.prevent="selectedDate = date">
            <view class="day-head">
              <text class="day-num">{{ dayNum(date) }}</text>
              <text v-if="holidayOf(date)" class="holiday-badge" :class="holidayOf(date).isOffDay ? 'is-off' : 'is-work'" :title="holidayDescription(holidayOf(date))" :aria-label="holidayDescription(holidayOf(date))">{{ holidayOf(date).isOffDay ? '休' : '班' }}</text>
            </view>
            <text class="day-subtitle" :class="{ 'has-marker': calendarMeta[date].marker }">{{ calendarMeta[date].marker || calendarMeta[date].lunarLabel }}</text>
            <view class="day-items">
              <view v-for="item in dayData[date].anniversaries.slice(0, 2)" :key="item.anniversaryId" :class="['day-item', 'day-anniversary', `kind-${item.kind}`, { commemorated: item.record?.confirmedAt }]"><text>{{ marks[item.kind] }} {{ item.label }}{{ item.record?.confirmedAt ? ' ✓' : '' }}</text></view>
              <view v-for="task in dayData[date].tasks.slice(0, Math.max(0, 2 - dayData[date].anniversaries.length))" :key="task.id" :class="['day-item', { 'day-task-ended': task.planningDeleted || task.status !== 'todo' }]" :style="{ background: colorOf(task) }" :aria-label="`${task.title}，${planningStatusLabel(task)}`">
                <text class="day-task-mark">{{ task.planningDeleted ? '−' : taskMark(task) }}</text><text class="day-task-title">{{ task.title }}</text>
              </view>
              <text v-if="dayData[date].count > 2" class="day-more">+{{ dayData[date].count - 2 }}</text>
            </view>
          </view>
        </view>
      </template>

      <template v-else>
        <view class="week-strip">
          <view v-for="date in days" :key="date" :class="['week-day', { 'is-today': date === today, 'is-selected': date === selectedDate }]" role="button" tabindex="0" :aria-label="`${date}，${dayData[date].count} 项`" @click="selectedDate = date" @keydown.enter.prevent="selectedDate = date" @keydown.space.prevent="selectedDate = date">
            <text class="week-weekday">{{ weekdayLabel(date) }}</text>
            <view class="day-head">
              <text class="day-num">{{ dayNum(date) }}</text>
              <text v-if="holidayOf(date)" class="holiday-badge" :class="holidayOf(date).isOffDay ? 'is-off' : 'is-work'" :title="holidayDescription(holidayOf(date))" :aria-label="holidayDescription(holidayOf(date))">{{ holidayOf(date).isOffDay ? '休' : '班' }}</text>
            </view>
            <text class="day-subtitle" :class="{ 'has-marker': calendarMeta[date].marker }">{{ calendarMeta[date].marker || calendarMeta[date].lunarLabel }}</text>
            <text class="week-count">{{ dayData[date].count ? `${dayData[date].count} 项` : '—' }}</text>
          </view>
        </view>
        <view class="week-agenda panel">
          <view class="week-agenda-head"><text>{{ selectedDate }} · 当天事项</text><text v-if="selectedDay.count">{{ selectedDay.count }} 项</text></view>
          <DayAgenda :tasks="selectedDay.tasks" :anniversaries="selectedDay.anniversaries" :count="selectedDay.count" :meta="selectedMeta" :holiday="holidayOf(selectedDate)" :marks="marks" :color-of="colorOf" @edit-task="editTask" @open-anniversary="openRecord" />
          <button class="day-add" @click="openCreate(selectedDate)">＋ 新增当天待办</button>
        </view>
      </template>
    </scroll-view>

    <view v-if="selectedDate && viewMode === 'month' && !sheetVisible" class="day-layer" @click="selectedDate = ''">
      <view class="day-sheet" @click.stop>
        <view class="day-sheet-header"><text>{{ selectedDate }} · 当天事项</text><button aria-label="关闭当天事项" @click="selectedDate = ''">×</button></view>
        <scroll-view class="day-sheet-list" scroll-y>
          <DayAgenda :tasks="selectedDay.tasks" :anniversaries="selectedDay.anniversaries" :count="selectedDay.count" :meta="selectedMeta" :holiday="holidayOf(selectedDate)" :marks="marks" :color-of="colorOf" @edit-task="editTask" @open-anniversary="openRecord" />
        </scroll-view>
        <button class="day-add" @click="openCreate(selectedDate)">＋ 新增当天待办</button>
      </view>
    </view>
    </template>
    <AnniversaryRecordSheet v-if="ready || activeRecord" ref="recordSheet" :occurrence="activeRecord" :suspended="recordSuspended" :today="today" @close="closeRecord" @saved="reload" />
    <TaskEditSheet v-if="ready || sheetVisible" ref="taskSheet" :visible="sheetVisible" :suspended="sheetSuspended" :task="editingTask" :preset-date="presetDate" @close="closeSheet" @saved="reload" />
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { onShow, onHide, onUnload, onBackPress } from '@dcloudio/uni-app'
import TaskEditSheet from '../../components/TaskEditSheet.vue'
import DayAgenda from '../../components/DayAgenda.vue'
import AnniversaryRecordSheet from '../../components/AnniversaryRecordSheet.vue'
import { anniversaryOccurrences, anniversaryTypes } from '../../../../shared/anniversary.mjs'
import { getCachedHolidayCalendar, refreshHolidayCalendar } from '../../api/holiday'
import { planningTasksForDates, getCategories, listAnniversaries, listAnniversaryRecords } from '../../api/store'
import { addDays, monthDates, monthTitle, shiftMonth, todayString, weekDates, weekTitle, weekday } from '../../utils/date'
import { planningStatusLabel, taskMark } from '../../utils/task'
import { resolveCalendarMeta } from '../../utils/calendar-meta'
import { usePullSync } from '../../utils/pull-sync.js'
import { toast } from '../../utils/platform'
import { useMainTabTap, registerTabDrafts, pendingTabDraft } from '../../utils/main-tab.js'

const sheetSuspended = ref(false)
const recordSuspended = ref(false)
registerTabDrafts('pages/planning/index', '规划', () => sheetSuspended.value || recordSuspended.value)
useMainTabTap('pages/planning/index', () => {
  if (sheetVisible.value) sheetSuspended.value = true
  if (activeRecord.value) recordSuspended.value = true
  if (viewMode.value === 'month' && !sheetVisible.value) selectedDate.value = ''
})
function draftBlocked() {
  const page = pendingTabDraft()
  if (!page) return false
  toast(`请返回${page}页，继续处理已保留的草稿`)
  return true
}
function closeRecord() { activeRecord.value = null; recordSuspended.value = false }

const { refreshing, refresh } = usePullSync(reload)

const anchor = ref(todayString())
const viewMode = ref('month')
let sheetDateContext = null
const today = ref(todayString())
const sheetVisible = ref(false)
const presetDate = ref('')
const ready = ref(false)
const loadError = ref('')
const taskSheet = ref(null)
const categories = ref([])
const allDayData = ref({})
const statusFilter = ref('all')
const statusOptions = [['all', '全部'], ['todo', '待办'], ['done', '已完成'], ['failed', '已失败'], ['deleted', '已删除']]
const dayData = computed(() => Object.fromEntries(Object.entries(allDayData.value).map(([date, day]) => {
  const tasks = statusFilter.value === 'all' ? day.tasks : day.tasks.filter(task => (task.planningDeleted ? 'deleted' : task.status) === statusFilter.value)
  return [date, { ...day, tasks, count: tasks.length + day.anniversaries.length }]
})))
const selectedDate = ref('')
const activeRecord = ref(null)
const recordSheet = ref(null)
const editingTask = ref(null)
const marks = Object.fromEntries(anniversaryTypes.map(type => [type.value, type.mark]))
let dayTimer
const holidayByDate = ref({})
let holidayRefreshRequestId = 0

const days = computed(() => viewMode.value === 'week' ? weekDates(anchor.value) : monthDates(anchor.value))
const calendarMeta = computed(() => Object.fromEntries(days.value.map(date => [date, resolveCalendarMeta(date)])))
const selectedMeta = computed(() => calendarMeta.value[selectedDate.value] || { lunarText: '', markers: [] })
const visibleHolidayYears = computed(() => [...new Set(days.value.map((date) => Number(date.slice(0, 4))))])

const selectedDay = computed(() => dayData.value[selectedDate.value] || { tasks: [], anniversaries: [], count: 0 })

onShow(() => {
  reload()
  scheduleDay()
  // #ifdef H5
  window.addEventListener('focus', reload)
  document.addEventListener('visibilitychange', visibilityChanged)
  // #endif
  void refreshVisibleHolidayCalendar(true)
})
onHide(releasePage)
onUnload(releasePage)
onBeforeUnmount(releasePage)
function refreshStore() { reload() }
uni.$on('store-refresh', refreshStore)
const releaseStoreRefresh = () => uni.$off('store-refresh', refreshStore)
onUnload(releaseStoreRefresh)
onBeforeUnmount(releaseStoreRefresh)
onBackPress(() => {
  if (sheetVisible.value && !sheetSuspended.value) { taskSheet.value?.requestClose(); return true }
  if (activeRecord.value && !recordSuspended.value) { recordSheet.value?.close(); return true }
  if (viewMode.value === 'week') { switchView('month'); return true }
  if (selectedDate.value) { selectedDate.value = ''; return true }
  return false
})

function scheduleDay() { clearTimeout(dayTimer); const next = new Date(); next.setHours(24, 0, 0, 0); dayTimer = setTimeout(() => { reload(); scheduleDay() }, next.getTime() - Date.now() + 100) }
function releasePage() {
  clearTimeout(dayTimer)
  statusFilter.value = 'all'
  holidayRefreshRequestId++
  // #ifdef H5
  window.removeEventListener('focus', reload)
  document.removeEventListener('visibilitychange', visibilityChanged)
  // #endif
}
function visibilityChanged() {
  // #ifdef H5
  if (document.visibilityState === 'visible') reload()
  // #endif
}

function shift(amount) {
  if (viewMode.value === 'week') {
    const index = Math.max(0, days.value.indexOf(selectedDate.value))
    anchor.value = addDays(anchor.value, amount * 7)
    selectedDate.value = days.value[index] || days.value[0]
  } else {
    anchor.value = shiftMonth(anchor.value, amount)
    selectedDate.value = ''
  }
  reload()
  void refreshVisibleHolidayCalendar(false)
}

function switchView(mode) {
  if (viewMode.value === mode) return
  anchor.value = selectedDate.value || anchor.value
  viewMode.value = mode
  selectedDate.value = mode === 'week' ? (days.value.includes(today.value) ? today.value : days.value[0]) : ''
  reload()
  void refreshVisibleHolidayCalendar(false)
}

function resetView() {
  const now = todayString()
  today.value = now
  anchor.value = now
  selectedDate.value = viewMode.value === 'week' ? now : ''
  reload()
  void refreshVisibleHolidayCalendar(true)
}

async function refreshVisibleHolidayCalendar(force) {
  const years = visibleHolidayYears.value
  if (!years.length) return
  const requestId = ++holidayRefreshRequestId
  holidayByDate.value = { ...holidayByDate.value, ...getCachedHolidayCalendar(years) }
  const refreshed = await refreshHolidayCalendar(years, force)
  if (requestId !== holidayRefreshRequestId) return
  const replacedYears = new Set(refreshed.availableYears)
  const retained = Object.fromEntries(Object.entries(holidayByDate.value).filter(([date]) => !replacedYears.has(Number(date.slice(0, 4)))))
  holidayByDate.value = { ...retained, ...refreshed.days }
}

function inMonth(date) {
  return date.slice(0, 7) === anchor.value.slice(0, 7)
}

function dayNum(date) {
  return Number(date.slice(8, 10))
}

function holidayOf(date) {
  return holidayByDate.value[date] || null
}

function holidayDescription(holiday) {
  return `${holiday.name}：${holiday.isOffDay ? '休息日' : '调休工作日'}`
}

function colorOf(task) {
  return categories.value.find(cat => cat.id === task.categoryId)?.color || '#8b98a8'
}

function weekdayLabel(date) {
  return weekday(date).slice(1)
}

function openCreate(date) {
  if (draftBlocked()) return
  if (sheetVisible.value || activeRecord.value || !reload()) return
  presetDate.value = date
  editingTask.value = null
  sheetDateContext = viewMode.value === 'month' ? { date: selectedDate.value, anchor: anchor.value } : null
  sheetVisible.value = true
}
function editTask(task) {
  if (!task || task.planningDeleted) return
  if (draftBlocked()) return
  if (sheetVisible.value || activeRecord.value || !reload()) return
  const current = allDayData.value[selectedDate.value]?.tasks.find(item => item.id === task.id && !item.planningDeleted)
  if (!current) { toast('事项不存在'); return }
  editingTask.value = current
  presetDate.value = ''
  sheetDateContext = viewMode.value === 'month' ? { date: selectedDate.value, anchor: anchor.value } : null
  sheetVisible.value = true
}
function openRecord(item) {
  if (draftBlocked()) return
  if (activeRecord.value || sheetVisible.value) { toast('请先继续处理已打开的草稿'); return }
  activeRecord.value = item
}

function closeSheet() {
  // saved 包括自动保存，只有真正关闭后才恢复打开编辑器前的月历上下文。
  const context = sheetDateContext
  sheetDateContext = null
  const viewChanged = context && (viewMode.value !== 'month' || anchor.value !== context.anchor)
  if (context) {
    viewMode.value = 'month'
    anchor.value = context.anchor
    selectedDate.value = context.date
  }
  sheetVisible.value = false
  sheetSuspended.value = false
  editingTask.value = null
  presetDate.value = ''
  if (viewChanged) {
    reload()
    void refreshVisibleHolidayCalendar(false)
  } else refreshStore()
}

function reload() {
  today.value = todayString()
  try {
    const dates = days.value
    const cats = getCategories().map(cat => ({ ...cat }))
    const occurrences = anniversaryOccurrences(listAnniversaries(), dates[0], dates[dates.length - 1], listAnniversaryRecords({ startDate: dates[0], endDate: dates[dates.length - 1] }))
    const tasksByDate = planningTasksForDates(dates)
    const map = {}
    dates.forEach(date => { map[date] = { tasks: tasksByDate[date], anniversaries: [] } })
    occurrences.forEach(item => { if (map[item.date]) map[item.date].anniversaries.push(item) })
    categories.value = cats
    allDayData.value = map
    loadError.value = ''
    ready.value = true
    return true
  } catch (error) {
    loadError.value = error.message || String(error)
    ready.value = false
    return false
  }
}
</script>

<style scoped>
.draft-actions { flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 12rpx; padding: 12rpx 28rpx; background: #eef6ff; }
.draft-actions button { margin: 0; color: #176ab7; background: #fff; font-size: 24rpx; line-height: 64rpx; }
.day-subtitle { display: block; height: 28rpx; line-height: 28rpx; font-size: 19rpx; text-align: center; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-subtitle.has-marker { color: #7898b8; }
.day-calendar-detail { padding: 0 32rpx 12rpx; color: #8493a4; font-size: 24rpx; line-height: 1.6; overflow-wrap: anywhere; }
.day-calendar-detail text { display: block; }
.day-sheet { display: flex; flex-direction: column; box-sizing: border-box; }
.day-sheet-list { min-height: 0; flex: 1; }
.day-sheet-header, .day-calendar-detail, .day-add { flex-shrink: 0; }
.day-list-mark { width: 36rpx; flex-shrink: 0; text-align: center; font-size: 24rpx; }
.day-item { display: flex; gap: 4rpx; }
.day-task-mark { flex: 0 0 26rpx; text-align: center; font-size: 17rpx; }
.day-task-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-item.day-anniversary, .day-list-anniversary { background: #eaf2fc; color: #6686a8; border-left: 3rpx solid #acc4df; }.day-item.day-anniversary.kind-birthday, .day-list-anniversary.kind-birthday { background: #fff0e6; color: #a97959; border-left-color: #e9c2a6; }.day-item.day-anniversary.kind-anniversary, .day-list-anniversary.kind-anniversary { background: #faedf2; color: #a27286; border-left-color: #dcb9c9; }.commemorated { opacity: .7; }.day-layer { position: fixed; inset: 0; z-index: 1000; background: #17243166; display: flex; align-items: flex-end; }.day-sheet { width: 100%; max-height: 80vh; background: var(--panel); border-radius: 28rpx 28rpx 0 0; padding-bottom: env(safe-area-inset-bottom); }.day-sheet-header { display: flex; justify-content: space-between; align-items: center; padding: 20rpx 32rpx; color: #657c96; font-size: 27rpx; }.day-sheet-header button { margin: 0; width: 64rpx; line-height: 64rpx; padding: 0; background: transparent; color: #8291a2; font-size: 40rpx; }.day-sheet button::after { border: 0; }.day-sheet-list { max-height: 56vh; }.day-group { display: block; padding: 12rpx 32rpx; color: #99a5b2; font-size: 24rpx; }.day-list-anniversary, .day-list-task { display: flex; align-items: center; gap: 18rpx; margin: 12rpx 32rpx; padding: 24rpx 20rpx; border-radius: 10rpx; font-size: 27rpx; }.day-list-anniversary > text:nth-child(2), .day-list-task > text:nth-child(2) { flex: 1; min-width: 0; overflow-wrap: anywhere; }.day-list-anniversary > text:last-child, .day-list-task > text:last-child { flex-shrink: 0; font-size: 22rpx; }.day-list-task { background: #f6f8fb; color: #71859c; }.day-task-dot { width: 12rpx; height: 12rpx; border-radius: 50%; flex-shrink: 0; }.day-empty { display: block; text-align: center; color: #a0aab7; padding: 60rpx 0; font-size: 28rpx; }.day-add { margin: 24rpx 32rpx; background: #7299d5; color: #fff; font-size: 27rpx; line-height: 88rpx; }
.planning-page {
  height: calc(100vh - var(--window-bottom, 0px));
  min-height: 0;
  padding-bottom: 0;
  display: flex;
  flex-direction: column;
}

.view-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 8rpx;
  padding: 8rpx 28rpx 12rpx;
  background: var(--panel);
}

.view-tab {
  flex: 1;
  border-radius: 10rpx;
  background: #f4f7fa;
  color: #7b8794;
  font-size: 26rpx;
  line-height: 64rpx;
  text-align: center;
}

.view-tab.active {
  background: #7299d5;
  color: #fff;
  font-weight: 600;
}

.status-filters {
  display: flex;
  flex: 0 0 auto;
  gap: 8rpx;
  padding: 0 28rpx 14rpx;
  background: var(--panel);
}

.status-filter {
  flex: 1;
  min-width: 0;
  border-radius: 12rpx;
  background: #f3f7fb;
  color: #5c7187;
  font-size: 22rpx;
  line-height: 56rpx;
  text-align: center;
  white-space: nowrap;
}

.status-filter.active { background: #dceefe; color: #1668af; font-weight: 600; }
.status-filter:focus-visible { outline: 4rpx solid #79a9d7; outline-offset: -4rpx; }
.day-task-ended { opacity: .72; }

.week-strip {
  display: flex;
  border-top: 2rpx solid var(--line);
  border-bottom: 2rpx solid var(--line);
}

.week-day {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  padding: 10rpx 2rpx 8rpx;
  border-right: 2rpx solid #f2f4f6;
}

.week-day:last-child {
  border-right: 0;
}

.week-weekday {
  color: var(--muted);
  font-size: 20rpx;
}

.week-day .day-head {
  min-height: 44rpx;
}

.week-day .day-num {
  width: 44rpx;
  height: 44rpx;
  font-size: 24rpx;
}

.week-day .day-subtitle {
  max-width: 100%;
  padding: 0 2rpx;
  height: 24rpx;
  line-height: 24rpx;
  font-size: 17rpx;
}

.week-day.is-selected {
  background: #eef4fb;
}

.week-day.is-selected .day-num {
  box-shadow: 0 0 0 3rpx #7299d5;
}

.week-count {
  margin-top: 4rpx;
  color: #a0aab7;
  font-size: 18rpx;
}

.week-agenda {
  margin: 16rpx 20rpx 32rpx;
  padding-bottom: 8rpx;
  overflow: hidden;
}

.week-agenda-head {
  display: flex;
  justify-content: space-between;
  padding: 20rpx 32rpx 8rpx;
  color: #657c96;
  font-size: 26rpx;
}

.week-agenda .day-add {
  margin: 16rpx 32rpx 24rpx;
}

.month-scroll {
  flex: 1;
  height: 0;
  min-height: 0;
  width: 100%;
  background: var(--panel);
}

.month-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx;
}

.month-title {
  font-size: 36rpx;
  font-weight: 700;
}

.month-nav {
  display: flex;
  gap: 8rpx;
}

.month-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  color: #5c6167;
  font-size: 36rpx;
}

.month-nav-btn:active {
  background: #eef2f6;
}

.month-weekdays,
.month-grid {
  display: flex;
  flex-wrap: wrap;
}

.month-weekdays {
  padding: 8rpx 0;
  border-top: 2rpx solid var(--line);
  border-bottom: 2rpx solid var(--line);
  color: var(--muted);
  font-size: 22rpx;
}

.month-weekdays text {
  width: 14.2857%;
  text-align: center;
}

.month-day {
  width: 14.2857%;
  height: 196rpx;
  box-sizing: border-box;
  overflow: hidden;
  padding: 10rpx 6rpx 8rpx;
  border-right: 2rpx solid #f2f4f6;
  border-bottom: 2rpx solid #f2f4f6;
}

.day-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48rpx;
}

.month-day:nth-child(7n) {
  border-right: 0;
}

.day-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
  margin: 0 auto;
  border-radius: 50%;
  font-size: 26rpx;
  font-weight: 600;
}

.month-day.is-today .day-num {
  background: var(--blue);
  color: #fff;
}

.month-day.is-muted .day-num {
  color: #c3c8ce;
  font-weight: 400;
}

.holiday-badge {
  position: absolute;
  top: 0;
  right: 4rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30rpx;
  height: 30rpx;
  border-radius: 6rpx;
  font-size: 18rpx;
  font-weight: 700;
  line-height: 1;
}

.holiday-badge.is-off {
  background: #e8f3ff;
  color: #2f80ed;
}

.holiday-badge.is-work {
  background: #fff2df;
  color: #d78616;
}

.day-items {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  margin-top: 6rpx;
}

.day-item {
  overflow: hidden;
  padding: 4rpx 8rpx;
  border-radius: 6rpx;
  color: #fff;
  font-size: 18rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.day-more {
  color: #8a96a3;
  font-size: 18rpx;
  text-align: center;
}

.view-tabs {
  gap: 0;
  margin: 8rpx 28rpx 12rpx;
  padding: 6rpx;
  border-radius: 16rpx;
  background: #edf3fa;
}
.view-tab {
  border-radius: 12rpx;
  background: transparent;
  color: #647991;
  font-weight: 600;
}
.view-tab.active {
  background: #fff;
  color: #287fc1;
  box-shadow: 0 2rpx 8rpx #244b7520;
}
.month-head { gap: 16rpx; padding: 24rpx 28rpx; }
.month-title { min-width: 0; color: #263e58; font-size: 34rpx; overflow-wrap: anywhere; }
.month-nav { flex-shrink: 0; gap: 12rpx; }
.month-nav-btn { width: 64rpx; height: 64rpx; border-radius: 14rpx; background: #f1f6fb; color: #4079ad; font-size: 40rpx; }
.month-nav-btn:active { background: #dcecff; }
.month-weekdays { padding: 14rpx 0; border-color: #e8eff6; background: #f8fbfe; color: #617a94; font-weight: 600; }
.month-day { padding: 10rpx 4rpx 8rpx; border-color: #edf2f7; }
.month-day.is-muted { background: #fafbfd; }
.month-day.is-muted .day-num { color: #9caab8; }
.month-day.is-selected { background: #edf5ff; box-shadow: inset 0 0 0 2rpx #80afe0; }
.month-day.is-today .day-num, .week-day.is-today .day-num { background: #2996f6; color: #fff; font-weight: 700; }
.month-day.is-selected .day-num, .week-day.is-selected .day-num { box-shadow: 0 0 0 3rpx #5b91c8; }
.day-subtitle { color: #74879b; }
.day-subtitle.has-marker { color: #3979b2; font-weight: 600; }
.holiday-badge { right: 0; width: 26rpx; height: 26rpx; font-size: 17rpx; }
.holiday-badge.is-off { background: #e1f1ff; color: #1c6fae; }
.holiday-badge.is-work { background: #fff0da; color: #9b5a08; }
.day-items { min-width: 0; }
.day-item { min-width: 0; box-sizing: border-box; padding: 4rpx; }
.day-item.day-anniversary { color: #436988; border-left-width: 3rpx; }
.day-item.day-anniversary.kind-birthday { color: #8b5635; }
.day-item.day-anniversary.kind-anniversary { color: #8c516b; }
.day-item.day-anniversary > text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-item.commemorated { opacity: 1; }
.day-more { color: #607b96; }

.week-strip { padding: 8rpx 0; border-color: #e8eff6; background: #f8fbfe; }
.week-day { box-sizing: border-box; border-right: 0; border-radius: 14rpx; }
.week-day.is-selected { background: #e6f1ff; }
.week-day .day-subtitle { box-sizing: border-box; width: 100%; }
.week-count { color: #74879b; }
.week-agenda { margin: 20rpx 20rpx 32rpx; border: 2rpx solid #e7eef6; border-radius: 20rpx; }
.week-agenda-head, .day-sheet-header { gap: 16rpx; color: #344e69; font-weight: 600; }
.week-agenda-head > text:first-child, .day-sheet-header > text { min-width: 0; overflow-wrap: anywhere; }
.week-agenda-head > text:last-child { flex-shrink: 0; color: #66809a; font-size: 23rpx; }
.day-sheet-header button { flex-shrink: 0; }
.day-add { border-radius: 14rpx; background: #398edb; font-weight: 600; }
.day-add:active { background: #287bc6; }
.view-tab:focus-visible, .month-nav-btn:focus-visible, .month-day:focus-visible, .week-day:focus-visible, .topbar-action:focus-visible { outline: 4rpx solid #79a9d7; outline-offset: -4rpx; }
</style>
