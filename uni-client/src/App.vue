<template>
  <slot />
</template>

<script setup>
import { onBeforeUnmount } from 'vue'
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
import { listTasks } from './api/store'
import { syncTaskReminders } from './api/reminders'
import { resumeUpdateInstallation } from './api/update'
import { startAutoSync, syncNow } from './api/sync.js'
let stopAutoSync = null
function refreshSyncedPages() {
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  // 页面原有 onShow 负责从 store 重读，避免重建页面和丢失编辑草稿。
  current?.$vm?.$callHook?.('onShow')
  uni.$emit('store-refresh')
  void refreshReminders()
}
function enableAutoSync() {
  if (!stopAutoSync) stopAutoSync = startAutoSync(refreshSyncedPages)
}
function disableAutoSync() { stopAutoSync?.(); stopAutoSync = null }
onHide(disableAutoSync)
onBeforeUnmount(disableAutoSync)
let reminderSyncing = false
let reminderErrorVisible = false
async function refreshReminders() {
  if (reminderSyncing || reminderErrorVisible) return
  reminderSyncing = true
  let operation = '读取本机事项'
  try {
    const tasks = listTasks()
    operation = '更新系统提醒'
    const result = await syncTaskReminders(tasks)
    uni.$emit('reminder-permissions')
    if (result?.error) throw new Error(result.error)
  } catch (error) {
    reminderErrorVisible = true
    uni.showModal({
      title: `${operation}失败`,
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
onLaunch(() => { enableAutoSync(); void refreshReminders() })
onShow(() => { enableAutoSync(); void syncNow().catch(() => {}); void refreshReminders(); resumeUpdateInstallation() })
</script>

<style>
page,
body {
  --ink: #25384c;
  --muted: #61758a;
  --line: #e5edf5;
  --canvas: #f4f7fb;
  --panel: #ffffff;
  --blue: #176ab7;
  --blue-soft: #e8f3ff;
  --green: #16835a;
  --orange: #dd7035;
  --danger: #b94550;
  --radius: 24rpx;
  --shadow: 0 8rpx 28rpx rgba(43, 70, 98, 0.06);
  --top-safe-area: var(--status-bar-height, env(safe-area-inset-top, 0px));
  /* #ifdef H5 */
  --top-safe-area: env(safe-area-inset-top, 0px);
  /* #endif */
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
  flex: 0 0 auto;
  box-sizing: content-box;
  height: 104rpx;
  padding: var(--top-safe-area) 20rpx 0;
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
  background: #e8f2fc;
}

.placeholder-page { display: flex; flex-direction: column; }
.placeholder-body { flex: 1; display: flex; align-items: center; justify-content: center; padding: 48rpx 40rpx 80rpx; }
.placeholder-card { box-sizing: border-box; width: 100%; max-width: 620rpx; padding: 64rpx 40rpx; border: 2rpx solid var(--line); border-radius: 28rpx; background: var(--panel); box-shadow: var(--shadow); text-align: center; }
.placeholder-icon { display: flex; align-items: center; justify-content: center; width: 112rpx; height: 112rpx; margin: 0 auto 28rpx; border-radius: 32rpx; background: var(--blue-soft); }
.placeholder-icon image { width: 56rpx; height: 56rpx; }
.placeholder-badge { display: inline-block; padding: 8rpx 20rpx; border-radius: 999rpx; background: #eff6fd; color: var(--blue); font-size: 22rpx; font-weight: 600; }
.placeholder-title { display: block; margin-top: 20rpx; color: var(--ink); font-size: 32rpx; font-weight: 600; }
.placeholder-description { display: block; margin-top: 16rpx; color: var(--muted); font-size: 26rpx; line-height: 1.7; overflow-wrap: anywhere; }

@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active, .sheet-leave-active, .page-enter-active, .page-leave-active,
  .sheet, .sheet-enter-active .sheet, .sheet-leave-active .sheet,
  .sheet-enter-active .adjust-sheet, .sheet-leave-active .adjust-sheet { transition-duration: 0.01ms !important; }
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
