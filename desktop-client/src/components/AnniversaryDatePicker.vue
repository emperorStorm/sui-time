<template>
  <div class="anniversary-date-picker">
    <button
      ref="trigger"
      class="date-picker-trigger"
      type="button"
      :aria-label="`${label}，${formattedDate}，${weekdayLabel}`"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="toggle"
    >
      <CalendarDays :size="20" />
      <span>
        <strong>{{ formattedDate }}</strong>
        <small>{{ weekdayLabel }}</small>
      </span>
      <ChevronDown :size="17" :class="{ open }" />
    </button>

    <Teleport to="body">
      <section
        v-if="open"
        :id="panelId"
        ref="panel"
        class="anniversary-date-panel"
        :style="panelStyle"
        role="dialog"
        aria-modal="false"
        :aria-label="label"
      >
        <header class="date-panel-head">
          <div class="date-panel-selects">
            <select :value="displayYear" aria-label="选择年份" @change="changeYear">
              <option v-for="year in availableYears" :key="year" :value="year">{{ year }}年</option>
            </select>
            <select :value="displayMonth" aria-label="选择月份" @change="changeMonth">
              <option v-for="month in 12" :key="month" :value="month" :disabled="!isMonthAvailable(displayYear, month)">{{ month }}月</option>
            </select>
          </div>
          <div class="date-panel-nav">
            <button type="button" title="上一月" aria-label="上一月" :disabled="!canMoveMonth(-1)" @click="moveMonth(-1)"><ChevronLeft :size="18" /></button>
            <button type="button" title="下一月" aria-label="下一月" :disabled="!canMoveMonth(1)" @click="moveMonth(1)"><ChevronRight :size="18" /></button>
          </div>
        </header>

        <div class="date-panel-weekdays" aria-hidden="true"><span v-for="weekday in weekdays" :key="weekday">{{ weekday }}</span></div>
        <div class="date-panel-days" role="group" :aria-label="`${displayYear}年${displayMonth}月`">
          <button
            v-for="day in calendarDays"
            :key="day.date"
            type="button"
            :data-date="day.date"
            :class="{ muted: !day.currentMonth, today: day.date === today, selected: day.date === modelValue }"
            :disabled="day.disabled"
            :aria-label="formatAriaDate(day.date)"
            :aria-pressed="day.date === modelValue"
            @click="selectDate(day.date)"
            @keydown="handleDayKeydown($event, day.date)"
          >{{ day.day }}</button>
        </div>
        <footer><span>可选择 {{ min.slice(0, 4) }} 至 {{ max.slice(0, 4) }} 年</span><button type="button" :disabled="!isDateAvailable(today)" @click="selectDate(today)">今天</button></footer>
      </section>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{ modelValue: string; min: string; max: string; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const dayOffsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
const today = ref(dateString(new Date()))
const panelId = useId()
const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const open = ref(false)
const displayedMonth = ref(startOfMonth(parseDate(props.modelValue) || new Date()))
const focusedDate = ref(props.modelValue)
const panelStyle = ref<Record<string, string>>({ visibility: 'hidden' })
let positionFrame = 0

const displayYear = computed(() => displayedMonth.value.getFullYear())
const displayMonth = computed(() => displayedMonth.value.getMonth() + 1)
const availableYears = computed(() => {
  const first = Number(props.min.slice(0, 4))
  const last = Number(props.max.slice(0, 4))
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
})
const formattedDate = computed(() => {
  const date = parseDate(props.modelValue)
  return date ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日` : '请选择日期'
})
const weekdayLabel = computed(() => {
  const date = parseDate(props.modelValue)
  return date ? `星期${weekdays[(date.getDay() + 6) % 7]}` : '公历日期'
})
const calendarDays = computed(() => {
  const first = new Date(displayYear.value, displayMonth.value - 1, 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const value = dateString(date)
    return { date: value, day: date.getDate(), currentMonth: date.getMonth() === displayedMonth.value.getMonth(), disabled: !isDateAvailable(value) }
  })
})

watch(() => [props.modelValue, props.min, props.max], () => {
  focusedDate.value = clampDate(focusedDate.value || props.modelValue)
  // 类型切为生日后收回可浏览月份，但不静默修改表单中已选的日期。
  if (!open.value || !isMonthAvailable(displayYear.value, displayMonth.value)) {
    displayedMonth.value = startOfMonth(parseDate(clampDate(props.modelValue)) || new Date())
  }
  if (open.value) schedulePosition()
})

function toggle() {
  if (open.value) close(false)
  else void show()
}

async function show() {
  today.value = dateString(new Date())
  focusedDate.value = clampDate(props.modelValue || today.value)
  displayedMonth.value = startOfMonth(parseDate(focusedDate.value) || new Date())
  open.value = true
  document.addEventListener('pointerdown', closeOnOutsideClick)
  document.addEventListener('focusin', closeOnOutsideFocus)
  window.addEventListener('keydown', handleWindowKeydown, true)
  window.addEventListener('resize', schedulePosition)
  window.addEventListener('scroll', schedulePosition, true)
  await nextTick()
  if (!open.value) return
  updatePosition()
  await nextTick()
  focusDay(focusedDate.value)
}

function close(restoreFocus: boolean) {
  if (!open.value) return
  open.value = false
  removeOpenListeners()
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}

function selectDate(value: string) {
  if (!isDateAvailable(value)) return
  emit('update:modelValue', value)
  close(true)
}

function moveMonth(offset: number) {
  if (!canMoveMonth(offset)) return
  const next = new Date(displayYear.value, displayMonth.value - 1 + offset, 1)
  displayedMonth.value = startOfMonth(next)
  schedulePosition()
}

function changeYear(event: Event) {
  const year = Number((event.target as HTMLSelectElement).value)
  let month = displayMonth.value
  if (!isMonthAvailable(year, month)) month = findAvailableMonth(year)
  displayedMonth.value = new Date(year, month - 1, 1)
  schedulePosition()
}

function changeMonth(event: Event) {
  displayedMonth.value = new Date(displayYear.value, Number((event.target as HTMLSelectElement).value) - 1, 1)
  schedulePosition()
}

function handleDayKeydown(event: KeyboardEvent, value: string) {
  const offset = dayOffsets[event.key]
  if (!offset) return
  event.preventDefault()
  const date = parseDate(value)
  if (!date) return
  date.setDate(date.getDate() + offset)
  const next = clampDate(dateString(date))
  focusedDate.value = next
  displayedMonth.value = startOfMonth(parseDate(next) || date)
  void nextTick(() => focusDay(next))
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return
  event.preventDefault()
  event.stopPropagation()
  close(true)
}

function closeOnOutsideClick(event: PointerEvent) {
  const target = event.target as Node
  if (!trigger.value?.contains(target) && !panel.value?.contains(target)) close(false)
}

function closeOnOutsideFocus(event: FocusEvent) {
  const target = event.target as Node
  if (!trigger.value?.contains(target) && !panel.value?.contains(target)) close(false)
}

function focusDay(value: string) {
  panel.value?.querySelector<HTMLElement>(`[data-date="${value}"]`)?.focus({ preventScroll: true })
}

function schedulePosition() {
  window.cancelAnimationFrame(positionFrame)
  positionFrame = window.requestAnimationFrame(updatePosition)
}

function updatePosition() {
  positionFrame = 0
  if (!open.value || !trigger.value) return
  const margin = 8
  const gap = 8
  const rect = trigger.value.getBoundingClientRect()
  const width = Math.min(360, window.innerWidth - margin * 2)
  const height = panel.value?.offsetHeight || 390
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
  const below = window.innerHeight - rect.bottom - gap - margin
  const above = rect.top - gap - margin
  const top = below >= height || below >= above
    ? Math.min(rect.bottom + gap, window.innerHeight - height - margin)
    : Math.max(margin, rect.top - height - gap)
  panelStyle.value = { width: `${width}px`, left: `${left}px`, top: `${Math.max(margin, top)}px`, visibility: 'visible' }
}

function canMoveMonth(offset: number) {
  const target = new Date(displayYear.value, displayMonth.value - 1 + offset, 1)
  return isMonthAvailable(target.getFullYear(), target.getMonth() + 1)
}

function isMonthAvailable(year: number, month: number) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const last = dateString(new Date(year, month, 0))
  return last >= props.min && first <= props.max
}

function findAvailableMonth(year: number) {
  for (let month = 1; month <= 12; month++) if (isMonthAvailable(year, month)) return month
  return 1
}

function isDateAvailable(value: string) { return value >= props.min && value <= props.max }
function clampDate(value: string) { return value < props.min ? props.min : value > props.max ? props.max : value }
function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day ? date : null
}
function startOfMonth(value: Date) { return new Date(value.getFullYear(), value.getMonth(), 1) }
function dateString(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
function formatAriaDate(value: string) {
  const date = parseDate(value)
  return date ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日，星期${weekdays[(date.getDay() + 6) % 7]}` : value
}
function removeOpenListeners() {
  document.removeEventListener('pointerdown', closeOnOutsideClick)
  document.removeEventListener('focusin', closeOnOutsideFocus)
  window.removeEventListener('keydown', handleWindowKeydown, true)
  window.removeEventListener('resize', schedulePosition)
  window.removeEventListener('scroll', schedulePosition, true)
  window.cancelAnimationFrame(positionFrame)
  positionFrame = 0
}

onBeforeUnmount(removeOpenListeners)
</script>

<style scoped>
.anniversary-date-picker { width: 100%; }
.date-picker-trigger { display: flex; width: 100%; height: 52px; align-items: center; padding: 0 14px; border: 1px solid var(--ui-line); border-radius: 7px; background: #fff; color: var(--ui-primary); gap: 11px; text-align: left; transition: border-color .16s, box-shadow .16s, background .16s; }
.date-picker-trigger:hover { border-color: #a8c8ed; background: #fbfdff; }
.date-picker-trigger:focus-visible, .date-picker-trigger[aria-expanded="true"] { border-color: #70aaf1; box-shadow: 0 0 0 3px rgba(52, 133, 234, .12); outline: 0; }
.date-picker-trigger > span { display: grid; min-width: 0; flex: 1; gap: 2px; }
.date-picker-trigger strong { overflow: hidden; color: var(--ui-ink); font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.date-picker-trigger small { color: #8a96a3; font-size: 11px; font-weight: 500; }
.date-picker-trigger > svg:last-child { color: #9ba7b3; transition: transform .16s; }
.date-picker-trigger > svg:last-child.open { transform: rotate(180deg); }
.anniversary-date-panel { position: fixed; z-index: 1100; max-height: calc(100dvh - 16px); overflow-y: auto; overscroll-behavior: contain; padding: 14px; border: 1px solid #d8e2ed; border-radius: 8px; background: #fff; box-shadow: 0 18px 44px rgba(24, 43, 65, .2); }
.date-panel-head { display: flex; min-height: 38px; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid #edf1f5; gap: 10px; }
.date-panel-selects, .date-panel-nav { display: flex; align-items: center; gap: 6px; }
.date-panel-selects select { height: 34px; padding: 0 27px 0 9px; border: 1px solid #dde5ee; border-radius: 6px; background-color: #f8fafc; color: #405164; font-size: 13px; font-weight: 650; }
.date-panel-selects select:focus { border-color: #70aaf1; box-shadow: 0 0 0 3px rgba(52, 133, 234, .11); }
.date-panel-nav button { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 6px; background: transparent; color: #718091; }
.date-panel-nav button:hover:not(:disabled) { background: var(--ui-primary-soft); color: var(--ui-primary); }
.date-panel-nav button:disabled { cursor: not-allowed; opacity: .34; }
.date-panel-weekdays, .date-panel-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); text-align: center; }
.date-panel-weekdays { padding: 13px 0 6px; color: #98a4af; font-size: 11px; font-weight: 700; }
.date-panel-days { gap: 2px; }
.date-panel-days button { width: 40px; height: 40px; justify-self: center; border-radius: 50%; background: transparent; color: #46576a; font-size: 13px; font-variant-numeric: tabular-nums; transition: background .14s, color .14s, box-shadow .14s; }
.date-panel-days button:hover:not(:disabled) { background: var(--ui-primary-soft); color: var(--ui-primary); }
.date-panel-days button:focus-visible { outline: 2px solid #7eb3ee; outline-offset: 1px; }
.date-panel-days button.muted { color: #bdc6cf; }
.date-panel-days button.today { box-shadow: inset 0 0 0 1px #a7c9ef; color: var(--ui-primary); font-weight: 700; }
.date-panel-days button.selected { background: var(--ui-primary); box-shadow: 0 4px 10px rgba(47, 128, 237, .25); color: #fff; font-weight: 700; }
.date-panel-days button:disabled { cursor: not-allowed; color: #d7dde3; }
.anniversary-date-panel footer { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; padding-top: 11px; border-top: 1px solid #edf1f5; }
.anniversary-date-panel footer span { color: #919daa; font-size: 10px; }
.anniversary-date-panel footer button { min-height: 30px; padding: 0 10px; border-radius: 5px; background: var(--ui-primary-soft); color: var(--ui-primary); font-size: 11px; font-weight: 700; }
.anniversary-date-panel footer button:hover:not(:disabled) { background: #dcecff; }
.anniversary-date-panel footer button:disabled { cursor: not-allowed; opacity: .45; }
@media (max-width: 420px) {
  .anniversary-date-panel { padding: 10px; }
  .date-panel-days { gap: 2px 0; }
}
@media (prefers-reduced-motion: reduce) {
  .date-picker-trigger, .date-picker-trigger > svg:last-child, .date-panel-days button { transition: none; }
}
</style>
