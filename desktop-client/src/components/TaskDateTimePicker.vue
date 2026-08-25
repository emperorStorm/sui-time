<template>
  <section class="time-picker-sheet" role="dialog" aria-modal="true" aria-label="设置日期与时间">
    <header class="time-picker-head">
      <div>
        <small>事项安排</small>
        <h2>日期与时间</h2>
      </div>
      <button class="icon-button ghost" type="button" title="关闭" @click="close"><X :size="19" /></button>
    </header>

    <div class="time-picker-tabs" role="tablist" aria-label="安排类型">
      <button v-for="option in scheduleOptions" :key="option.value" :class="{ active: draft.scheduleKind === option.value }" type="button" role="tab" :aria-selected="draft.scheduleKind === option.value" @click="setScheduleKind(option.value)">{{ option.label }}</button>
    </div>

    <div class="time-picker-quick-actions">
      <button type="button" @click="selectQuickDate(0)">今天</button>
      <button type="button" @click="selectQuickDate(1)">明天</button>
      <button type="button" @click="selectNextMonday">下周一</button>
      <strong>{{ selectedDateLabel }}</strong>
    </div>

    <div :class="['time-picker-content', { 'all-day': draft.scheduleKind === 'all_day' }]">
      <section class="date-calendar" aria-label="选择日期">
        <header>
          <strong>{{ monthLabel }}</strong>
          <div>
            <button type="button" title="上一月" @click="moveMonth(-1)"><ChevronLeft :size="17" /></button>
            <button type="button" title="下一月" @click="moveMonth(1)"><ChevronRight :size="17" /></button>
          </div>
        </header>
        <div class="calendar-weekdays"><span v-for="weekday in weekdays" :key="weekday">{{ weekday }}</span></div>
        <div class="calendar-days">
          <button v-for="day in calendarDays" :key="day.date" :class="{ muted: !day.currentMonth, selected: day.date === draft.plannedDate, today: day.date === today }" type="button" :aria-label="day.date" :aria-pressed="day.date === draft.plannedDate" @click="selectDate(day.date)">{{ day.day }}</button>
        </div>
      </section>

      <section v-if="draft.scheduleKind !== 'all_day'" class="time-wheel-area" aria-label="选择时间">
        <div v-for="field in timeFields" :key="field.key" class="time-wheel-group">
          <strong>{{ field.label }}</strong>
          <div class="time-wheel-value">{{ timeValue(field.key) }}</div>
          <div class="time-wheels">
            <div class="time-wheel" aria-label="小时">
              <button v-for="hour in hours" :key="hour" :class="{ selected: selectedHour(field.key) === hour }" type="button" @click="setTimePart(field.key, 'hour', hour)">{{ hour }}</button>
            </div>
            <span>:</span>
            <div class="time-wheel" aria-label="分钟">
              <button v-for="minute in minutes" :key="minute" :class="{ selected: selectedMinute(field.key) === minute }" type="button" @click="setTimePart(field.key, 'minute', minute)">{{ minute }}</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <p v-if="error" class="time-picker-error">{{ error }}</p>
    <footer>
      <button class="quiet-button" type="button" @click="clear">清除安排</button>
      <span></span>
      <button class="quiet-button" type="button" @click="close">取消</button>
      <button class="primary-button" type="button" @click="save">保存</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import type { ScheduleKind } from '../types'

export type TaskTimeSelection = {
  plannedDate: string | null
  plannedTime: string | null
  plannedEndTime: string | null
  scheduleKind: ScheduleKind
}

type TimeField = { key: 'plannedTime' | 'plannedEndTime'; label: string }

const props = defineProps<{ selection: TaskTimeSelection }>()
const emit = defineEmits<{ save: [value: TaskTimeSelection]; close: [] }>()
const scheduleOptions: Array<{ value: ScheduleKind; label: string }> = [{ value: 'point', label: '时间点' }, { value: 'range', label: '时间段' }, { value: 'all_day', label: '全天' }]
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))
const draft = reactive<TaskTimeSelection>({ plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day' })
const displayedMonth = ref(new Date())
const error = ref('')
const today = dateString(new Date())

watch(() => props.selection, value => {
  Object.assign(draft, value)
  displayedMonth.value = startOfMonth(parseDate(value.plannedDate) || new Date())
  error.value = ''
}, { immediate: true, deep: true })

const monthLabel = computed(() => `${displayedMonth.value.getFullYear()}年${displayedMonth.value.getMonth() + 1}月`)
const selectedDateLabel = computed(() => draft.plannedDate ? formatDateLabel(draft.plannedDate) : '未选择日期')
const timeFields = computed<TimeField[]>(() => draft.scheduleKind === 'range'
  ? [{ key: 'plannedTime', label: '开始' }, { key: 'plannedEndTime', label: '结束' }]
  : [{ key: 'plannedTime', label: '时间' }])
const calendarDays = computed(() => {
  const first = new Date(displayedMonth.value.getFullYear(), displayedMonth.value.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return { date: dateString(date), day: date.getDate(), currentMonth: date.getMonth() === displayedMonth.value.getMonth() }
  })
})

function setScheduleKind(kind: ScheduleKind) {
  draft.scheduleKind = kind
  error.value = ''
  if (kind === 'all_day') {
    draft.plannedTime = null
    draft.plannedEndTime = null
    return
  }
  const defaultDateTime = roundedDateTime()
  if (!draft.plannedDate) selectDate(defaultDateTime.date)
  if (!draft.plannedTime) draft.plannedTime = defaultDateTime.time
  if (kind === 'range' && !draft.plannedEndTime) draft.plannedEndTime = addMinutes(draft.plannedTime, 60)
}

function selectQuickDate(offset: number) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  selectDate(dateString(date))
}

function selectNextMonday() {
  const date = new Date()
  const offset = ((8 - date.getDay()) % 7) || 7
  date.setDate(date.getDate() + offset)
  selectDate(dateString(date))
}

function selectDate(value: string) {
  draft.plannedDate = value
  displayedMonth.value = startOfMonth(parseDate(value) || new Date())
  error.value = ''
}

function moveMonth(offset: number) {
  const next = new Date(displayedMonth.value)
  next.setMonth(next.getMonth() + offset)
  displayedMonth.value = startOfMonth(next)
}

function timeValue(key: TimeField['key']) { return draft[key] || '--:--' }
function selectedHour(key: TimeField['key']) { return (draft[key] || roundedDateTime().time).slice(0, 2) }
function selectedMinute(key: TimeField['key']) { return (draft[key] || roundedDateTime().time).slice(3, 5) }
function setTimePart(key: TimeField['key'], part: 'hour' | 'minute', value: string) {
  const current = draft[key] || roundedDateTime().time
  draft[key] = part === 'hour' ? `${value}:${current.slice(3, 5)}` : `${current.slice(0, 2)}:${value}`
  error.value = ''
}

function clear() {
  Object.assign(draft, { plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day' })
  error.value = ''
}

function save() {
  if (draft.scheduleKind === 'range' && (!draft.plannedTime || !draft.plannedEndTime || draft.plannedTime >= draft.plannedEndTime)) {
    error.value = '结束时间必须晚于开始时间'
    return
  }
  emit('save', { ...draft })
}

function close() { emit('close') }
function dateString(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
function parseDate(value: string | null) { return value ? new Date(`${value}T12:00:00`) : null }
function startOfMonth(value: Date) { return new Date(value.getFullYear(), value.getMonth(), 1) }
function roundedDateTime() {
  const value = new Date()
  value.setSeconds(0, 0)
  value.setMinutes(Math.ceil(value.getMinutes() / 5) * 5)
  return {
    date: dateString(value),
    time: `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
  }
}
function addMinutes(value: string, amount: number) {
  const [hour, minute] = value.split(':').map(Number)
  const total = Math.min(hour * 60 + minute + amount, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
function formatDateLabel(value: string) {
  const date = parseDate(value)
  if (!date) return '未选择日期'
  return `${date.getMonth() + 1}月${date.getDate()}日 周${weekdays[(date.getDay() + 6) % 7]}`
}
</script>
