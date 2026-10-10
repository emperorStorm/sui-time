<template>
  <view v-if="visible" class="update-mask" @click="close"><view class="update-sheet" @click.stop>
    <view class="update-symbol">{{ state.status === 'latest' ? '✓' : '⇪' }}</view>
    <text class="update-title">{{ title }}</text>
    <text class="update-desc">当前版本 v{{ state.currentVersion }}</text>
    <scroll-view v-if="state.status === 'found'" class="update-notes" scroll-y><text>{{ state.notes }}</text></scroll-view>
    <template v-if="state.status === 'downloading'"><view class="progress-track"><view :style="{ width: `${state.progress}%` }" /></view><text class="update-desc">{{ state.totalBytes ? `${state.progress}% · ${mb(state.downloadedBytes)} / ${mb(state.totalBytes)} MB` : '正在连接下载服务…' }}</text><button class="secondary" @click="emit('cancel')">取消下载</button></template>
    <text v-if="state.message" class="update-message">{{ state.message }}</text>
    <button v-if="['found', 'download-error'].includes(state.status)" class="primary" @click="emit('download')">{{ state.status === 'download-error' ? '重试下载' : '立即更新' }}</button>
    <button v-if="['ready', 'waiting'].includes(state.status)" class="primary" @click="emit('install')">重新安装</button>
    <button v-if="state.status === 'error'" class="primary" @click="emit('check')">重新检查</button>
    <button v-if="['download-error', 'ready', 'waiting'].includes(state.status) && state.downloadUrl" class="secondary" @click="emit('browser')">使用浏览器下载</button>
    <button v-if="!['downloading', 'installing'].includes(state.status)" class="secondary" @click="close">{{ state.status === 'found' ? '暂不更新' : '关闭' }}</button>
  </view></view>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({ visible: Boolean, state: { type: Object, required: true } })
const emit = defineEmits(['close', 'download', 'cancel', 'install', 'check', 'browser'])
const title = computed(() => ({ checking: '正在检查更新', latest: '当前已是最新版本', found: `发现新版本 v${props.state.latestVersion}`, downloading: '正在下载更新', 'download-error': '下载未完成', error: '更新检查失败', ready: '安装包已准备好', installing: '正在唤起安装', waiting: '等待系统安装确认' })[props.state.status] || '应用更新')
function close() { if (!['downloading', 'installing'].includes(props.state.status)) emit('close') }
function mb(bytes) { return ((bytes || 0) / 1048576).toFixed(1) }
</script>
<style scoped>
.update-mask { position: fixed; inset: 0; z-index: 2000; background: #1e2c3d73; display: flex; align-items: flex-end; }
.update-sheet { width: 100%; max-height: 88vh; overflow-y: auto; box-sizing: border-box; border-radius: 32rpx 32rpx 0 0; background: #fff; padding: 48rpx 40rpx calc(24rpx + env(safe-area-inset-bottom)); display: flex; align-items: center; flex-direction: column; }
.update-symbol { width: 112rpx; line-height: 112rpx; background: #e7f3ff; color: #2996f6; border-radius: 32rpx; text-align: center; font-size: 56rpx; margin-bottom: 24rpx; }
.update-title { font-size: 34rpx; font-weight: 600; }.update-desc { font-size: 25rpx; color: #929daa; margin-top: 14rpx; text-align: center; }
.update-notes { max-height: 28vh; margin: 28rpx 0; background: #f6f8fb; border-radius: 16rpx; box-sizing: border-box; padding: 24rpx; color: #6d7c8c; font-size: 26rpx; line-height: 1.8; white-space: pre-line; }
.update-message { font-size: 25rpx; color: #7a8797; line-height: 1.8; margin: 24rpx 0; overflow-wrap: anywhere; }
button { width: 100%; margin: 14rpx 0 0; border-radius: 24rpx; font-size: 28rpx; line-height: 88rpx; }button::after { border: 0; }.primary { color: white; background: #2996f6; }.secondary { background: transparent; color: #8795a5; }
.progress-track { width: 100%; height: 10rpx; border-radius: 8rpx; background: #e9f1fa; margin-top: 36rpx; overflow: hidden; }.progress-track > view { height: 100%; background: #2996f6; }
</style>
