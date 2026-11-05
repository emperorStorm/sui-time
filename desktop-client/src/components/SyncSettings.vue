<template>
  <section class="page settings-page sync-settings" aria-label="账号与同步" :aria-busy="busy">
    <section class="settings-block">
      <div class="settings-heading"><div><p class="eyebrow">多设备数据</p><h2>账号与同步</h2><span>使用服务器账号绑定本机数据，登录后选择首次同步方式。</span></div><button class="quiet-button" type="button" :disabled="busy" @click="refreshStatus">刷新状态</button></div>
      <p v-if="loading" role="status">正在读取同步状态…</p>
      <p v-if="operationError" class="form-error" role="alert">{{ operationError }}</p>
      <template v-if="status">
        <div v-if="!status.configured" class="sync-empty" role="status"><CloudOff :size="30" /><h3>尚未配置同步服务</h3><p>请先在桌面客户端配置同步服务器，再刷新状态。当前数据仍保存在本机。</p><small>浏览器演示不支持服务器账号注册、登录或同步。</small></div>
        <template v-else>
          <dl class="sync-details">
            <div><dt>服务器</dt><dd>已配置同步服务</dd></div>
            <div><dt>服务器账号</dt><dd>{{ status.username || '尚未登录' }}</dd></div>
            <div><dt>绑定状态</dt><dd>{{ status.bound ? '已绑定本机数据' : '尚未绑定' }}</dd></div>
            <div><dt>远端数据</dt><dd>{{ status.remoteEmpty === null ? '尚未确认' : status.remoteEmpty ? '远端为空' : '远端已有数据' }}</dd></div>
            <div><dt>上次同步</dt><dd>{{ lastSyncLabel }}</dd></div>
            <div><dt>待同步变更</dt><dd>{{ status.pendingCount }} 项</dd></div>
            <div><dt>当前状态</dt><dd role="status">{{ status.syncing ? '正在同步…' : status.needsReauth ? '登录已失效，请重新登录' : status.error ? '同步失败' : status.initializing ? '首次上传进行中，可继续重试' : status.bound ? '已就绪' : '等待绑定' }}</dd></div>
          </dl>
          <p v-if="status.error" class="form-error sync-error" role="alert">失败原因：{{ status.error }}</p>
          <form v-if="!status.username || status.needsReauth || !status.bound" class="sync-auth" @submit.prevent="authenticate">
            <h3>{{ status.needsReauth ? '重新登录服务器账号' : '服务器账号' }}</h3>
            <fieldset :disabled="busy"><div class="sync-fields"><label class="field"><span>服务器账号</span><input v-model.trim="username" name="sync-username" autocomplete="username" maxlength="128" required placeholder="输入服务器账号" /></label><label class="field"><span>密码</span><span class="password-control"><input v-model="password" name="sync-password" :type="passwordVisible ? 'text' : 'password'" :autocomplete="authMode === 'register' ? 'new-password' : 'current-password'" required maxlength="1024" placeholder="输入服务器账号密码" /><button class="password-toggle" type="button" :aria-label="passwordVisible ? '隐藏密码' : '显示密码'" :aria-pressed="passwordVisible" :title="passwordVisible ? '隐藏密码' : '显示密码'" @click="passwordVisible = !passwordVisible"><EyeOff v-if="passwordVisible" :size="17" aria-hidden="true" /><Eye v-else :size="17" aria-hidden="true" /></button></span></label></div>
              <div class="sync-actions"><button class="primary-button" type="submit">{{ submitting ? '正在处理…' : authMode === 'register' ? '注册服务器账号' : '登录服务器账号' }}</button><button v-if="!status.needsReauth" class="quiet-button" type="button" @click="authMode = authMode === 'login' ? 'register' : 'login'">{{ authMode === 'login' ? '改为注册账号' : '已有账号，去登录' }}</button></div>
            </fieldset>
          </form>
          <form v-if="status.username && !status.bound && !status.needsReauth" class="sync-binding" @submit.prevent="bindAccount">
            <fieldset :disabled="busy"><legend>首次绑定方式</legend>
              <p v-if="status.initializing">首次上传已开始，重试将继续之前的本机数据快照；期间的新修改会保留在待同步队列中。</p>
              <template v-else>
                <label class="sync-strategy"><input v-model="strategy" type="radio" value="upload" /><span><strong>上传本机数据</strong><small>以本机数据初始化远端；适合远端为空时使用。</small></span></label>
                <label class="sync-strategy"><input v-model="strategy" type="radio" value="merge" /><span><strong>合并本机与远端</strong><small>合并两端数据，保留双方记录。</small></span></label>
                <label class="sync-strategy"><input v-model="strategy" type="radio" value="remote" /><span><strong>使用远端替换本机</strong><small>本机现有数据将被远端数据替换，请先导出备份。</small></span></label>
                <label v-if="strategy === 'remote'" class="sync-confirm"><input v-model="replaceConfirmed" type="checkbox" />我确认使用远端数据替换本机，接受本机现有数据被覆盖{{ status.remoteEmpty ? '（远端为空，本机数据将被清空）' : '' }}。</label>
              </template>
              <div class="sync-actions"><button class="primary-button" type="submit" :disabled="!status.initializing && strategy === 'remote' && !replaceConfirmed">{{ submitting ? '正在绑定…' : status.initializing ? '继续首次上传' : '确认绑定' }}</button><button v-if="status.initializing" class="quiet-button" type="button" @click="cancelConfirmed = true">取消首次上传</button></div>
              <div v-if="status.initializing && cancelConfirmed" class="sync-unbind" role="group" aria-label="确认取消首次上传"><p>取消仅移除云端未发布的暂存数据，本机数据保留；若云端已经完成，请继续首次上传。</p><div class="sync-actions"><button class="quiet-button" type="button" @click="cancelConfirmed = false">返回</button><button class="quiet-button danger-text" type="button" @click="perform(cancelSyncInitialization)">确认取消首次上传</button></div></div>
            </fieldset>
          </form>
          <div v-if="status.bound" class="sync-actions"><button class="primary-button" type="button" :disabled="busy || status.needsReauth" @click="perform(nowSync)"><RefreshCw :size="17" :class="{ spinning: status.syncing }" />{{ status.syncing ? '正在同步…' : '立即同步' }}</button><button class="quiet-button danger-text" type="button" :disabled="busy" @click="unbindConfirmed = true">解除绑定</button></div>
          <div v-if="unbindConfirmed" class="sync-unbind" role="group" aria-label="确认解除绑定"><p>解除绑定将停止本机同步，本机数据继续保留。</p><div class="sync-actions"><button class="quiet-button" type="button" :disabled="busy" @click="unbindConfirmed = false">取消</button><button class="quiet-button danger-text" type="button" :disabled="busy" @click="perform(unbindSync)">确认解除绑定</button></div></div>
          <p v-if="successMessage" class="sync-success" role="status">{{ successMessage }}</p>
        </template>
      </template>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CloudOff, Eye, EyeOff, RefreshCw } from 'lucide-vue-next'
import { bindSync, cancelSyncInitialization, getSyncStatus, loginSyncAccount, nowSync, registerSyncAccount, unbindSync, type SyncBindStrategy, type SyncStatus } from '../api/native'

const props = defineProps<{ status: SyncStatus | null }>()
const emit = defineEmits<{ state: [status: SyncStatus] }>()
const username = ref(props.status?.username || '')
const password = ref('')
const passwordVisible = ref(false)
const authMode = ref<'login' | 'register'>('login')
const strategy = ref<SyncBindStrategy>('merge')
const replaceConfirmed = ref(false)
const unbindConfirmed = ref(false)
const cancelConfirmed = ref(false)
const submitting = ref(false)
const loading = ref(false)
const operationError = ref('')
const successMessage = ref('')
const busy = computed(() => submitting.value || loading.value || props.status?.syncing === true)
const lastSyncLabel = computed(() => {
  if (props.status?.lastSyncAt == null) return '尚未同步'
  const date = new Date(props.status.lastSyncAt)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false })
})
watch(strategy, () => { replaceConfirmed.value = false })
watch(() => props.status?.username, value => { if (value) username.value = value })
watch(() => props.status?.needsReauth, value => { if (value) authMode.value = 'login' })

async function refreshStatus() {
  if (busy.value) return
  loading.value = true
  operationError.value = ''
  try { emit('state', await getSyncStatus()) }
  catch (error) { operationError.value = error instanceof Error ? error.message : String(error) }
  finally { loading.value = false }
}

async function perform(action: () => Promise<SyncStatus>) {
  if (busy.value) return
  submitting.value = true
  operationError.value = ''
  successMessage.value = ''
  try {
    const result = await action()
    emit('state', result)
    unbindConfirmed.value = false
    cancelConfirmed.value = false
    replaceConfirmed.value = false
    successMessage.value = result.error ? '' : '操作已完成'
  } catch (error) {
    operationError.value = error instanceof Error ? error.message : String(error)
  } finally { submitting.value = false }
}

async function authenticate() {
  if (!username.value.trim() || !password.value) return
  await perform(async () => {
    const input = { username: username.value.trim(), password: password.value }
    const result = await (authMode.value === 'register' && !props.status?.needsReauth ? registerSyncAccount(input) : loginSyncAccount(input))
    password.value = ''
    return result
  })
}

async function bindAccount() {
  if (!props.status?.initializing && strategy.value === 'remote' && !replaceConfirmed.value) return
  await perform(() => bindSync(props.status?.initializing ? 'upload' : strategy.value))
}

void refreshStatus()
</script>

<style scoped>
.sync-settings { overflow-y: auto; }
.sync-settings .settings-block { max-width: 880px; }
.sync-empty { display: grid; justify-items: start; gap: 12px; padding: 32px 0 12px; color: var(--ui-muted); }
.sync-empty h3, .sync-empty p, .sync-empty small { margin: 0; line-height: 1.7; }
.sync-empty h3 { color: var(--ui-ink); }
.sync-details { margin: 24px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 18px 32px; }
.sync-details div { display: grid; gap: 7px; min-width: 0; }
.sync-details dt { color: #748091; font-size: 12px; }
.sync-details dd { margin: 0; overflow-wrap: anywhere; font-size: 14px; }
.sync-auth, .sync-binding { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--ui-line); }
.sync-auth h3 { margin: 0 0 16px; font-size: 15px; }
.sync-settings fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.sync-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.sync-fields .field { min-width: 0; }
.sync-fields input { width: 100%; }
.password-control { display: flex; align-items: center; gap: 6px; }
.password-control input { min-width: 0; flex: 1; }
.password-toggle { display: grid; width: 40px; height: 40px; flex: 0 0 40px; padding: 0; place-items: center; color: var(--ui-muted); background: #fff; border: 1px solid var(--ui-line); border-radius: 6px; cursor: pointer; }
.password-toggle:hover { color: var(--ui-ink); border-color: #b8c9de; }
.password-toggle:focus-visible { outline: 2px solid var(--ui-primary, #4d82d5); outline-offset: 2px; }
.sync-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 18px; }
.sync-binding legend { font-weight: 600; margin-bottom: 16px; font-size: 15px; }
.sync-strategy { display: flex; gap: 12px; align-items: start; margin-bottom: 18px; cursor: pointer; }
.sync-strategy input, .sync-confirm input { flex-shrink: 0; width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--ui-primary, #4d82d5); }
.sync-strategy span { display: grid; gap: 6px; }
.sync-strategy strong { font-size: 14px; font-weight: 500; }
.sync-strategy small { color: #748091; line-height: 1.6; }
.sync-confirm { display: flex; gap: 10px; margin: 8px 0 20px; color: #bd454f; font-size: 13px; line-height: 1.7; }
.sync-unbind { margin-top: 20px; border-top: 1px solid var(--ui-line); padding-top: 10px; font-size: 14px; }
.sync-error, .sync-success { overflow-wrap: anywhere; line-height: 1.7; }
.sync-success { color: #23835c; font-size: 13px; }
@media (max-width: 700px) { .sync-details, .sync-fields { grid-template-columns: 1fr; } }
</style>
