<template>
  <Teleport to="body">
    <div class="modal-backdrop anniversary-record-backdrop" @mousedown.self="close">
      <section class="modal-panel anniversary-record-modal" role="dialog" aria-modal="true" aria-labelledby="record-title">
        <header><div><p class="eyebrow">{{ type.label }} · 本次纪念</p><h2 id="record-title">{{ display.label }}</h2></div><button class="icon-button ghost" title="关闭" :disabled="saving" @click="close"><X :size="20" /></button></header>
        <div class="record-date"><strong>{{ display.date }} {{ calendar.weekday }}</strong><span>农历{{ calendar.lunar }}</span><span v-if="display.adjusted">本年没有 2 月 29 日，按 2 月末纪念。</span></div>
        <p v-if="record?.confirmedAt" class="record-confirmed"><Check :size="16" />已纪念 · {{ new Date(record.confirmedAt).toLocaleDateString() }}</p>
        <div v-if="occurrence.notes" class="record-original"><small>原始备注</small><p>{{ occurrence.notes }}</p></div>
        <label class="field"><span>本次备注 <small>选填，最多 2000 字</small></span><textarea v-model="notes" :readonly="future || saving" maxlength="2000" rows="5" placeholder="记下这一天怎样度过，以及想留给未来的回忆。" /></label>
        <p v-if="future" class="record-hint">当天起可以填写备注和确认，过去的日期也可补记。</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <footer><button class="quiet-button" :disabled="saving" @click="emit('details', occurrence.anniversaryId)">查看详情与照片</button><div v-if="!future" class="record-buttons"><button class="quiet-button" :disabled="saving" @click="save(Boolean(record?.confirmedAt))">保存备注</button><button class="primary-button" :disabled="saving" @click="save(!record?.confirmedAt)">{{ saving ? '正在保存…' : record?.confirmedAt ? '撤销确认' : '确认已纪念' }}</button></div><button v-else class="primary-button" @click="close">关闭</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, X } from 'lucide-vue-next'
import type { AnniversaryOccurrence } from '../types'
import { saveAnniversaryRecord } from '../api/native'
import { anniversaryRecordOccurrence } from '../../../shared/anniversary.mjs'
import { anniversaryCalendar, anniversaryTypes, localToday } from '../utils/anniversary'

const props = defineProps<{ occurrence: AnniversaryOccurrence }>()
const emit = defineEmits(['close', 'saved', 'details'])
const notes = ref('')
const record = ref(props.occurrence.record)
const saving = ref(false)
const error = ref('')
const today = ref(localToday())
const display = computed(() => record.value ? anniversaryRecordOccurrence(record.value, props.occurrence.notes) : props.occurrence)
const calendar = computed(() => anniversaryCalendar(display.value.date))
const type = computed(() => anniversaryTypes.find(type => type.value === display.value.kind)!)
const future = computed(() => props.occurrence.date > today.value)
let timer: number | undefined
let disposed = false
watch(() => props.occurrence, value => { record.value = value.record; notes.value = value.record?.notes || ''; error.value = '' }, { immediate: true })
function close() { if (!saving.value) emit('close') }
async function save(confirmed: boolean) {
  if (saving.value || future.value) return
  saving.value = true
  error.value = ''
  try {
    const result = await saveAnniversaryRecord({ anniversaryId: props.occurrence.anniversaryId, date: props.occurrence.date, notes: notes.value, confirmed })
    if (!disposed) { record.value = result; notes.value = result.notes; emit('saved', result) }
  } catch (cause) { if (!disposed) error.value = String(cause) }
  finally { saving.value = false }
}
function refreshDay() {
  today.value = localToday()
  window.clearTimeout(timer)
  const midnight = new Date()
  midnight.setHours(24, 0, 0, 0)
  timer = window.setTimeout(refreshDay, midnight.getTime() - Date.now() + 100)
}
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
onMounted(() => { refreshDay(); window.addEventListener('focus', refreshDay); document.addEventListener('keydown', keydown) })
onBeforeUnmount(() => { disposed = true; window.clearTimeout(timer); window.removeEventListener('focus', refreshDay); document.removeEventListener('keydown', keydown) })
</script>

<style scoped>
.anniversary-record-backdrop { z-index: 1200; }
.anniversary-record-modal { width: min(620px, calc(100vw - 40px)); max-height: calc(100vh - 48px); overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
.anniversary-record-modal h2 { overflow-wrap: anywhere; font-size: 23px; }
.record-date { display: flex; flex-direction: column; gap: 8px; color: #6b819a; font-size: 13px; padding-bottom: 16px; border-bottom: 1px solid #edf0f4; }
.record-date strong { font-size: 17px; color: #4d637c; }.record-confirmed { display: flex; align-items: center; gap: 8px; color: #539376; font-size: 13px; }
.record-original small, .record-hint, .field small { color: #8896a5; font-size: 12px; }.record-original p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.7; margin-top: 8px; }
.field textarea { resize: vertical; min-height: 120px; }.record-buttons { display: flex; gap: 8px; }.anniversary-record-modal footer { flex-wrap: wrap; justify-content: space-between; gap: 12px; }
</style>
