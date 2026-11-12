<template>
  <view class="day-agenda">
    <view class="day-calendar-detail">
      <text>{{ meta.lunarText }}</text>
      <text v-if="meta.markers.length">{{ meta.markers.join(' · ') }}</text>
      <text v-if="holiday">{{ holiday.name }}：{{ holiday.isOffDay ? '休息日' : '调休工作日' }}</text>
    </view>
    <text v-if="anniversaries.length" class="day-group">纪念日</text>
    <view v-for="item in anniversaries" :key="item.anniversaryId" :class="['day-list-anniversary', `kind-${item.kind}`, { commemorated: item.record?.confirmedAt }]" role="button" tabindex="0" :aria-label="`查看纪念日 ${item.label}`" @click="$emit('open-anniversary', item)" @keydown.enter.prevent="$emit('open-anniversary', item)" @keydown.space.prevent="$emit('open-anniversary', item)">
      <text>{{ marks[item.kind] }}</text>
      <text>{{ item.label }}</text>
      <text>{{ item.record?.confirmedAt ? '✓ 已纪念' : '›' }}</text>
    </view>
    <text v-if="tasks.length" class="day-group">事项</text>
    <view v-for="task in tasks" :key="task.id" :class="['day-list-task', { 'is-ended': task.planningDeleted || task.status !== 'todo' }]" :role="task.planningDeleted ? undefined : 'button'" :tabindex="task.planningDeleted ? undefined : 0" :aria-label="`${task.title}，${planningStatusLabel(task)}${task.planningDeleted ? '' : '，编辑事项'}`" @click="!task.planningDeleted && $emit('edit-task', task)" @keydown.enter.prevent="!task.planningDeleted && $emit('edit-task', task)" @keydown.space.prevent="!task.planningDeleted && $emit('edit-task', task)">
      <text class="day-list-mark" :style="{ color: colorOf(task) }">{{ task.planningDeleted ? '−' : taskMark(task) }}</text>
      <text>{{ task.title }}</text>
      <text class="day-task-status">{{ timeText(task) }} · {{ planningStatusLabel(task) }}</text>
      <button v-if="!task.planningDeleted" class="day-adjust" :aria-label="`调整事项 ${task.title}`" @click.stop="$emit('adjust-task', task)" @keydown.stop>调整</button>
    </view>
    <text v-if="!count" class="day-empty">这一天还没有安排</text>
  </view>
</template>

<script setup>
import { planningStatusLabel, taskMark } from '../utils/task'

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
  if (task.scheduleKind === 'range' && task.plannedTime && task.plannedEndTime) return `${task.plannedTime}–${task.plannedEndTime}`
  return task.plannedTime || (task.scheduleKind === 'all_day' ? '全天' : '时间未记录')
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

.day-agenda { min-width: 0; }
.day-calendar-detail { padding: 4rpx 32rpx 14rpx; color: #607993; font-size: 24rpx; line-height: 1.6; }
.day-calendar-detail text + text { margin-top: 4rpx; }
.day-group { padding: 16rpx 32rpx 4rpx; color: #607a94; font-size: 23rpx; font-weight: 600; }
.day-list-anniversary, .day-list-task {
  box-sizing: border-box;
  min-width: 0;
  gap: 14rpx;
  margin: 12rpx 24rpx;
  padding: 22rpx 18rpx;
  border-radius: 14rpx;
  line-height: 1.5;
}
.day-list-anniversary > text:first-child { flex: 0 0 36rpx; text-align: center; }
.day-list-anniversary > text:nth-child(2), .day-list-task > text:nth-child(2) { word-break: break-all; }
.day-list-anniversary > text:last-child, .day-list-task > text:last-child {
  flex: 0 1 auto;
  max-width: 38%;
  color: #667d94;
  text-align: right;
  overflow-wrap: anywhere;
  word-break: break-all;
}
.day-list-task .day-task-status { flex: 0 1 auto; max-width: 30%; color: #667d94; text-align: right; overflow-wrap: anywhere; }
.day-adjust { flex: 0 0 auto; margin: 0; min-width: 80rpx; padding: 0 12rpx; line-height: 68rpx; font-size: 23rpx; color: #176ab7; background: #e4f0fd; }
.day-adjust::after { border: 0; }
.day-list-task { background: #f3f7fb; color: #304c67; }
.day-list-task.is-ended { background: #f6f8fa; color: #65788a; }
.day-list-mark { font-size: 26rpx; font-weight: 700; }
.day-list-anniversary { background: #eaf3fc; color: #355d7d; border-left: 6rpx solid #91b6dc; }
.day-list-anniversary.kind-birthday { background: #fff1e7; color: #805336; border-left-color: #dda77f; }
.day-list-anniversary.kind-anniversary { background: #faedf2; color: #804b63; border-left-color: #cf9eb4; }
.day-list-anniversary.commemorated { opacity: 1; }
.day-list-anniversary.commemorated > text:last-child { color: #426f69; font-weight: 600; }
.day-empty { margin: 12rpx 24rpx; padding: 48rpx 16rpx; border-radius: 14rpx; background: #f7fafd; color: #71879b; font-size: 26rpx; }
.day-list-task:focus-visible, .day-list-anniversary:focus-visible { outline: 4rpx solid #79a9d7; outline-offset: -4rpx; }
</style>
