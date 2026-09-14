<template>
  <view class="page profile-page">
    <view class="topbar">
      <view class="topbar-title">我的</view>
      <view class="topbar-action spacer" />
    </view>

    <view class="profile-scroll">
      <view class="shell">
        <view class="mine-card panel">
          <view class="avatar-mark"><text>时</text></view>
          <view class="mine-info">
            <text class="mine-name">{{ profile.name }}</text>
            <text class="mine-phone">{{ profile.phone }} · 本地时光记录者</text>
          </view>
        </view>

        <view class="mine-section panel">
          <view class="mine-row" @click="openUpdate">
            <view>
              <text class="row-title">检查更新</text>
              <text class="row-hint">当前版本 v{{ APP_VERSION }}</text>
            </view>
            <text class="row-chevron">›</text>
          </view>
          <view class="mine-row">
            <view>
              <text class="row-title">隐藏已完成</text>
              <text class="row-hint">列表与日历中隐藏已结束事项</text>
            </view>
            <switch :checked="settings.hideCompleted" color="#2996f6" @change="toggleHideCompleted" />
          </view>
        </view>

        <view class="mine-section panel">
          <view class="mine-row" @click="restore">
            <view>
              <text class="row-title">恢复演示数据</text>
              <text class="row-hint">清除本机的本地数据</text>
            </view>
            <text class="row-chevron">›</text>
          </view>
          <view class="mine-row">
            <view>
              <text class="row-title">关于岁岁时光</text>
              <text class="row-hint">本地优先 · 数据仅存本机</text>
            </view>
            <text class="row-value">v{{ APP_VERSION }}</text>
          </view>
        </view>
      </view>
    </view>

    <UpdateSheet :visible="updateVisible" :status="updateStatus" :latest-version="updateVersion" :notes="updateNotes" @close="closeUpdate" @download="download" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import UpdateSheet from '../../components/UpdateSheet.vue'
import { getProfile, getSettings, setSetting, restoreDemoData } from '../../api/store'
import { checkUpdate, downloadUpdate, APP_VERSION } from '../../api/update'
import { toast } from '../../utils/platform'

const profile = ref(getProfile())
const settings = ref(getSettings())
const updateVisible = ref(false)
const updateStatus = ref('latest')
const updateVersion = ref('')
const updateNotes = ref('')
const updateUrl = ref('')

onShow(() => {
  profile.value = getProfile()
  settings.value = getSettings()
})

function toggleHideCompleted(event) {
  setSetting('hideCompleted', event.detail.value)
  settings.value = getSettings()
}

async function openUpdate() {
  const result = await checkUpdate()
  updateStatus.value = result.status
  updateVersion.value = result.latestVersion || ''
  updateNotes.value = result.notes || ''
  updateUrl.value = result.downloadUrl || ''
  updateVisible.value = true
}

function closeUpdate() {
  updateVisible.value = false
}

function download() {
  if (updateStatus.value === 'found' && updateUrl.value) {
    downloadUpdate(updateUrl.value)
  }
  updateStatus.value = 'downloading'
}

function restore() {
  uni.showModal({
    title: '恢复演示数据',
    content: '确定清除本机数据并恢复演示数据吗？',
    success: (res) => {
      if (!res.confirm) return
      restoreDemoData()
      profile.value = getProfile()
      settings.value = getSettings()
      toast('已恢复')
    }
  })
}
</script>

<style scoped>
.profile-page {
  display: flex;
  flex-direction: column;
}

.topbar-action.spacer {
  opacity: 0;
}

.profile-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24rpx 28rpx 40rpx;
}

.mine-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 32rpx;
  margin-bottom: 24rpx;
}

.avatar-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112rpx;
  height: 112rpx;
  flex: 0 0 112rpx;
  border: 6rpx solid #e5f4ff;
  border-radius: 50%;
  background: #e6f4e3;
  color: #597257;
  font-size: 40rpx;
  font-weight: 800;
}

.mine-info {
  flex: 1;
  min-width: 0;
}

.mine-name {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
}

.mine-phone {
  display: block;
  margin-top: 8rpx;
  color: var(--muted);
  font-size: 24rpx;
}

.mine-section {
  margin-bottom: 24rpx;
  overflow: hidden;
}

.mine-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 28rpx 32rpx;
}

.mine-row + .mine-row {
  border-top: 2rpx solid var(--line);
}

.mine-row:active {
  background: #f4f8fd;
}

.row-title {
  display: block;
  color: #404348;
  font-size: 30rpx;
}

.row-hint {
  display: block;
  margin-top: 4rpx;
  color: #9ba1a9;
  font-size: 24rpx;
}

.row-chevron {
  color: #c4c9cf;
  font-size: 36rpx;
}

.row-value {
  color: var(--muted);
  font-size: 26rpx;
}
</style>
