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
        <view v-for="date in days" :key="date" :class="['month-day', { 'is-today': date === today, 'is-muted': !inMonth(date) }]" @click="openCreate(date)">
          <text class="day-num">{{ dayNum(date) }}</text>
          <view class="day-items">
            <view v-for="task in tasksOf(date).slice(0, 2)" :key="task.id" class="day-item" :style="{ background: colorOf(task) }">
              <text>{{ task.title }}</text>
            </view>
            <text v-if="tasksOf(date).length > 2" class="day-more">+{{ tasksOf(date).length - 2 }}</text>
          </view>
        </view>
      </view>
    </view>

    <TaskEditSheet :visible="sheetVisible" :preset-date="presetDate" @close="closeSheet" @saved="reload" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import TaskEditSheet from '../../components/TaskEditSheet.vue'
import { tasksForDate, categoryById } from '../../api/store'
import { monthDates, monthTitle, shiftMonth, todayString } from '../../utils/date'

const anchor = ref(todayString())
const today = todayString()
const sheetVisible = ref(false)
const presetDate = ref('')
const monthCache = ref({})

const days = computed(() => monthDates(anchor.value))

const monthMap = computed(() => {
  const map = {}
  days.value.forEach((date) => { map[date] = tasksForDate(date) })
  return map
})

onShow(() => {
  anchor.value = todayString()
  monthCache.value = {}
})

function shift(amount) {
  anchor.value = shiftMonth(anchor.value, amount)
  monthCache.value = {}
}

function resetMonth() {
  anchor.value = todayString()
  monthCache.value = {}
}

function inMonth(date) {
  return date.slice(0, 7) === anchor.value.slice(0, 7)
}

function dayNum(date) {
  return Number(date.slice(8, 10))
}

function tasksOf(date) {
  if (!monthCache.value[date]) monthCache.value[date] = tasksForDate(date)
  return monthCache.value[date]
}

function colorOf(task) {
  return categoryById(task.categoryId)?.color || '#8b98a8'
}

function openCreate(date) {
  presetDate.value = date
  sheetVisible.value = true
}

function closeSheet() {
  sheetVisible.value = false
  monthCache.value = {}
}

function reload() {
  monthCache.value = {}
}
</script>

<style scoped>
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
