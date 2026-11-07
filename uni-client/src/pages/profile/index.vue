<template>
  <view class="page profile-page">
    <view class="topbar">
      <view class="topbar-title">我的</view>
      <view class="topbar-action spacer" />
    </view>

    <view v-if="loadError" class="storage-error panel"><text>本机数据暂时无法读取</text><text class="storage-error-detail">{{ loadError }}</text><button @click="load">重试读取</button></view>
    <template v-else-if="ready">
    <view class="profile-scroll">
      <view class="shell">
        <view class="mine-card panel">
          <view class="avatar-mark"><text>时</text></view>
          <view class="mine-info">
            <text class="mine-name">{{ profile.name?.trim() || '时光记录者' }}</text>
            <text class="mine-phone">{{ profile.phone?.trim() ? `${profile.phone.trim()} · ` : '' }}本地时光记录者</text>
          </view>
        </view>

        <text class="mine-group-title">基础管理</text>
        <view class="mine-section panel">
          <button class="mine-row row-button" role="button" tabindex="0" @click="openAccount" @keydown.enter.prevent="openAccount" @keydown.space.prevent="openAccount"><view><text class="row-title">账号与同步</text><text class="row-hint">{{ syncAccountHint }}</text></view><text class="row-chevron">›</text></button>
          <button class="mine-row row-button" role="button" tabindex="0" @click="openAnniversaries" @keydown.enter.prevent="openAnniversaries" @keydown.space.prevent="openAnniversaries"><view><text class="row-title">纪念日</text><text class="row-hint">记住生日、周年与值得期待的日子</text></view><text class="row-chevron">›</text></button>
        </view>
        <view class="mine-section panel">
          <button class="mine-row row-button" role="button" tabindex="0" @click="openUpdate" @keydown.enter.prevent="openUpdate" @keydown.space.prevent="openUpdate">
            <view>
              <text class="row-title">检查更新</text>
              <text class="row-hint">当前版本 v{{ currentVersion }}</text>
            </view>
            <text class="row-chevron">›</text>
          </button>
          <view v-for="[view, label] in [['tasks', '事项列表'], ['month', '规划月历']]" :key="view" class="mine-row">
            <view>
              <text class="row-title">{{ label }}隐藏已结束</text>
              <text class="row-hint">隐藏已完成和已失败事项</text>
            </view>
            <switch :key="`${view}-${switchRevision}`" role="switch" tabindex="0" :aria-label="`${label}隐藏已结束`" :aria-checked="settings.hideCompletedByView[view]" :checked="settings.hideCompletedByView[view]" color="#2996f6" @change="toggleHideCompleted(view, $event)" @keydown.enter.prevent="toggleHideCompleted(view, { detail: { value: !settings.hideCompletedByView[view] } })" @keydown.space.prevent="toggleHideCompleted(view, { detail: { value: !settings.hideCompletedByView[view] } })" />
          </view>
        </view>

        <view class="mine-section panel">
          <button class="mine-row row-button" role="button" tabindex="0" @click="restore" @keydown.enter.prevent="restore" @keydown.space.prevent="restore">
            <view>
              <text class="row-title">恢复演示数据</text>
              <text class="row-hint">替换本机数据，绑定账号时可能同步删除</text>
            </view>
            <text class="row-chevron">›</text>
          </button>
          <view class="mine-row">
            <view>
              <text class="row-title">关于岁岁时光</text>
              <text class="row-hint">本地优先 · 按需账号同步</text>
            </view>
            <text class="row-value">v{{ currentVersion }}</text>
          </view>
        </view>
      </view>
    </view>

    <UpdateSheet :visible="updateVisible" :state="updateState" @close="closeUpdate" @download="downloadUpdate" @cancel="cancelDownload" @install="installDownloaded" @check="openUpdate" @browser="openUpdateInBrowser" />
    </template>
  </view>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import UpdateSheet from '../../components/UpdateSheet.vue'
import { getProfile, getSettings, setHideCompleted, restoreDemoData } from '../../api/store'
import { checkUpdate, downloadUpdate, cancelDownload, installDownloaded, installedVersion, subscribeUpdate, openUpdateInBrowser } from '../../api/update'
import { toast } from '../../utils/platform'
import { load as loadStorage } from '../../api/storage.js'

function openAnniversaries() { uni.navigateTo({ url: '/pages/anniversaries/index' }) }
function openAccount() { uni.navigateTo({ url: '/pages/account/index' }) }

const syncAccountHint = ref('登录账号，在设备间同步')
const profile = ref(null)
const settings = ref(null)
const ready = ref(false)
const loadError = ref('')
const switchRevision = ref(0)
const updateVisible = ref(false)
const currentVersion = ref(installedVersion().version)
const updateState = ref({ status: 'idle', currentVersion: currentVersion.value })
const unsubscribeUpdate = subscribeUpdate(state => { updateState.value = state; currentVersion.value = state.currentVersion })
onBeforeUnmount(unsubscribeUpdate)
onUnload(unsubscribeUpdate)

onShow(() => {
  load()
  currentVersion.value = installedVersion().version
})

function load() {
  try {
    const nextProfile = getProfile()
    if (!nextProfile || typeof nextProfile !== 'object') throw new Error('本机个人资料无效，请保留数据并重试')
    const nextSettings = { ...getSettings() }
    const syncMeta = loadStorage().syncMeta
    syncAccountHint.value = syncMeta?.remoteUserId ? `已绑定 ${syncMeta.remoteUsername || '账号'}` : '登录账号，在设备间同步'
    profile.value = { ...nextProfile, name: typeof nextProfile.name === 'string' ? nextProfile.name : '', phone: typeof nextProfile.phone === 'string' ? nextProfile.phone : '' }
    settings.value = nextSettings
    loadError.value = ''
    ready.value = true
    return true
  } catch (error) {
    loadError.value = error.message || String(error)
    ready.value = false
    return false
  }
}

function toggleHideCompleted(view, event) {
  if (!ready.value) return
  try {
    setHideCompleted(view, event.detail.value)
    load()
  } catch (error) {
    toast(error.message || String(error))
    load()
  } finally {
    // 原生 switch 已先改变外观，重新挂载才能可靠回显落盘值。
    switchRevision.value++
  }
}

async function openUpdate() {
  updateVisible.value = true
  await checkUpdate()
}

function closeUpdate() {
  updateVisible.value = false
}

let restoreConfirming = false
function restore() {
  if (restoreConfirming || !ready.value) return
  let account
  try {
    const meta = loadStorage().syncMeta || {}
    account = JSON.stringify([meta.remoteUserId || null, meta.deviceId || null, meta.initialUpload?.sessionId || null, meta.initialMerge?.userId || null])
  } catch (error) { toast(error.message || String(error)); return }
  const linked = JSON.parse(account).some((value, index) => index !== 1 && value)
  restoreConfirming = true
  uni.showModal({
    title: '恢复演示数据',
    content: linked
      ? '将替换本机数据并恢复演示数据。同步时云端及其他设备上的对应数据也可能被删除，演示数据也可能同步。确定继续吗？'
      : '将清除本机数据并恢复演示数据。当前未绑定账号；以后绑定同步时，删除记录及演示数据可能上传到云端。确定继续吗？',
    success: (res) => {
      if (!res.confirm) return
      try {
        const meta = loadStorage().syncMeta || {}
        if (JSON.stringify([meta.remoteUserId || null, meta.deviceId || null, meta.initialUpload?.sessionId || null, meta.initialMerge?.userId || null]) !== account) {
          toast('账号状态已改变，请重新确认'); return
        }
        restoreDemoData()
      } catch (error) { toast(error.message || String(error)); return }
      if (load()) toast('已恢复')
    },
    complete: () => { restoreConfirming = false }
  })
}
</script>

<style scoped>
.mine-group-title { display: block; color: #929daa; font-size: 24rpx; margin: 24rpx 10rpx 16rpx; }
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
  padding: 24rpx 28rpx calc(40rpx + env(safe-area-inset-bottom));
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
  background: #e8f3ff;
  color: #176ab7;
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
  overflow-wrap: anywhere;
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

.row-button { width: 100%; margin: 0; border-radius: 0; background: transparent; text-align: left; line-height: normal; }
.row-button::after { border: 0; }
.row-button:focus-visible, .mine-row [role="switch"]:focus-visible { outline: 4rpx solid #79a9d7; outline-offset: -4rpx; }
.mine-row > view { flex: 1; min-width: 0; }

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
  color: #6e7e90;
  font-size: 24rpx;
  line-height: 1.5;
  overflow-wrap: anywhere;
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
