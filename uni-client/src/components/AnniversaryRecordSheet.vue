<template>
  <view v-if="occurrence && !suspended" class="record-layer" @click="close">
    <view class="record-sheet" @click.stop>
      <view class="record-header"><text>本次纪念</text><button :disabled="saving" aria-label="关闭" @click="close">×</button></view>
      <scroll-view class="record-body" scroll-y>
        <text class="record-title">{{ display.label }}</text>
        <text class="record-date">{{ display.date }} {{ calendar.weekday }} · 农历{{ calendar.lunar }}</text>
        <text v-if="display.adjusted" class="record-hint">本年没有 2 月 29 日，按 2 月末纪念。</text>
        <text v-if="record?.confirmedAt" class="record-confirmed">✓ 已纪念 · {{ new Date(record.confirmedAt).toLocaleDateString() }}</text>
        <view v-if="occurrence.notes" class="record-original"><text class="record-label">原始备注</text><text>{{ occurrence.notes }}</text></view>
        <text class="record-label">本次备注 · 选填，最多 2000 字</text>
        <textarea v-model="notes" :disabled="future || saving" maxlength="2000" placeholder="记下这一天怎样度过，留下一段回忆。" />
        <text v-if="future" class="record-hint">当天起可填写备注和确认，过去的日期也可补记。</text>
        <text v-if="error" class="record-error">{{ error }}</text>
        <button class="record-details" :disabled="saving" @click="details">查看详情与照片 ›</button>
      </scroll-view>
      <view v-if="!future" class="record-footer"><button :disabled="saving" @click="save(Boolean(record?.confirmedAt))">保存备注</button><button class="record-primary" :disabled="saving" @click="save(!record?.confirmedAt)">{{ saving ? '正在保存…' : record?.confirmedAt ? '撤销确认' : '确认已纪念' }}</button></view>
    </view>
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getAnniversaryRecordSnapshot, saveAnniversaryRecord } from '../api/store'
import { anniversaryRecordOccurrence } from '../../../shared/anniversary.mjs'
import { anniversaryCalendar, localToday } from '../utils/anniversary'
const props = defineProps({ occurrence: { type: Object, default: null }, suspended: { type: Boolean, default: false }, today: { type: String, default: localToday } })
const emit = defineEmits(['close', 'saved'])
const notes = ref('')
const record = ref(null)
const saving = ref(false)
const error = ref('')
const display = computed(() => record.value ? anniversaryRecordOccurrence(record.value, props.occurrence.notes) : props.occurrence)
const calendar = computed(() => display.value ? anniversaryCalendar(display.value.date) : null)
const future = computed(() => props.occurrence && props.occurrence.date > props.today)
let baseline = ''
let recordSnapshot = null
let snapshotReady = false
let generation = 0
let pendingClose = false
let closed = false
watch(() => props.occurrence, (value, previous) => {
  if (value && previous && value.anniversaryId === previous.anniversaryId && value.date === previous.date) return
  generation++
  pendingClose = false
  closed = false
  record.value = value?.record ? JSON.parse(JSON.stringify(value.record)) : null
  notes.value = record.value?.notes || ''
  baseline = notes.value
  snapshotReady = false
  error.value = ''
  if (value) {
    try {
      recordSnapshot = getAnniversaryRecordSnapshot(value.anniversaryId, value.date, record.value)
      snapshotReady = true
    } catch (cause) { error.value = cause.message || String(cause) }
  }
}, { immediate: true, flush: 'sync' })
watch(() => props.suspended, suspended => {
  if (suspended) { generation++; pendingClose = false }
}, { flush: 'sync' })
onBeforeUnmount(() => { generation++ })
async function leave(navigate) {
  if (props.suspended || !props.occurrence || saving.value || pendingClose || closed) return false
  const session = generation
  const current = notes.value
  const id = props.occurrence.anniversaryId
  if (current !== baseline) {
    pendingClose = true
    try {
      const result = await new Promise((resolve, reject) => uni.showModal({ title: '放弃未保存的备注？', content: '离开后，本次备注修改将不会保存。', confirmText: '放弃', success: resolve, fail: reject }))
      if (!result?.confirm || session !== generation || !props.occurrence || notes.value !== current) return false
    } catch (cause) {
      if (session === generation) error.value = '确认窗口无法打开，请重试'
      return false
    } finally { if (session === generation) pendingClose = false }
  }
  if (session !== generation || !props.occurrence) return false
  closed = true
  emit('close')
  if (navigate) uni.navigateTo({ url: `/pages/anniversaries/detail?id=${encodeURIComponent(id)}` })
  return true
}
function close() { return leave(false) }
function details() { return leave(true) }
function save(confirmed) {
  if (props.suspended || !props.occurrence || saving.value || future.value || pendingClose || closed || !snapshotReady) return
  saving.value = true
  error.value = ''
  try {
    const result = saveAnniversaryRecord({ anniversaryId: props.occurrence.anniversaryId, date: props.occurrence.date, notes: notes.value, confirmed }, { expectedSnapshot: recordSnapshot })
    recordSnapshot = JSON.parse(JSON.stringify(result))
    record.value = result
    notes.value = result.notes
    baseline = notes.value
    emit('saved', result)
  } catch (cause) { error.value = cause.message || String(cause) }
  finally { saving.value = false }
}
defineExpose({ close })
</script>

<style scoped>
.record-layer { position: fixed; inset: 0; z-index: 1100; background: #17243166; display: flex; align-items: flex-end; }.record-sheet { background: var(--panel, #fff); border-radius: 28rpx 28rpx 0 0; width: 100%; max-height: 88vh; display: flex; flex-direction: column; padding-bottom: env(safe-area-inset-bottom); }.record-header { display: flex; align-items: center; justify-content: space-between; padding: 24rpx 32rpx; color: #8291a2; font-size: 26rpx; border-bottom: 2rpx solid #eef1f5; }.record-header button { background: transparent; font-size: 40rpx; margin: 0; padding: 0; width: 64rpx; line-height: 64rpx; color: #8291a2; }.record-sheet button::after { border: 0; }.record-body { min-height: 0; max-height: 62vh; }.record-original, .record-body textarea { margin-left: 32rpx; margin-right: 32rpx; }.record-title { display: block; font-size: 40rpx; color: #4d637c; font-weight: 600; margin-top: 36rpx; overflow-wrap: anywhere; }.record-date { display: block; color: #7c91a6; font-size: 25rpx; margin-top: 20rpx; }.record-hint, .record-label { display: block; font-size: 24rpx; color: #95a2b0; line-height: 1.8; margin-top: 24rpx; }.record-confirmed { display: block; color: #539376; font-size: 26rpx; margin-top: 28rpx; }.record-original > text:last-child { display: block; color: #778796; font-size: 28rpx; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; margin-top: 12rpx; }.record-body textarea { box-sizing: border-box; width: calc(100% - 64rpx); height: 230rpx; background: #f5f8fc; padding: 22rpx; border-radius: 12rpx; font-size: 28rpx; margin-top: 16rpx; }.record-error { display: block; color: #cf6b77; font-size: 25rpx; margin-top: 20rpx; }.record-details { background: transparent; color: #7194b7; font-size: 25rpx; text-align: left; margin: 20rpx 20rpx; }.record-footer { display: flex; gap: 20rpx; padding: 24rpx 32rpx; }.record-footer button { flex: 1; margin: 0; background: #f1f5fa; color: #7189a4; font-size: 27rpx; padding: 0; line-height: 88rpx; }.record-footer .record-primary { background: #7299d5; color: #fff; }
.record-title, .record-date, .record-hint, .record-label, .record-confirmed, .record-error { margin-left: 32rpx; margin-right: 32rpx; }
.record-original .record-label { margin-left: 0; margin-right: 0; }
.record-sheet { box-sizing: border-box; max-width: 900rpx; margin: 0 auto; background: #fff; box-shadow: 0 -12rpx 48rpx #244b7520; }
.record-header { background: #f8fbff; color: #526f8d; }
.record-title, .record-original > text:last-child, .record-error { overflow-wrap: anywhere; }
.record-footer button { min-width: 0; border-radius: 14rpx; line-height: 1.4; padding: 24rpx 8rpx; }
.record-footer .record-primary { background: var(--blue); }
.record-details { min-height: 72rpx; color: #397eb7; }
</style>
