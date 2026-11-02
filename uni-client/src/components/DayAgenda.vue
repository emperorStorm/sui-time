<template>
  <view class="day-agenda">
    <view class="day-calendar-detail">
      <text>{{ meta.lunarText }}</text>
      <text v-if="meta.markers.length">{{ meta.markers.join(' · ') }}</text>
      <text v-if="holiday">{{ holiday.name }}：{{ holiday.isOffDay ? '休息日' : '调休工作日' }}</text>
    </view>
    <text v-if="anniversaries.length" class="day-group">纪念日</text>
    <view v-for="item in anniversaries" :key="item.anniversaryId" :class="['day-list-anniversary', `kind-${item.kind}`, { commemorated: item.record?.confirmedAt }]" @click="$emit('open-anniversary', item)">
      <text>{{ marks[item.kind] }}</text>
      <text>{{ item.label }}</text>
      <text>{{ item.record?.confirmedAt ? '✓ 已纪念' : '›' }}</text>
    </view>
    <text v-if="tasks.length" class="day-group">待办</text>
    <view v-for="task in tasks" :key="task.id" class="day-list-task" @click="$emit('edit-task', task)" @longpress="$emit('adjust-task', task)">
      <text class="day-list-mark" :style="{ color: colorOf(task) }">{{ taskMark(task) }}</text>
      <text>{{ task.title }}</text>
      <text>{{ timeText(task) }}</text>
    </view>
    <text v-if="!count" class="day-empty">这一天还没有安排</text>
  </view>
</template>

<script setup>
import { taskMark } from '../utils/task'

defineProps({
  tasks: { type: Array, default: () => [] },
  anniversaries: { type: Array, default: () => [] },
  count: { type: Number, default: 0 },
  meta: { type: Object, default: () => ({ lunarText: '', markers: [] }) },
  holiday: { type: Object, default: null },
  marks: { type: Object, default: () => ({}) },
  colorOf: { type: Function, default: () => '#8b98a8' }
})

defineEmits(['edit-task', 'open-anniversary', 'adjust-task'])

function timeText(task) {
  return task.scheduleKind === 'range' ? `${task.plannedTime}–${task.plannedEndTime}` : task.plannedTime || '全天'
}
</script>

<style scoped>
.day-calendar-detail { padding: 0 32rpx 12rpx; color: #8493a4; font-size: 24rpx; line-height: 1.6; overflow-wrap: anywhere; }
.day-calendar-detail text { display: block; }
.day-list-mark { width: 36rpx; flex-shrink: 0; text-align: center; font-size: 24rpx; }
.day-list-anniversary, .day-list-task { display: flex; align-items: center; gap: 18rpx; margin: 12rpx 32rpx; padding: 24rpx 20rpx; border-radius: 10rpx; font-size: 27rpx; }
.day-list-anniversary > text:nth-child(2), .day-list-task > text:nth-child(2) { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.day-list-anniversary > text:last-child, .day-list-task > text:last-child { flex-shrink: 0; font-size: 22rpx; }
.day-list-task { background: #f6f8fb; color: #71859c; }
.day-list-anniversary { background: #eaf2fc; color: #6686a8; border-left: 3rpx solid #acc4df; }
.day-list-anniversary.kind-birthday { background: #fff0e6; color: #a97959; border-left-color: #e9c2a6; }
.day-list-anniversary.kind-anniversary { background: #faedf2; color: #a27286; border-left-color: #dcb9c9; }
.commemorated { opacity: .7; }
.day-group { display: block; padding: 12rpx 32rpx; color: #99a5b2; font-size: 24rpx; }
.day-empty { display: block; text-align: center; color: #a0aab7; padding: 60rpx 0; font-size: 28rpx; }
</style>
