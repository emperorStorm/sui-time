<template>
  <div ref="root" class="notification-center">
    <button class="notification-trigger" type="button" aria-label="通知" title="通知" @click="popoverOpen = !popoverOpen">
      <Bell :size="19" />
      <span v-if="unreadCount" class="notification-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
    </button>

    <section v-if="popoverOpen" class="notification-panel" aria-label="通知列表">
      <header class="notification-header">
        <div><strong>通知</strong><span>{{ unreadCount ? `${unreadCount} 条未读` : '全部已读' }}</span></div>
        <button class="quiet-button notification-read-all" type="button" :disabled="!unreadCount" @click="markAllAsRead">全部已读</button>
      </header>
      <div v-if="notifications.length" class="notification-list">
        <button v-for="item in notifications" :key="item.id" type="button" class="notification-item" :class="{ unread: !item.read }" @click="openNotification(item)">
          <span v-if="!item.read" class="notification-unread-dot" />
          <span class="notification-icon">更</span>
          <span class="notification-copy"><strong>{{ item.title }}</strong><span>{{ item.summary }}</span><time>{{ formatTime(item.createdAt) }}</time></span>
        </button>
      </div>
      <p v-else class="notification-empty">暂无通知</p>
    </section>
  </div>

  <div v-if="updateModalOpen && activeNotification" class="modal-backdrop update-modal-backdrop" @mousedown.self="closeUpdateModal">
    <section class="modal-panel update-modal" role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
      <header>
        <div><p class="eyebrow">桌面客户端</p><h2 id="update-modal-title">{{ activeInstalled ? '已安装此版本' : '发现新版本' }}</h2></div>
        <button class="icon-button ghost" type="button" title="关闭" :disabled="installing" @click="closeUpdateModal"><X :size="20" /></button>
      </header>
      <dl class="update-version-list"><div><dt>当前版本</dt><dd>v{{ activeNotification.updateInfo.currentVersion }}</dd></div><div><dt>最新版本</dt><dd>v{{ activeNotification.updateInfo.latestVersion }}</dd></div></dl>
      <p v-if="activeInstalled" class="update-installed-tip">当前客户端已更新到该版本，无需重复更新。</p>
      <section class="update-notes"><strong>更新内容</strong><pre>{{ activeNotification.updateInfo.body }}</pre></section>
      <section v-if="installing || installError" class="update-install-state" :class="{ error: installError }"><div><span>{{ installError || installStatus }}</span><strong v-if="installing">{{ installProgress }}%</strong></div><div v-if="installing" class="update-progress-track"><span :style="{ width: `${installProgress}%` }" /></div></section>
      <footer><span></span><button class="quiet-button" type="button" :disabled="installing" @click="closeUpdateModal">{{ activeInstalled ? '关闭' : '暂不更新' }}</button><button class="primary-button" type="button" :disabled="activeInstalled || installing" @click="installActiveUpdate"><RefreshCw v-if="installing" class="spinning" :size="16" /><Download v-else :size="16" />{{ installing ? '正在更新' : '立即更新' }}</button></footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Bell, Download, RefreshCw, X } from 'lucide-vue-next'
import { checkAppUpdate, currentVersion, formatUpdateError, installAppUpdate, isTauriRuntime } from '../api/native'
import type { UpdateCheckResult } from '../api/native'

const STORAGE_KEY = 'sui-time:notifications'
const UPDATE_NOTIFICATION_PREFIX = 'app-update:'

type AvailableUpdate = NonNullable<UpdateCheckResult['update']>

interface UpdateNotificationPayload {
  currentVersion: string
  latestVersion: string
  body: string
  checkedAt: string
  installed?: boolean
}

interface AppNotification {
  id: string
  type: 'app-update'
  title: string
  summary: string
  createdAt: string
  read: boolean
  updateInfo: UpdateNotificationPayload
}

const root = ref<HTMLElement | null>(null)
const popoverOpen = ref(false)
const notifications = ref<AppNotification[]>(loadNotifications())
const currentAppVersion = ref('')
const activeNotification = ref<AppNotification | null>(null)
const updateModalOpen = ref(false)
const installing = ref(false)
const installProgress = ref(0)
const installStatus = ref('')
const installError = ref('')
const updateCache = new Map<string, AvailableUpdate>()
let updateCheckPromise: Promise<UpdateCheckResult> | null = null
const unreadCount = computed(() => notifications.value.filter(item => !item.read).length)
const activeInstalled = computed(() => Boolean(activeNotification.value && (activeNotification.value.updateInfo.installed || isVersionInstalled(currentAppVersion.value || activeNotification.value.updateInfo.currentVersion, activeNotification.value.updateInfo.latestVersion))))

onMounted(() => {
  document.addEventListener('mousedown', closePopoverOnOutsideClick)
  void initializeNotifications()
})

onBeforeUnmount(() => document.removeEventListener('mousedown', closePopoverOnOutsideClick))

async function initializeNotifications() {
  try {
    currentAppVersion.value = await currentVersion()
    markInstalledNotifications(currentAppVersion.value)
  } catch {
    currentAppVersion.value = ''
  }
  if (!isTauriRuntime()) return
  try {
    await checkForUpdate(false)
  } catch {
    // 自动检查失败不影响正常进入工作区，用户仍可手动检查。
  }
}

async function checkForUpdate(openWhenFound = false): Promise<UpdateCheckResult | null> {
  if (!updateCheckPromise) {
    updateCheckPromise = performUpdateCheck().finally(() => { updateCheckPromise = null })
  }
  const result = await updateCheckPromise
  const update = result.update
  if (update && openWhenFound) {
    const notification = notifications.value.find(item => item.id === `${UPDATE_NOTIFICATION_PREFIX}${update.version}`)
    if (notification) openNotification(notification)
  }
  return result
}

async function performUpdateCheck(): Promise<UpdateCheckResult> {
  const result = await checkAppUpdate()
  currentAppVersion.value = result.currentVersion
  markInstalledNotifications(result.currentVersion)
  if (!result.update) return result

  const id = `${UPDATE_NOTIFICATION_PREFIX}${result.update.version}`
  updateCache.set(id, result.update)
  upsertUpdateNotification(id, {
    currentVersion: result.currentVersion,
    latestVersion: result.update.version,
    body: result.update.body || '本次更新暂无详细说明。',
    checkedAt: new Date().toISOString()
  })
  return result
}

function upsertUpdateNotification(id: string, updateInfo: UpdateNotificationPayload) {
  const existing = notifications.value.find(item => item.id === id)
  const notification: AppNotification = {
    id,
    type: 'app-update',
    title: getNotificationTitle(updateInfo),
    summary: getNotificationSummary(updateInfo),
    createdAt: existing?.createdAt || updateInfo.checkedAt,
    read: existing?.read || false,
    updateInfo
  }
  notifications.value = [notification, ...notifications.value.filter(item => item.id !== id)]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  saveNotifications()
  return notification
}

function openNotification(item: AppNotification) {
  markAsRead(item.id)
  popoverOpen.value = false
  activeNotification.value = notifications.value.find(notification => notification.id === item.id) || item
  installProgress.value = 0
  installStatus.value = ''
  installError.value = ''
  updateModalOpen.value = true
}

function closeUpdateModal() {
  if (installing.value) return
  updateModalOpen.value = false
}

async function installActiveUpdate() {
  const notification = activeNotification.value
  if (!notification || activeInstalled.value || installing.value) return
  installing.value = true
  installProgress.value = 0
  installStatus.value = '正在准备下载更新'
  installError.value = ''
  let downloadedBytes = 0
  let totalBytes = 0
  try {
    const update = await resolveUpdate(notification)
    await installAppUpdate(update, event => {
      if (event.event === 'Started') {
        downloadedBytes = 0
        totalBytes = event.data.contentLength || 0
        installStatus.value = '正在下载更新'
      }
      if (event.event === 'Progress') {
        downloadedBytes += event.data.chunkLength
        installProgress.value = totalBytes ? Math.min(Math.round((downloadedBytes / totalBytes) * 100), 99) : Math.max(installProgress.value, 1)
      }
      if (event.event === 'Finished') {
        installProgress.value = 100
        installStatus.value = '更新安装完成，正在重启'
        markUpdateInstalled(notification.id)
      }
    })
  } catch (error) {
    installing.value = false
    installError.value = downloadedBytes > 0 ? `更新安装失败：${formatUpdateError(error)}` : `更新下载失败：${formatUpdateError(error)}`
  }
}

async function resolveUpdate(notification: AppNotification): Promise<AvailableUpdate> {
  const cached = updateCache.get(notification.id)
  if (cached) return cached
  const result = await checkAppUpdate()
  if (!result.update || result.update.version !== notification.updateInfo.latestVersion) {
    throw new Error('当前更新信息已失效，请重新检查更新')
  }
  currentAppVersion.value = result.currentVersion
  updateCache.set(notification.id, result.update)
  return result.update
}

function markAsRead(id: string) {
  updateNotifications(item => item.id === id && !item.read ? { ...item, read: true } : item)
}

function markAllAsRead() {
  if (!unreadCount.value) return
  updateNotifications(item => item.read ? item : { ...item, read: true })
}

function markInstalledNotifications(version: string) {
  if (!version) return
  updateNotifications(item => {
    if (item.updateInfo.installed || !isVersionInstalled(version, item.updateInfo.latestVersion)) return item
    const updateInfo = { ...item.updateInfo, currentVersion: version, installed: true }
    return { ...item, title: getNotificationTitle(updateInfo), summary: getNotificationSummary(updateInfo), updateInfo }
  })
}

function markUpdateInstalled(id: string) {
  updateNotifications(item => {
    if (item.id !== id || item.updateInfo.installed) return item
    const updateInfo = { ...item.updateInfo, installed: true }
    return { ...item, title: getNotificationTitle(updateInfo), summary: getNotificationSummary(updateInfo), updateInfo }
  })
  activeNotification.value = notifications.value.find(item => item.id === id) || activeNotification.value
}

function updateNotifications(mapper: (item: AppNotification) => AppNotification) {
  const nextNotifications = notifications.value.map(mapper)
  if (nextNotifications.some((item, index) => item !== notifications.value[index])) {
    notifications.value = nextNotifications
    saveNotifications()
  }
}

function closePopoverOnOutsideClick(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) popoverOpen.value = false
}

function loadNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isAppNotification).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()) : []
  } catch {
    return []
  }
}

function saveNotifications() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.value))
}

function isAppNotification(value: unknown): value is AppNotification {
  const item = value as Partial<AppNotification>
  return Boolean(item && item.type === 'app-update' && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.summary === 'string' && typeof item.createdAt === 'string' && typeof item.read === 'boolean' && item.updateInfo && typeof item.updateInfo.currentVersion === 'string' && typeof item.updateInfo.latestVersion === 'string' && typeof item.updateInfo.body === 'string')
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function isVersionInstalled(currentVersion: string, latestVersion: string) {
  const currentParts = parseVersionParts(currentVersion)
  const latestParts = parseVersionParts(latestVersion)
  const length = Math.max(currentParts.length, latestParts.length)
  for (let index = 0; index < length; index += 1) {
    const current = currentParts[index] || 0
    const latest = latestParts[index] || 0
    if (current !== latest) return current > latest
  }
  return true
}

function parseVersionParts(version: string) {
  return version.replace(/^v/i, '').split(/[^\d]+/).filter(Boolean).map(part => Number(part))
}

function getNotificationTitle(updateInfo: UpdateNotificationPayload) {
  return updateInfo.installed ? `已更新到 ${updateInfo.latestVersion}` : `发现新版本 ${updateInfo.latestVersion}`
}

function getNotificationSummary(updateInfo: UpdateNotificationPayload) {
  return updateInfo.installed ? `当前客户端已更新到 ${updateInfo.latestVersion}。` : `当前版本 ${updateInfo.currentVersion}，点击查看更新内容。`
}

defineExpose({ checkForUpdate })
</script>
