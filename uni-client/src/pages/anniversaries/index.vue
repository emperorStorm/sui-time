<template>
  <view class="page anniversary-page">
    <view class="topbar"><button class="back-button" aria-label="返回" @click="back">‹</button><view class="topbar-title">纪念日</view><button class="add-button" aria-label="新增纪念日" @click="editing = true">＋</button></view>
    <view class="anniversary-content shell"><view class="anniversary-search"><input v-model="search" placeholder="搜索纪念日或备注" /></view><scroll-view scroll-x class="anniversary-filters"><view class="filter-row"><button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部 · {{ items.length }}</button><button v-for="type in anniversaryTypes" :key="type.value" :class="{ active: filter === type.value }" @click="filter = type.value">{{ type.label }}</button></view></scroll-view>
      <view v-if="error" class="anniversary-error" @click="refresh">{{ error }} · 点击重试</view>
      <view class="anniversary-list panel"><view v-for="item in visibleItems" :key="item.id" class="anniversary-row" @click="openDetail(item.id)"><text :class="['anniversary-mark', `kind-${item.kind}`]">{{ typeMeta[item.kind].mark }}</text><view class="row-copy"><text class="row-name">{{ item.title }}<text v-if="item.pinned" class="pin-mark"> · 置顶</text></text><text class="row-date">{{ item.state.nextDate }} · {{ typeMeta[item.kind].label }}<text v-if="item.kind === 'birthday'"> · {{ item.state.nextAge }}岁</text></text></view><view class="row-count"><text class="row-label">{{ item.state.label }}</text><text v-if="item.state.days" class="row-number">{{ item.state.days }}<text>天</text></text></view></view><view v-if="!visibleItems.length" class="anniversary-empty"><text class="empty-heart">♡</text><text>{{ items.length ? '没有符合条件的纪念日' : '记录一个值得记住的日子' }}</text><button v-if="!items.length" @click="editing = true">添加第一条纪念日</button></view></view>
    </view>
    <AnniversaryEditSheet ref="editor" :visible="editing" @close="editing = false" @saved="saved" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onHide, onUnload, onBackPress } from '@dcloudio/uni-app'
import AnniversaryEditSheet from '../../components/AnniversaryEditSheet.vue'
import { listAnniversaries } from '../../api/store'
import { anniversaryTypes, localToday, orderedAnniversaries } from '../../utils/anniversary'
import { nav } from '../../utils/platform'

const items = ref([])
const search = ref('')
const filter = ref('all')
const editing = ref(false)
const editor = ref(null)
const error = ref('')
const today = ref(localToday())
const typeMeta = Object.fromEntries(anniversaryTypes.map(item => [item.value, item]))
let timer
function back() { if (getCurrentPages().length > 1) uni.navigateBack(); else uni.switchTab({ url: '/pages/profile/index' }) }
const orderedItems = computed(() => orderedAnniversaries(items.value, today.value))
const visibleItems = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return orderedItems.value.filter(item => (filter.value === 'all' || filter.value === item.kind) && `${item.title} ${item.notes}`.toLowerCase().includes(keyword))
})
function refresh() { error.value = ''; today.value = localToday(); try { items.value = listAnniversaries() } catch (cause) { error.value = cause.message || String(cause) } }
function scheduleDay() { clearTimeout(timer); const date = new Date(); date.setHours(24, 0, 0, 0); timer = setTimeout(() => { refresh(); scheduleDay() }, date.getTime() - Date.now() + 100) }
function openDetail(id) { nav(`/pages/anniversaries/detail?id=${encodeURIComponent(id)}`) }
function saved(item) { editing.value = false; search.value = ''; filter.value = 'all'; refresh(); openDetail(item.id) }
onShow(() => { refresh(); scheduleDay() })
onHide(() => clearTimeout(timer))
onUnload(() => clearTimeout(timer))
onBackPress(() => { if (!editing.value) return false; editor.value?.close(); return true })
</script>

<style scoped>
.anniversary-page { padding-bottom: env(safe-area-inset-bottom); }.back-button, .add-button { background: transparent; color: #6e7b8b; font-size: 48rpx; padding: 0; width: 72rpx; line-height: 72rpx; margin: 0; }.back-button::after, .add-button::after { border: 0; }.anniversary-content { box-sizing: border-box; padding: 28rpx; }.anniversary-search { background: #fff; padding: 22rpx 28rpx; border-radius: 18rpx; }.anniversary-search input { font-size: 27rpx; height: 46rpx; }.anniversary-filters { margin: 24rpx 0; }.filter-row { display: flex; gap: 10rpx; white-space: nowrap; }.filter-row button { flex: 0 0 auto; padding: 0 22rpx; line-height: 64rpx; font-size: 24rpx; background: transparent; margin: 0; color: #8a96a5; border-radius: 14rpx; }.filter-row button::after { border: 0; }.filter-row .active { background: #e1efff; color: #298be8; }.anniversary-list { overflow: hidden; }.anniversary-row { display: flex; align-items: center; padding: 32rpx 24rpx; gap: 20rpx; border-bottom: 2rpx solid #f0f2f5; }.anniversary-row:last-child { border-bottom: 0; }.anniversary-mark { flex: 0 0 70rpx; line-height: 70rpx; text-align: center; border-radius: 20rpx; font-size: 44rpx; color: #4d82d5; background: #eaf1fc; }.kind-anniversary { color: #db7086; background: #fceef1; }.kind-birthday { color: #e68a42; background: #fff1e5; }.kind-holiday { color: #45a790; background: #e9f7f2; }.row-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14rpx; }.row-name { font-size: 29rpx; line-height: 1.5; overflow-wrap: anywhere; }.pin-mark { color: #79a5d3; font-size: 20rpx; }.row-date { font-size: 21rpx; color: #9aa4b0; line-height: 1.6; }.row-count { text-align: right; display: flex; flex-direction: column; gap: 6rpx; white-space: nowrap; }.row-label { font-size: 22rpx; color: #a0a9b5; }.row-number { color: #546980; font-size: 46rpx; font-variant-numeric: tabular-nums; }.row-number > text { font-size: 20rpx; margin-left: 6rpx; }.anniversary-empty { padding: 100rpx 28rpx; color: #9aa7b7; text-align: center; display: flex; flex-direction: column; gap: 24rpx; font-size: 28rpx; }.empty-heart { font-size: 92rpx; color: #bad2ec; }.anniversary-empty button { background: #2996f6; color: #fff; font-size: 25rpx; margin-top: 16rpx; }.anniversary-error { color: #dd656f; font-size: 25rpx; padding: 20rpx 0; }
</style>
