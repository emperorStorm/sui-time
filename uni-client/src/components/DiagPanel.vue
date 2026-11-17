<template>
  <view v-if="diagEnabled" class="diag-root">
    <view v-if="!diag.open" class="diag-fab" @click="diag.open = true">诊断</view>
    <view v-else class="diag-panel">
      <view class="diag-head">
        <text>诊断信息</text>
        <view class="diag-actions">
          <button size="mini" @click="copy">复制</button>
          <button size="mini" @click="clear">清空</button>
          <button size="mini" @click="diag.open = false">收起</button>
        </view>
      </view>
      <scroll-view scroll-y class="diag-body">
        <text class="diag-line">版本：{{ diag.version }}</text>
        <text class="diag-line">内核：Chromium {{ diag.engine }}</text>
        <text class="diag-line">UA：{{ diag.ua }}</text>
        <text class="diag-title">JS 错误（{{ diag.errors.length }}）</text>
        <text v-for="(line, index) in diag.errors" :key="'e' + index" class="diag-line diag-error">{{ line }}</text>
        <text class="diag-title">事件记录（{{ diag.events.length }}）</text>
        <text v-for="(line, index) in diag.events" :key="'v' + index" class="diag-line">{{ line }}</text>
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
import { onMounted } from 'vue'
import { diag, diagEnabled, installDiagnostics } from '../utils/diagnostics.js'

onMounted(installDiagnostics)

function copy() {
  const text = [`版本：${diag.version}`, `内核：Chromium ${diag.engine}`, `UA：${diag.ua}`, '', 'JS 错误：', ...diag.errors, '', '事件记录：', ...diag.events].join('\n')
  uni.setClipboardData({ data: text, success: () => uni.showToast({ title: '已复制诊断信息', icon: 'none' }) })
}

function clear() {
  diag.errors.splice(0)
  diag.events.splice(0)
}
</script>

<style scoped>
.diag-root { position: fixed; inset: auto 0 0 0; z-index: 99999; pointer-events: none; }
.diag-fab { position: fixed; left: 50%; top: 118rpx; transform: translateX(-50%); padding: 8rpx 18rpx; border-radius: 24rpx; background: #1f3a5f; color: #fff; font-size: 22rpx; opacity: .82; pointer-events: auto; }
.diag-panel { position: fixed; left: 0; right: 0; bottom: 0; max-height: 68vh; display: flex; flex-direction: column; background: #101820ee; color: #d8e6f5; pointer-events: auto; }
.diag-head { display: flex; align-items: center; justify-content: space-between; padding: 12rpx 20rpx; border-bottom: 1rpx solid #33475c; font-size: 26rpx; }
.diag-actions { display: flex; gap: 10rpx; }
.diag-actions button { margin: 0; font-size: 22rpx; color: #d8e6f5; background: #22364b; }
.diag-body { flex: 1; min-height: 0; padding: 12rpx 20rpx 40rpx; }
.diag-line { display: block; font-size: 21rpx; line-height: 1.5; word-break: break-all; padding: 2rpx 0; }
.diag-error { color: #ff9c9c; }
.diag-title { display: block; margin-top: 14rpx; font-size: 23rpx; color: #7fc4ff; }
</style>
