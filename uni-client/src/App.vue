<template>
  <slot />
</template>

<script setup>
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { listTasks } from './api/store'
import { syncTaskReminders } from './api/reminders'
import { resumeUpdateInstallation } from './api/update'
let reminderSyncing = false
let reminderErrorVisible = false
async function refreshReminders() {
  if (reminderSyncing || reminderErrorVisible) return
  reminderSyncing = true
  try {
    await syncTaskReminders(listTasks())
    uni.$emit('reminder-permissions')
  } catch (error) {
    reminderErrorVisible = true
    uni.showModal({
      title: '本机事项同步失败',
      content: `${error.message || String(error)}。现有数据已保留，可重试读取并同步提醒。`,
      confirmText: '重试',
      cancelText: '稍后',
      success: result => {
        reminderErrorVisible = false
        if (result.confirm) void refreshReminders()
      },
      fail: () => {
        reminderErrorVisible = false
        uni.showToast({ title: '本机数据读取失败，请返回应用重试', icon: 'none' })
      }
    })
  } finally { reminderSyncing = false }
}
onLaunch(() => { void refreshReminders() })
onShow(() => { void refreshReminders(); resumeUpdateInstallation() })
</script>

<style>
page,
body {
  --ink: #26282d;
  --muted: #969ba5;
  --line: #f0f1f4;
  --canvas: #f5f6f8;
  --panel: #ffffff;
  --blue: #2996f6;
  --blue-soft: #dceeff;
  --green: #10bf75;
  --orange: #ff8445;
  --danger: #f06368;
  --radius: 28rpx;
  --shadow: 0 8rpx 28rpx rgba(30, 44, 61, 0.07);
}

page {
  min-height: 100%;
  background: var(--canvas);
  color: var(--ink);
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 30rpx;
}

.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding-bottom: calc(180rpx + env(safe-area-inset-bottom));
  background: var(--canvas);
}

.shell {
  width: 100%;
  max-width: 900rpx;
  margin: 0 auto;
}

.panel {
  background: var(--panel);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.muted {
  color: var(--muted);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 104rpx;
  padding: 0 20rpx calc(8rpx + env(safe-area-inset-top));
  background: var(--panel);
  border-bottom: 2rpx solid var(--line);
}

.topbar .topbar-title {
  font-size: 34rpx;
  font-weight: 600;
}

.topbar .topbar-action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  color: #5c6167;
  font-size: 36rpx;
}

.topbar .topbar-action:active {
  background: #eef2f6;
}

/* 存储读取失败时阻断业务入口，重试成功后才恢复内容。 */
.storage-error { margin: 32rpx 28rpx; padding: 40rpx 32rpx; color: var(--ink); text-align: center; }
.storage-error > text { display: block; }
.storage-error-detail { margin-top: 20rpx; color: var(--muted); font-size: 26rpx; line-height: 1.7; overflow-wrap: anywhere; }
.storage-error button { margin-top: 28rpx; background: var(--blue-soft); color: #287fc1; font-size: 28rpx; }

/* H5 下 uni-modal 需高于底部弹层（sheet-layer z-index 1000）与原生 tabBar */
.uni-picker-container {
  z-index: 2100 !important;
}

uni-modal,
.uni-modal,
uni-modal .uni-modal__mask,
uni-modal .uni-modal__content {
  z-index: 2000 !important;
}
</style>
