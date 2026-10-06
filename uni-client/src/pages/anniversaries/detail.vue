<template>
  <view class="page anniversary-detail-page">
    <view class="topbar"><button class="back-button" aria-label="返回" @click="back">‹</button><view class="topbar-title">{{ item ? typeMeta[item.kind].label : '纪念日' }}</view><button v-if="item" class="edit-button" @click="editing = true">编辑</button><view v-else /> </view>
    <view v-if="error" class="detail-error" @click="refresh">{{ error }} · 点击重试</view>
    <view v-if="item && state" class="shell"><view :class="['anniversary-hero', `theme-${item.theme}`]"><text class="hero-label">{{ item.kind === 'anniversary' && item.date <= today ? '已经相伴' : state.label }}</text><view class="hero-number">{{ item.kind === 'anniversary' && item.date <= today ? state.elapsedDays : state.days }}<text>天</text></view><text v-if="item.kind === 'anniversary' && item.date <= today" class="hero-elapsed">{{ state.elapsedText }}</text><text class="hero-title">{{ item.title }}</text><text class="hero-date">{{ item.date }} {{ originalCalendar.weekday }} · 农历{{ originalCalendar.lunar }}</text></view>
<view class="detail-body"><view v-if="item.kind !== 'countdown'" class="detail-next"><text class="detail-label">下一{{ item.kind === 'birthday' ? '生日' : item.kind === 'holiday' ? '节日' : '周年' }}</text><text class="next-date">{{ state.nextDate }} {{ calendar.weekday }}</text><text class="detail-label">农历{{ calendar.lunar }} · {{ state.label }}<text v-if="state.days"> {{ state.days }} 天</text></text></view><text v-if="state.adjusted" class="detail-hint">下次纪念年份没有 2 月 29 日，按 2 月末纪念。</text><view v-if="item.kind === 'birthday'" class="birthday-info"><view><text class="birthday-value">{{ state.age }}岁</text><text class="birthday-caption">当前周岁</text><text class="birthday-caption">下次满{{ state.nextAge }}岁</text></view><view><text class="birthday-value">属{{ originalCalendar.zodiac }}</text><text class="birthday-caption">生肖</text></view><view><text class="birthday-value">{{ originalCalendar.star }}</text><text class="birthday-caption">星座</text></view></view><text v-if="item.notes" class="detail-notes">{{ item.notes }}</text><view v-if="item.photos.length" class="detail-gallery"><view v-for="(photo, index) in item.photos" :key="index" :class="['gallery-photo', { cover: index === item.coverIndex }]" @click="preview = photo"><image :src="photo" mode="aspectFill" /><text v-if="index === item.coverIndex">封面</text></view></view><text v-if="!item.notes && !item.photos.length" class="detail-hint">可以添加一段回忆，或留几张照片。</text><view class="detail-actions"><button @click="togglePin">{{ item.pinned ? '取消置顶' : '置顶纪念日' }}</button><button class="delete-button" @click="remove">删除纪念日</button></view></view>
      <view class="anniversary-history"><text class="history-heading">纪念记录</text><text v-if="!history.length" class="detail-hint">在“规划”月历中记录每一次纪念，回忆会留在这里。</text><view v-for="record in history" :key="record.date" class="history-row" @click="activeRecord = anniversaryRecordOccurrence(record, item.notes)"><view><text>{{ record.date }} · {{ record.title }}</text><text>{{ record.notes || '未填写本次备注' }}</text></view><text>{{ record.confirmedAt ? '✓ 已纪念' : '已备注' }}</text></view></view>
    </view>
    <AnniversaryEditSheet ref="editor" :visible="editing" :item="item" @close="editing = false" @saved="saved" />
    <AnniversaryRecordSheet ref="recordSheet" :occurrence="activeRecord" :today="today" @close="activeRecord = null" @saved="refresh" />
    <view v-if="preview" class="photo-preview" @click="preview = ''"><image :src="preview" mode="aspectFit" /><button aria-label="关闭照片预览" @click="preview = ''">×</button></view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow, onHide, onUnload, onBackPress } from '@dcloudio/uni-app'
import AnniversaryEditSheet from '../../components/AnniversaryEditSheet.vue'
import AnniversaryRecordSheet from '../../components/AnniversaryRecordSheet.vue'
import { anniversaryRecordOccurrence } from '../../../../shared/anniversary.mjs'
import { getAnniversary, removeAnniversary, pinAnniversary, listAnniversaryRecords } from '../../api/store'
import { anniversaryState, anniversaryCalendar, anniversaryTypes, localToday } from '../../utils/anniversary'
import { confirm, toast } from '../../utils/platform'

const item = ref(null)
const history = ref([])
const activeRecord = ref(null)
const recordSheet = ref(null)
const editing = ref(false)
const editor = ref(null)
const preview = ref('')
const error = ref('')
const today = ref(localToday())
const typeMeta = Object.fromEntries(anniversaryTypes.map(item => [item.value, item]))
const state = computed(() => item.value ? anniversaryState(item.value, today.value) : null)
const calendar = computed(() => state.value ? anniversaryCalendar(state.value.nextDate) : null)
const originalCalendar = computed(() => item.value ? anniversaryCalendar(item.value.date) : null)
let id = ''
let timer
let removing = false
function back() { if (getCurrentPages().length > 1) uni.navigateBack(); else uni.redirectTo({ url: '/pages/anniversaries/index' }) }
function refresh() { error.value = ''; today.value = localToday(); try { item.value = getAnniversary(id); history.value = listAnniversaryRecords({ anniversaryId: id }) } catch (cause) { item.value = null; history.value = []; error.value = cause.message || String(cause) } }
function scheduleDay() { clearTimeout(timer); const date = new Date(); date.setHours(24, 0, 0, 0); timer = setTimeout(() => { refresh(); scheduleDay() }, date.getTime() - Date.now() + 100) }
function saved() { editing.value = false; refresh() }
function togglePin() { if (!item.value) return; try { pinAnniversary(id, !item.value.pinned); refresh() } catch (cause) { error.value = cause.message || String(cause) } }
async function remove() {
  if (!item.value || removing) return
  removing = true
  try { if (!(await confirm(`确定删除“${item.value.title}”、照片及全部纪念记录吗？`))) return; removeAnniversary(id); toast('已删除'); back() }
  catch (cause) { error.value = cause.message || String(cause) }
  finally { removing = false }
}
onLoad(query => { id = query.id || '' })
onShow(() => { refresh(); scheduleDay() })
onHide(() => clearTimeout(timer))
onUnload(() => clearTimeout(timer))
onBackPress(() => { if (activeRecord.value) { recordSheet.value?.close(); return true } if (preview.value) { preview.value = ''; return true } if (editing.value) { editor.value?.close(); return true } return false })
</script>

<style scoped>
.anniversary-history { padding: 0 36rpx 36rpx; }.history-heading { display: block; color: #61758e; font-size: 30rpx; margin-bottom: 20rpx; }.history-row { display: flex; gap: 20rpx; align-items: center; padding: 26rpx 0; border-bottom: 2rpx solid #edf0f4; color: #71859c; font-size: 26rpx; }.history-row > view { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14rpx; }.history-row > view > text:first-child { overflow-wrap: anywhere; }.history-row > view > text:last-child { color: #96a1ae; font-size: 24rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.history-row > text { color: #96a1ae; flex-shrink: 0; font-size: 23rpx; }
.anniversary-detail-page { background: #fff; padding-bottom: env(safe-area-inset-bottom); }.back-button, .edit-button { background: transparent; color: #788695; margin: 0; padding: 0; width: 80rpx; line-height: 72rpx; font-size: 26rpx; }.back-button { font-size: 48rpx; }.back-button::after, .edit-button::after { border: 0; }.anniversary-hero { padding: 64rpx 36rpx 50rpx; text-align: center; position: relative; overflow: hidden; }.anniversary-hero::before { content: ''; position: absolute; width: 400rpx; height: 400rpx; border: 2rpx solid currentColor; opacity: .08; border-radius: 50%; top: -200rpx; right: -120rpx; }.theme-sky { background: linear-gradient(140deg, #e6f0fc, #d4e8f0); color: #395b7e; }.theme-warm { background: linear-gradient(140deg, #fff0df, #f7dee3); color: #8c5b58; }.theme-night { background: linear-gradient(140deg, #273951, #192636); color: #e1eaf6; }.hero-label { font-size: 26rpx; opacity: .8; }.hero-number { font-size: 136rpx; line-height: 1.45; font-variant-numeric: tabular-nums; }.hero-number > text { font-size: 28rpx; margin-left: 16rpx; }.hero-elapsed { display: block; font-size: 28rpx; }.hero-title { display: block; font-size: 40rpx; font-weight: 600; margin: 36rpx 0 18rpx; overflow-wrap: anywhere; }.hero-date { font-size: 24rpx; opacity: .8; }.detail-body { padding: 40rpx 36rpx; }.detail-next { display: flex; flex-direction: column; gap: 16rpx; }.detail-label { font-size: 25rpx; color: #97a2b1; }.next-date { color: #526379; font-size: 32rpx; }.detail-hint { display: block; font-size: 24rpx; color: #9fa9b7; margin: 24rpx 0; line-height: 1.8; }.birthday-info { display: flex; padding: 42rpx 0; gap: 16rpx; border-bottom: 2rpx solid #f1f3f6; }.birthday-info > view { flex: 1; display: flex; flex-direction: column; gap: 12rpx; }.birthday-value { font-size: 34rpx; color: #53657a; }.birthday-caption { font-size: 22rpx; color: #a0aab7; }.detail-notes { display: block; white-space: pre-wrap; overflow-wrap: anywhere; margin: 36rpx 0; font-size: 29rpx; line-height: 1.9; color: #798697; }.detail-gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16rpx; margin-top: 32rpx; }.gallery-photo { position: relative; height: 260rpx; overflow: hidden; border-radius: 18rpx; }.gallery-photo.cover { grid-column: 1 / -1; grid-row: 1; height: 400rpx; }.gallery-photo image { width: 100%; height: 100%; }.gallery-photo > text { position: absolute; bottom: 16rpx; left: 16rpx; font-size: 21rpx; color: #fff; background: #0007; padding: 6rpx 14rpx; border-radius: 8rpx; }.detail-actions { display: flex; gap: 20rpx; margin-top: 56rpx; }.detail-actions button { flex: 1; background: #f3f7fc; color: #7194b7; font-size: 25rpx; line-height: 82rpx; margin: 0; }.detail-actions button::after { border: 0; }.detail-actions .delete-button { color: #db7880; background: #fff5f6; }.detail-error { margin: 30rpx; color: #d66a75; font-size: 25rpx; }.photo-preview { position: fixed; inset: 0; background: #10151aef; z-index: 2000; display: flex; align-items: center; justify-content: center; }.photo-preview image { width: 92vw; height: 85vh; }.photo-preview button { position: absolute; top: calc(24rpx + env(safe-area-inset-top)); right: 24rpx; background: #ffffff25; color: #fff; font-size: 44rpx; width: 72rpx; line-height: 72rpx; padding: 0; }
</style>
