<template>
  <view class="page planning-page">
    <view class="topbar">
      <view class="topbar-title">规划</view>
      <view class="topbar-action" @click="resetMonth">↻</view>
    </view>

    <view class="month-scroll">
      <view class="month-head">
        <text class="month-title">{{ monthTitle(anchor) }}</text>
        <view class="month-nav">
          <view class="month-nav-btn" @click="shift(-1)">‹</view>
          <view class="month-nav-btn" @click="shift(1)">›</view>
        </view>
      </view>

      <view class="month-weekdays">
        <text v-for="label in ['一', '二', '三', '四', '五', '六', '日']" :key="label">{{ label }}</text>
      </view>

      <view class="month-grid">
        <view v-for="date in days" :key="date" :class="['month-day', { 'is-today': date === today, 'is-muted': !inMonth(date) }]" @click="selectedDate = date">
          <view class="day-head">
            <text class="day-num">{{ dayNum(date) }}</text>
            <text v-if="holidayOf(date)" class="holiday-badge" :class="holidayOf(date).isOffDay ? 'is-off' : 'is-work'" :title="holidayDescription(holidayOf(date))" :aria-label="holidayDescription(holidayOf(date))">{{ holidayOf(date).isOffDay ? '休' : '班' }}</text>
          </view>
          <view class="day-items">
            <view v-for="item in dayData[date].anniversaries.slice(0, 2)" :key="item.anniversaryId" :class="['day-item', 'day-anniversary', `kind-${item.kind}`, { commemorated: item.record?.confirmedAt }]"><text>{{ marks[item.kind] }} {{ item.label }}{{ item.record?.confirmedAt ? ' ✓' : '' }}</text></view>
            <view v-for="task in dayData[date].tasks.slice(0, Math.max(0, 2 - dayData[date].anniversaries.length))" :key="task.id" class="day-item" :style="{ background: colorOf(task) }">
              <text class="day-task-mark">{{ taskMark(task) }}</text><text class="day-task-title">{{ task.title }}</text>
            </view>
            <text v-if="dayData[date].count > 2" class="day-more">+{{ dayData[date].count - 2 }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="selectedDate" class="day-layer" @click="selectedDate = ''"><view class="day-sheet" @click.stop><view class="day-sheet-header"><text>{{ selectedDate }} · 当天事项</text><button aria-label="关闭当天事项" @click="selectedDate = ''">×</button></view><scroll-view class="day-sheet-list" scroll-y><text v-if="selectedDay.anniversaries.length" class="day-group">纪念日</text><view v-for="item in selectedDay.anniversaries" :key="item.anniversaryId" :class="['day-list-anniversary', `kind-${item.kind}`, { commemorated: item.record?.confirmedAt }]" @click="activeRecord = item"><text>{{ marks[item.kind] }}</text><text>{{ item.label }}</text><text>{{ item.record?.confirmedAt ? '✓ 已纪念' : '›' }}</text></view><text v-if="selectedDay.tasks.length" class="day-group">待办</text><view v-for="task in selectedDay.tasks" :key="task.id" class="day-list-task" @click="editTask(task)"><text class="day-list-mark" :style="{ color: colorOf(task) }">{{ taskMark(task) }}</text><text>{{ task.title }}</text><text>{{ task.scheduleKind === 'range' ? `${task.plannedTime}–${task.plannedEndTime}` : task.plannedTime || '全天' }}</text></view><text v-if="!selectedDay.count" class="day-empty">这一天还没有安排</text></scroll-view><button class="day-add" @click="openCreate(selectedDate)">＋ 新增当天待办</button></view></view>
    <TaskEditSheet :visible="sheetVisible" :task="editingTask" :preset-date="presetDate" @close="closeSheet" @saved="reload" />
    <AnniversaryRecordSheet ref="recordSheet" :occurrence="activeRecord" :today="today" @close="activeRecord = null" @saved="reload" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onHide, onUnload, onBackPress } from '@dcloudio/uni-app'
import TaskEditSheet from '../../components/TaskEditSheet.vue'
import AnniversaryRecordSheet from '../../components/AnniversaryRecordSheet.vue'
import { anniversaryOccurrences, anniversaryTypes } from '../../../../shared/anniversary.mjs'
import { getCachedHolidayCalendar, refreshHolidayCalendar } from '../../api/holiday'
import { tasksForDate, categoryById, listAnniversaries, listAnniversaryRecords } from '../../api/store'
import { monthDates, monthTitle, shiftMonth, todayString } from '../../utils/date'
import { taskMark } from '../../utils/task'

const anchor = ref(todayString())
const today = ref(todayString())
const sheetVisible = ref(false)
const presetDate = ref('')
const revision = ref(0)
const selectedDate = ref('')
const activeRecord = ref(null)
const recordSheet = ref(null)
const editingTask = ref(null)
const marks = Object.fromEntries(anniversaryTypes.map(type => [type.value, type.mark]))
let dayTimer
const holidayByDate = ref({})
let holidayRefreshRequestId = 0

const days = computed(() => monthDates(anchor.value))
const visibleHolidayYears = computed(() => [...new Set(days.value.map((date) => Number(date.slice(0, 4))))])

const dayData = computed(() => {
  // 本地存储不响应 Vue 更新，版本号驱动月历重新计算。
  revision.value
  const map = {}
  const dates = days.value
  const occurrences = anniversaryOccurrences(listAnniversaries(), dates[0], dates[dates.length - 1], listAnniversaryRecords({ startDate: dates[0], endDate: dates[dates.length - 1] }))
  dates.forEach(date => { map[date] = { tasks: tasksForDate(date), anniversaries: [], count: 0 } })
  occurrences.forEach(item => { map[item.date].anniversaries.push(item) })
  dates.forEach(date => { map[date].count = map[date].tasks.length + map[date].anniversaries.length })
  return map
})
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
onBackPress(() => { if (activeRecord.value) { recordSheet.value?.close(); return true } if (sheetVisible.value) { closeSheet(); return true } if (selectedDate.value) { selectedDate.value = ''; return true } return false })

function scheduleDay() { clearTimeout(dayTimer); const next = new Date(); next.setHours(24, 0, 0, 0); dayTimer = setTimeout(() => { reload(); scheduleDay() }, next.getTime() - Date.now() + 100) }
function releasePage() {
  clearTimeout(dayTimer)
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
  anchor.value = shiftMonth(anchor.value, amount)
  selectedDate.value = ''
  void refreshVisibleHolidayCalendar(false)
}

function resetMonth() {
  anchor.value = todayString()
  selectedDate.value = ''
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
  holidayByDate.value = { ...holidayByDate.value, ...refreshed }
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
  return categoryById(task.categoryId)?.color || '#8b98a8'
}

function openCreate(date) {
  presetDate.value = date
  editingTask.value = null
  selectedDate.value = ''
  sheetVisible.value = true
}
function editTask(task) { editingTask.value = task; selectedDate.value = ''; sheetVisible.value = true }

function closeSheet() {
  sheetVisible.value = false
  reload()
}

function reload() {
  today.value = todayString()
  revision.value++
}
</script>

<style scoped>
.day-list-mark { width: 36rpx; flex-shrink: 0; text-align: center; font-size: 24rpx; }
.day-item { display: flex; gap: 4rpx; }
.day-task-mark { flex: 0 0 26rpx; text-align: center; font-size: 17rpx; }
.day-task-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-item.day-anniversary, .day-list-anniversary { background: #eaf2fc; color: #6686a8; border-left: 3rpx solid #acc4df; }.day-item.day-anniversary.kind-birthday, .day-list-anniversary.kind-birthday { background: #fff0e6; color: #a97959; border-left-color: #e9c2a6; }.day-item.day-anniversary.kind-anniversary, .day-list-anniversary.kind-anniversary { background: #faedf2; color: #a27286; border-left-color: #dcb9c9; }.commemorated { opacity: .7; }.day-layer { position: fixed; inset: 0; z-index: 1000; background: #17243166; display: flex; align-items: flex-end; }.day-sheet { width: 100%; max-height: 80vh; background: var(--panel); border-radius: 28rpx 28rpx 0 0; padding-bottom: env(safe-area-inset-bottom); }.day-sheet-header { display: flex; justify-content: space-between; align-items: center; padding: 20rpx 32rpx; color: #657c96; font-size: 27rpx; }.day-sheet-header button { margin: 0; width: 64rpx; line-height: 64rpx; padding: 0; background: transparent; color: #8291a2; font-size: 40rpx; }.day-sheet button::after { border: 0; }.day-sheet-list { max-height: 56vh; }.day-group { display: block; padding: 12rpx 32rpx; color: #99a5b2; font-size: 24rpx; }.day-list-anniversary, .day-list-task { display: flex; align-items: center; gap: 18rpx; margin: 12rpx 32rpx; padding: 24rpx 20rpx; border-radius: 10rpx; font-size: 27rpx; }.day-list-anniversary > text:nth-child(2), .day-list-task > text:nth-child(2) { flex: 1; min-width: 0; overflow-wrap: anywhere; }.day-list-anniversary > text:last-child, .day-list-task > text:last-child { flex-shrink: 0; font-size: 22rpx; }.day-list-task { background: #f6f8fb; color: #71859c; }.day-task-dot { width: 12rpx; height: 12rpx; border-radius: 50%; flex-shrink: 0; }.day-empty { display: block; text-align: center; color: #a0aab7; padding: 60rpx 0; font-size: 28rpx; }.day-add { margin: 24rpx 32rpx; background: #7299d5; color: #fff; font-size: 27rpx; line-height: 88rpx; }
.planning-page {
  display: flex;
  flex-direction: column;
}

.month-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
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
  min-height: 148rpx;
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
</style>
