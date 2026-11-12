<template>
  <view class="adjust-page">
    <view class="adjust-topbar">
      <button class="back-button" aria-label="返回" :disabled="navigating" @click="requestClose">‹</button>
      <text class="topbar-title">调整事项</text>
      <view class="topbar-spacer" />
    </view>
    <QuickAdjustSheet v-if="task" ref="adjustSheet" :visible="true" :task="task" :categories="categories" @close="leavePage" />
    <view v-else class="load-state">
      <text v-if="loadError" class="load-error" role="alert">{{ loadError }}</text>
      <text v-else>正在读取事项…</text>
      <button v-if="loadError" class="return-button" :disabled="navigating" @click="requestClose">返回</button>
    </view>
    <text v-if="navigationError && !task" class="navigation-error" role="alert">{{ navigationError }}</text>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onBackPress, onLoad, onUnload } from '@dcloudio/uni-app'
import QuickAdjustSheet from '../../components/QuickAdjustSheet.vue'
import { findTask, getCategories } from '../../api/store'

const task = ref(null)
const categories = ref([])
const adjustSheet = ref(null)
const loadError = ref('')
const navigationError = ref('')
const navigating = ref(false)
let active = true

onLoad(query => {
  try {
    // uni-app 已解码查询参数，不能对包含百分号的事项 ID 再次解码。
    const id = query?.id
    if (typeof id !== 'string' || !id.trim()) throw new Error('缺少事项 ID，无法打开快捷调整')
    const latest = findTask(id)
    if (!latest) throw new Error('事项不存在或已删除，无法打开快捷调整')
    const latestCategories = getCategories()
    categories.value = latestCategories
    task.value = latest
  } catch (cause) {
    loadError.value = `读取失败：${cause?.message || String(cause)}`
  }
})
onUnload(() => { active = false })
onBackPress(event => {
  if (event?.from === 'navigateBack' && navigating.value) return false
  requestClose()
  return true
})

function requestClose() {
  if (navigating.value) return
  if (task.value) {
    adjustSheet.value?.requestClose()
  } else {
    leavePage()
  }
}

function leavePage() {
  if (navigating.value || !active) return
  navigating.value = true
  navigationError.value = ''
  const fail = () => {
    if (!active) return
    navigating.value = false
    navigationError.value = '返回失败，请重试；当前草稿仍保留。'
    adjustSheet.value?.resumeAfterCloseFailure(navigationError.value)
  }
  try {
    if (getCurrentPages().length > 1) uni.navigateBack({ fail })
    else uni.switchTab({ url: '/pages/tasks/index', fail })
  } catch {
    fail()
  }
}
</script>

<style scoped>
.adjust-page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; padding-top: var(--top-safe-area); background: var(--panel); }
.adjust-topbar { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; min-height: 96rpx; padding: 0 24rpx; border-bottom: 2rpx solid var(--line); }
.back-button, .topbar-spacer { width: 72rpx; height: 72rpx; }
.back-button { margin: 0; padding: 0; background: transparent; color: #26282d; font-size: 56rpx; line-height: 68rpx; }
.back-button::after { border: 0; }
.topbar-title { color: #26282d; font-size: 32rpx; font-weight: 600; }
.load-state { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 24rpx; padding: 32rpx; color: var(--muted); font-size: 28rpx; }
.load-error, .navigation-error { color: var(--danger); font-size: 26rpx; line-height: 1.6; }
.return-button { margin: 0; padding: 0 48rpx; background: #eef4fa; color: #526b84; font-size: 28rpx; }
.navigation-error { padding: 12rpx 32rpx calc(12rpx + env(safe-area-inset-bottom)); }
</style>
