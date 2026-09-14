<template>
  <view v-if="visible" class="sheet-layer" @click="close">
    <view class="sheet update-sheet" @click.stop>
      <view v-if="status === 'found'" class="update-body">
        <view class="update-icon">⇪</view>
        <text class="update-title">发现新版本 v{{ latestVersion }}</text>
        <text class="update-desc">当前版本 v{{ currentVersion }}</text>
        <view class="update-notes">
          <text v-if="notes">{{ notes }}</text>
          <text v-else>修复已知问题，优化使用体验。</text>
        </view>
        <view class="primary-button" @click="download">下载更新</view>
        <view class="ghost-button" @click="close">暂不更新</view>
      </view>
      <view v-else-if="status === 'downloading'" class="update-body">
        <view class="update-icon">⇩</view>
        <text class="update-title">下载新版本</text>
        <text class="update-desc">已在浏览器打开下载页，下载完成后点击安装即可。</text>
        <view class="primary-button" @click="close">完成</view>
      </view>
      <view v-else class="update-body">
        <view class="update-icon check">✓</view>
        <text class="update-title">当前已是最新版本</text>
        <text class="update-desc">岁岁时光 v{{ currentVersion }}</text>
        <view class="primary-button" @click="close">完成</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { APP_VERSION } from '../api/update'

defineProps({
  visible: { type: Boolean, default: false },
  status: { type: String, default: 'latest' },
  latestVersion: { type: String, default: '' },
  notes: { type: String, default: '' }
})

const emit = defineEmits(['close', 'download'])
const currentVersion = APP_VERSION

function close() {
  emit('close')
}

function download() {
  emit('download')
}
</script>

<style scoped>
.sheet-layer {
  position: fixed;
  z-index: 200;
  inset: 0;
  display: flex;
  align-items: flex-end;
  background: rgba(30, 44, 61, 0.45);
}

.sheet {
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  border-radius: 32rpx 32rpx 0 0;
  background: var(--panel);
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
}

.update-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56rpx 48rpx 32rpx;
}

.update-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 128rpx;
  height: 128rpx;
  margin-bottom: 28rpx;
  border-radius: 36rpx;
  background: var(--blue);
  color: #fff;
  font-size: 60rpx;
}

.update-icon.check {
  background: var(--green);
}

.update-title {
  font-size: 34rpx;
  font-weight: 600;
}

.update-desc {
  margin-top: 12rpx;
  color: var(--muted);
  font-size: 26rpx;
  text-align: center;
}

.update-notes {
  width: 100%;
  margin: 28rpx 0;
  padding: 24rpx 28rpx;
  border-radius: 20rpx;
  background: var(--canvas);
  color: #5c6470;
  font-size: 26rpx;
  line-height: 1.8;
  white-space: pre-line;
}

.primary-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 88rpx;
  border-radius: 999rpx;
  background: var(--blue);
  color: #fff;
  font-size: 30rpx;
}

.ghost-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 80rpx;
  margin-top: 16rpx;
  color: #646970;
  font-size: 28rpx;
}
</style>
