<template>
  <TaskEditSheet v-if="ready" ref="editor" :task="task" :preset-date="presetDate" @close="navigateBack" @load-error="editorLoadFailed" />
  <view v-else class="load-page">
    <view class="load-header"><button aria-label="返回" @click="navigateBack">‹</button><text>事项编辑</text></view>
    <view class="load-error" role="alert"><text>{{ loadError || '正在读取事项…' }}</text><button v-if="loadError" @click="loadTask">重试读取</button></view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onBackPress, onLoad, onUnload } from '@dcloudio/uni-app'
import TaskEditSheet from '../../components/TaskEditSheet.vue'
import { findTask, getNewTaskDefaults } from '../../api/store'

const editor = ref(null)
const task = ref(null)
const presetDate = ref('')
const ready = ref(false)
const loadError = ref('')
let requestedId = null
let navigating = false
let unloaded = false

function loadTask() {
  loadError.value = ''
  try {
    if (requestedId !== null) {
      if (typeof requestedId !== 'string' || !requestedId) throw new Error('事项 ID 无效')
      const current = findTask(requestedId)
      if (!current) throw new Error('事项不存在或已被删除，未创建新事项')
      task.value = current
    } else getNewTaskDefaults()
    ready.value = true
  } catch (cause) {
    ready.value = false
    loadError.value = cause?.message || String(cause)
  }
}

function editorLoadFailed(message) {
  ready.value = false
  loadError.value = message
}

function navigateBack() {
  if (navigating || unloaded) return
  navigating = true
  const fail = cause => {
    if (unloaded) return
    navigating = false
    const message = `返回失败，请重试${cause?.errMsg ? `：${cause.errMsg}` : ''}`
    if (ready.value) editor.value?.navigationFailed(message)
    else loadError.value = message
  }
  try {
    if (getCurrentPages().length > 1) uni.navigateBack({ fail })
    else uni.switchTab({ url: '/pages/tasks/index', fail })
  } catch (cause) { fail(cause) }
}

onLoad(query => {
  // uni-app 已解码路由参数；不能二次解码包含百分号的完整 ID。
  requestedId = Object.hasOwn(query || {}, 'id') ? query.id : null
  presetDate.value = typeof query?.date === 'string' ? query.date : ''
  loadTask()
})
onBackPress(event => {
  if (navigating) return event?.from !== 'navigateBack'
  if (ready.value) void editor.value?.requestClose()
  else navigateBack()
  return true
})
onUnload(() => { unloaded = true })
</script>

<style scoped>
.load-page { box-sizing: border-box; min-height: 100vh; padding-top: max(var(--status-bar-height, 0px), env(safe-area-inset-top, 0px)); padding-bottom: env(safe-area-inset-bottom); background: #fbfdff; }
.load-header { display: flex; align-items: center; gap: 24rpx; min-height: 104rpx; padding: 0 24rpx; border-bottom: 2rpx solid #e7eef7; font-size: 32rpx; font-weight: 600; }
.load-header button { width: 60rpx; margin: 0; padding: 0; line-height: 60rpx; background: #eef5fc; color: #55728e; font-size: 40rpx; }
.load-header button::after, .load-error button::after { border: 0; }
.load-error { display: flex; flex-direction: column; align-items: flex-start; gap: 24rpx; padding: 40rpx 32rpx; color: #9f4245; font-size: 28rpx; overflow-wrap: anywhere; }
.load-error button { margin: 0; font-size: 26rpx; color: #277ac4; background: #eaf4ff; }
</style>
