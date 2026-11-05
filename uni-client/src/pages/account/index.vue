<template>
  <view class="page account-page">
    <view class="topbar"><view class="topbar-action" aria-label="返回" @click="back">‹</view><text class="topbar-title">账号与同步</text><view class="topbar-action" /></view>
    <view class="shell account-body">
      <view class="panel account-card">
        <text class="account-title">{{ meta.remoteUserId ? meta.remoteUsername : pendingInitial ? pendingInitial.username : '让时光记录随身同行' }}</text>
        <text class="account-hint">本机数据离线可用，绑定账号后同步到其他设备。</text>
        <text v-if="meta.initialUpload" class="account-hint">首次上传尚未完成，绑定未成功。请使用原账号继续；期间的本机修改会保留。</text>
        <text v-if="meta.initialMerge" class="account-hint">首次合并尚未完成，绑定未成功。部分数据可能已上传，请使用原账号继续；期间的本机修改会保留。</text>
        <text v-if="meta.remoteUserId" class="account-hint">{{ syncLabel }} · 待同步 {{ pendingCount }} 条</text>
        <text v-if="meta.lastSyncAt" class="account-hint">上次同步：{{ new Date(meta.lastSyncAt).toLocaleString() }}</text>
        <text v-if="!configured" class="account-hint">未配置同步服务，请安装已配置服务地址的客户端；现有数据继续保存在本机。</text>
        <text v-if="error || state.error" class="account-error" role="alert">{{ error || state.error }}</text>
      </view>

      <view v-if="!meta.remoteUserId || state.status === 'needsReauth' || reauth" class="panel account-card">
        <view v-if="!meta.remoteUserId && !pendingInitial" class="account-tabs"><button :class="{ selected: mode === 'login' }" :disabled="busy" @click="mode = 'login'">登录</button><button :class="{ selected: mode === 'register' }" :disabled="busy" @click="mode = 'register'">注册</button></view>
        <text v-else class="account-title">{{ meta.initialUpload ? '重新登录以继续首次上传' : meta.initialMerge ? '重新登录以继续首次合并' : '登录已过期，请重新验证' }}</text>
        <text class="field-label">用户名</text>
        <input v-model="username" class="account-input" :disabled="busy || !!meta.remoteUserId || !!pendingInitial" maxlength="32" placeholder="3–32 位字母、数字或 _ . -" aria-label="用户名" />
        <text class="field-label">密码</text>
        <input v-model="password" class="account-input" :disabled="busy" :password="true" maxlength="72" placeholder="8–72 位密码" aria-label="密码" />
        <template v-if="!meta.remoteUserId && !pendingInitial">
          <text class="field-label">首次绑定的数据处理方式</text>
          <text v-if="meta.dataOrigin === 'seed'" class="seed-notice">当前为演示数据，默认以云端为准；选择上传或合并时，演示事项也会上传。</text>
          <view v-for="option in strategies" :key="option.value" :class="['strategy', { chosen: strategy === option.value }]" role="radio" :aria-checked="strategy === option.value" @click="!busy && (strategy = option.value)">
            <text class="strategy-title">{{ strategy === option.value ? '●' : '○' }} {{ option.label }}</text><text class="account-hint">{{ option.hint }}</text>
          </view>
        </template>
        <button class="primary" :loading="busy" :disabled="busy || !ready || !configured" @click="submit">{{ meta.initialUpload ? '重新登录并继续上传' : meta.initialMerge ? '重新登录并继续合并' : meta.remoteUserId ? '重新登录并同步' : mode === 'register' ? '注册并绑定' : '登录并绑定' }}</button>
        <button v-if="pendingInitial && !reauth && state.status !== 'needsReauth'" class="primary" :loading="busy" :disabled="busy || !ready || !configured" @click="manualSync">{{ meta.initialUpload ? '继续首次上传' : '继续首次合并' }}</button>
        <button v-if="meta.initialUpload" class="unbind" :disabled="busy || !ready || !configured" @click="cancelUpload">取消首次上传，保留本机数据</button>
        <text v-if="meta.initialUpload" class="account-hint">会话过期或云端已有数据时可取消；若云端已完成初始化，须继续上传以完成绑定。取消需登录原账号并连接服务。</text>
      </view>

      <view v-if="meta.remoteUserId" class="panel account-card">
        <button class="primary" :loading="busy" :disabled="busy || !ready || !configured" @click="manualSync">立即同步</button>
        <button class="unbind" :disabled="busy" @click="disconnect">解绑账号，保留本机数据</button>
        <text class="account-hint">解绑后不再自动同步，现有事项、纪念日与设置继续保存在本机。</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { load } from '../../api/storage.js'
import { SYNC_BASE_URL } from '../../utils/sync-config.js'
import { readAuth } from '../../api/auth.js'
const configured = Boolean(SYNC_BASE_URL)
import { bindAccount, syncNow, unbindAccount, cancelInitialUpload, syncEngine } from '../../api/sync.js'

const mode = ref('login')
const username = ref('')
const password = ref('')
const strategy = ref('remote')
const meta = ref({})
const ready = ref(false)
const error = ref('')
const working = ref(false)
const confirming = ref(false)
const state = ref(syncEngine.getState())
const reauth = ref(false)
const pendingInitial = computed(() => meta.value.initialUpload || meta.value.initialMerge)
const busy = computed(() => working.value || confirming.value || state.value.status === 'syncing')
const pendingCount = computed(() => Object.values(meta.value.outbox || {}).reduce((count, entries) => count + Object.keys(entries).length, 0))
const syncLabel = computed(() => ({ idle: '同步已就绪', syncing: '正在同步', needsReauth: '需要重新登录', error: '同步失败，可重试', unbound: '尚未绑定' }[state.value.status] || '尚未同步'))
const strategies = [
  { value: 'remote', label: '以云端为准', hint: '完整下载成功后替换本机数据。云端为空时本机也会清空。' },
  { value: 'merge', label: '合并本机与云端', hint: '上传本机记录并下载云端记录，同一记录按服务端版本合并。' },
  { value: 'upload', label: '上传至空云端', hint: '只允许首次上传到空账号，云端已有数据时停止。' }
]
function refresh() {
  try {
    meta.value = load().syncMeta || {}
    ready.value = true
    if (meta.value.remoteUserId || pendingInitial.value) username.value = meta.value.remoteUsername || pendingInitial.value?.username || ''
    reauth.value = !!(meta.value.remoteUserId || pendingInitial.value) && !readAuth()?.token
  } catch (cause) { ready.value = false; error.value = cause.message || String(cause) }
}
const unsubscribe = syncEngine.subscribe(value => { state.value = value; refresh() })
onBeforeUnmount(unsubscribe)
onUnload(unsubscribe)
onShow(refresh)
function back() { uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/profile/index' }) }) }
function confirm(title, content) {
  return new Promise(resolve => uni.showModal({ title, content, success: result => resolve(result.confirm), fail: () => resolve(false) }))
}
async function perform(action) {
  if (busy.value) return
  working.value = true; error.value = ''
  try { await action(); password.value = ''; refresh() } catch (cause) { error.value = cause.message || String(cause); refresh() }
  finally { working.value = false }
}
async function submit() {
  if (busy.value || !ready.value) return
  const boundId = meta.value.remoteUserId || pendingInitial.value?.userId || null
  const selectedStrategy = strategy.value
  if (!boundId) {
    confirming.value = true
    let accepted
    try {
      if (selectedStrategy === 'remote') {
        accepted = await confirm('以云端为准', '完整下载后将替换本机事项、分类、纪念日和设置。云端为空时将清空本机记录，是否继续？')
      } else {
        const demo = meta.value.dataOrigin === 'seed' ? '当前为演示数据，演示事项也会上传。' : ''
        accepted = await confirm(selectedStrategy === 'upload' ? '上传本机数据' : '合并本机与云端', `将上传本机事项、分类、纪念日和设置（含个人资料）。${demo}不会因数据来源自动删除本机记录；合并时同一记录按服务端版本处理。是否继续？`)
      }
    } finally { confirming.value = false }
    if (!accepted || (meta.value.remoteUserId || pendingInitial.value?.userId || null) !== boundId) return
  }
  await perform(() => bindAccount({ mode: boundId ? 'login' : mode.value, username: username.value, password: password.value, strategy: selectedStrategy }))
}
function manualSync() { return perform(syncNow) }
async function cancelUpload() {
  if (busy.value || !ready.value || !meta.value.initialUpload) return
  const { sessionId, userId } = meta.value.initialUpload
  confirming.value = true
  let accepted
  try { accepted = await confirm('取消首次上传', '将确认并取消云端初始化，本机事项、设置和待同步记录都会保留。若云端已完成初始化，必须继续完成绑定。是否取消？') }
  finally { confirming.value = false }
  if (accepted) await perform(() => cancelInitialUpload({ sessionId, userId }))
}
async function disconnect() {
  if (await confirm('解绑账号', '停止此设备的账号同步并清除登录凭证，本机数据会保留。')) await perform(unbindAccount)
}
</script>

<style scoped>
.account-body { box-sizing: border-box; padding: 28rpx; }
.account-card { padding: 32rpx; margin-bottom: 24rpx; }
.account-title { display: block; font-size: 34rpx; font-weight: 600; overflow-wrap: anywhere; }
.account-hint { display: block; margin-top: 12rpx; color: #7a8593; font-size: 25rpx; line-height: 1.65; overflow-wrap: anywhere; }
.account-error { display: block; margin-top: 20rpx; color: #cf454c; line-height: 1.6; overflow-wrap: anywhere; }
.account-tabs { display: flex; gap: 20rpx; margin-bottom: 24rpx; }
.account-tabs button { flex: 1; font-size: 28rpx; background: #f4f6f9; }
.account-tabs .selected { background: var(--blue-soft); color: #287fc1; }
.field-label { display: block; margin: 24rpx 0 14rpx; font-size: 27rpx; }
.account-input { box-sizing: border-box; width: 100%; height: 88rpx; padding: 16rpx 20rpx; background: #f5f7fa; border-radius: 14rpx; font-size: 27rpx; }
.strategy { padding: 22rpx; margin-top: 16rpx; border: 2rpx solid #e8ecf1; border-radius: 16rpx; }
.strategy.chosen { border-color: var(--blue); background: #f4f9ff; }
.strategy-title { font-size: 28rpx; }
.seed-notice { display: block; color: #a36a27; font-size: 25rpx; line-height: 1.7; }
.primary { margin-top: 28rpx; background: var(--blue); color: white; font-size: 29rpx; }
.unbind { margin-top: 20rpx; font-size: 27rpx; background: #f5f7fa; color: #777; }
</style>
