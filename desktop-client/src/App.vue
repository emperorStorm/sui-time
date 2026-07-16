<template>
  <main class="app-shell">
    <section v-if="booting" class="loading-screen"><span class="loading-mark"></span><p>正在打开岁岁时光</p></section>

    <section v-else-if="!session" class="auth-screen">
      <div class="auth-art" aria-hidden="true"><div class="auth-orbit orbit-one"></div><div class="auth-orbit orbit-two"></div><div class="auth-clock">◷</div></div>
      <form class="auth-panel" @submit.prevent="submitAuth">
        <div class="brand-lockup"><img src="./assets/brand/sui-time-icon.svg" alt="岁岁时光" /><div><span>岁岁时光</span><small>把日子安排在心里</small></div></div>
        <div class="auth-copy"><p>{{ bootState?.needsSetup ? '首次使用' : '欢迎回来' }}</p><h1>{{ bootState?.needsSetup ? '创建本机账号' : '登录你的时光' }}</h1></div>
        <label>用户名<input v-model.trim="authForm.username" maxlength="24" autocomplete="username" placeholder="输入用户名" /></label>
        <label>密码<input v-model="authForm.password" type="password" minlength="6" autocomplete="current-password" placeholder="至少 6 位" /></label>
        <button class="primary-button auth-submit" :disabled="submitting"><span>{{ submitting ? '正在处理' : bootState?.needsSetup ? '创建并开始记录' : '进入岁岁时光' }}</span><ArrowRight :size="18" /></button>
        <p v-if="authError" class="form-error">{{ authError }}</p>
      </form>
    </section>

    <template v-else>
      <aside class="sidebar">
        <div class="brand-lockup sidebar-brand"><img src="./assets/brand/sui-time-icon.svg" alt="岁岁时光" /><span>岁岁时光</span></div>
        <div class="account-chip"><div class="avatar">{{ session.displayName.slice(0, 1) }}</div><div><strong>{{ session.displayName }}</strong><small>本地时光簿</small></div><button class="icon-button ghost" title="退出登录" @click="handleLogout"><LogOut :size="17" /></button></div>
        <nav aria-label="主导航">
          <p class="nav-group-title">事项</p>
          <button :class="['nav-item', { active: currentView === 'all' }]" @click="currentView = 'all'"><LayoutGrid :size="18" />全部事项</button>
          <p class="nav-group-title planning-title">规划</p>
          <button :class="['nav-item', { active: currentView === 'week' }]" @click="currentView = 'week'"><CalendarDays :size="18" />我的一周</button>
          <button :class="['nav-item', { active: currentView === 'month' }]" @click="currentView = 'month'"><CalendarRange :size="18" />我的一月</button>
          <p class="nav-group-title planning-title">基础设置</p>
          <button :class="['nav-item', { active: currentView === 'settings' }]" @click="currentView = 'settings'"><Settings2 :size="18" />标签与更新</button>
        </nav>
        <div class="sidebar-foot"><span></span><small>Local-first · v{{ version }}</small></div>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div><p class="eyebrow">{{ viewMeta.kicker }}</p><h1>{{ viewMeta.title }}</h1></div>
          <div class="topbar-actions">
            <template v-if="currentView !== 'settings'">
              <button class="text-icon-button" @click="showCompleted = !showCompleted"><component :is="showCompleted ? EyeOff : Eye" :size="17" />{{ showCompleted ? '隐藏已完成' : '显示已完成' }}</button>
              <button class="primary-button" @click="openTaskModal()"><Plus :size="18" />新建事项</button>
            </template>
          </div>
        </header>

        <section v-if="currentView === 'all'" class="page all-page">
          <div class="toolbar">
            <label class="search-box"><Search :size="18" /><input v-model="search" placeholder="搜索事项或备注" /></label>
            <label class="date-filter">从<input v-model="rangeStart" type="date" /></label>
            <label class="date-filter">至<input v-model="rangeEnd" type="date" /></label>
            <button class="icon-button bordered" title="清除筛选" @click="clearFilters"><RotateCcw :size="17" /></button>
          </div>
          <div class="board-scroll">
            <div class="task-board">
              <section v-for="group in taskGroups" :key="group.id" class="task-column">
                <header class="column-heading"><span class="color-dot" :style="{ backgroundColor: group.color }"></span><strong>{{ group.name }}</strong><small>{{ group.tasks.length }}</small><button class="icon-button ghost add-small" title="在此分类新增事项" @click="openTaskModal(group.id === 'inbox' ? null : group.id)"><Plus :size="17" /></button></header>
                <div class="task-list" @dragover.prevent @drop="dropOnGroup(group.id)">
                  <button v-for="item in group.tasks" :key="item.id" class="task-card" draggable="true" @dragstart="draggedTaskId = item.id" @click="openTaskModal(undefined, item)">
                    <span :class="['task-check', { done: item.status === 'done' }]" @click.stop="toggleItem(item)"><Check :size="13" /></span>
                    <span class="task-copy"><strong>{{ item.title }}</strong><small>{{ taskSummary(item) }}</small></span>
                    <ChevronRight :size="16" class="task-arrow" />
                  </button>
                  <p v-if="!group.tasks.length" class="empty-column">拖入事项，或点击上方加号</p>
                </div>
              </section>
              <button class="add-category" @click="openTagModal()"><Plus :size="18" />添加标签</button>
            </div>
          </div>
        </section>

        <section v-else-if="currentView === 'week'" class="page plan-page">
          <div class="period-bar"><button class="icon-button bordered" title="上一周" @click="moveWeek(-1)"><ChevronLeft :size="18" /></button><button class="period-label" @click="weekAnchor = todayDate">{{ weekLabel }}</button><button class="icon-button bordered" title="下一周" @click="moveWeek(1)"><ChevronRight :size="18" /></button><button class="quiet-button" @click="weekAnchor = todayDate">回到本周</button></div>
          <div class="week-grid">
            <section v-for="day in weekDays" :key="day.date" :class="['week-day', { today: day.date === todayDate }]" @dragover.prevent @drop="dropOnDate(day.date)">
              <header><div><strong>{{ day.weekday }}</strong><span>{{ day.day }}</span></div><button class="icon-button ghost" title="新建当天事项" @click="openTaskModal(undefined, undefined, day.date)"><Plus :size="17" /></button></header>
              <div class="day-task-list"><button v-for="item in tasksForDate(day.date)" :key="item.id" :class="['schedule-card', { done: item.status === 'done' }]" :style="{ '--task-color': item.tagColor || '#7b8794' }" draggable="true" @dragstart="draggedTaskId = item.id" @click="openTaskModal(undefined, item)"><span :class="['task-check', { done: item.status === 'done' }]" @click.stop="toggleItem(item)"><Check :size="12" /></span><span>{{ item.title }}</span><time v-if="item.plannedTime">{{ item.plannedTime }}</time></button></div>
            </section>
          </div>
        </section>

        <section v-else-if="currentView === 'month'" class="page plan-page">
          <div class="period-bar"><button class="icon-button bordered" title="上一个月" @click="moveMonth(-1)"><ChevronLeft :size="18" /></button><button class="period-label" @click="monthAnchor = todayDate">{{ monthLabel }}</button><button class="icon-button bordered" title="下一个月" @click="moveMonth(1)"><ChevronRight :size="18" /></button><button class="quiet-button" @click="monthAnchor = todayDate">回到本月</button></div>
          <div class="month-weekdays"><span v-for="label in weekdayLabels" :key="label">{{ label }}</span></div>
          <div class="month-grid">
            <section v-for="day in monthDays" :key="day.date" :class="['month-day', { muted: !day.inMonth, today: day.date === todayDate }]" @dragover.prevent @drop="dropOnDate(day.date)"><header><time>{{ day.day }}</time><button class="icon-button ghost" title="新建当天事项" @click="openTaskModal(undefined, undefined, day.date)"><Plus :size="15" /></button></header><div class="month-items"><button v-for="item in tasksForDate(day.date).slice(0, 4)" :key="item.id" :class="['month-item', { done: item.status === 'done' }]" :style="{ backgroundColor: item.tagColor || '#8b98a8' }" draggable="true" @dragstart="draggedTaskId = item.id" @click="openTaskModal(undefined, item)"><Check v-if="item.status === 'done'" :size="12" />{{ item.title }}<time v-if="item.plannedTime">{{ item.plannedTime }}</time></button><button v-if="tasksForDate(day.date).length > 4" class="more-items" @click="openTaskModal(undefined, tasksForDate(day.date)[4])">还有 {{ tasksForDate(day.date).length - 4 }} 项</button></div></section>
          </div>
        </section>

        <section v-else class="page settings-page">
          <section class="settings-block"><div class="settings-heading"><div><p class="eyebrow">分类方式</p><h2>标签管理</h2><span>用颜色区分不同生活主题，删除标签不会删除关联事项。</span></div><button class="primary-button" @click="openTagModal()"><Plus :size="18" />新增标签</button></div><div v-if="tags.length" class="tag-table"><div v-for="tag in tags" :key="tag.id" class="tag-row"><span class="tag-swatch" :style="{ backgroundColor: tag.color }"></span><strong>{{ tag.name }}</strong><small>{{ tagTaskCount(tag.id) }} 项事项</small><div><button class="icon-button ghost" title="编辑标签" @click="openTagModal(tag)"><Pencil :size="16" /></button><button class="icon-button ghost danger" title="删除标签" @click="deleteTag(tag)"><Trash2 :size="16" /></button></div></div></div><p v-else class="empty-state">还没有标签。先为工作、生活或兴趣添加一种颜色。</p></section>
          <section class="settings-block update-block"><div class="settings-heading"><div><p class="eyebrow">桌面客户端</p><h2>版本更新</h2><span>安装包发布后，会从独立的岁岁时光更新通道检查新版本。</span></div><button class="primary-button" :disabled="checkingUpdate || installingUpdate" @click="handleUpdate"><RefreshCw :class="{ spinning: checkingUpdate || installingUpdate }" :size="18" />{{ updateButtonLabel }}</button></div><div class="version-detail"><span>当前版本</span><strong>v{{ version }}</strong><span>{{ updateStatus }}</span></div></section>
        </section>
      </section>
    </template>

    <div v-if="taskModalOpen" class="modal-backdrop" @mousedown.self="taskModalOpen = false"><form class="modal-panel task-modal" @submit.prevent="saveTaskForm"><header><div><p class="eyebrow">{{ taskDraft.id ? '编辑事项' : '新的事项' }}</p><h2>{{ taskDraft.id ? '调整这段时光' : '把它记下来' }}</h2></div><button class="icon-button ghost" type="button" title="关闭" @click="taskModalOpen = false"><X :size="20" /></button></header><label class="field wide"><span>事项标题</span><input v-model.trim="taskDraft.title" maxlength="120" autofocus placeholder="例如：完成本周复盘" /></label><div class="form-grid"><label class="field"><span>标签</span><select v-model="taskDraft.tagId"><option value="">未分类</option><option v-for="tag in tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option></select></label><label class="field"><span>计划日期</span><input v-model="taskDraft.plannedDate" type="date" /></label><label class="field"><span>时间</span><input v-model="taskDraft.plannedTime" type="time" /></label></div><label class="field wide"><span>备注</span><textarea v-model.trim="taskDraft.notes" rows="4" maxlength="1000" placeholder="补充一点上下文，给未来的自己。"></textarea></label><footer><button v-if="taskDraft.id" class="quiet-button danger-text" type="button" @click="deleteTaskFromModal">删除事项</button><span></span><button class="quiet-button" type="button" @click="taskModalOpen = false">取消</button><button class="primary-button" :disabled="savingTask">{{ savingTask ? '正在保存' : '保存事项' }}</button></footer></form></div>

    <div v-if="tagModalOpen" class="modal-backdrop" @mousedown.self="tagModalOpen = false"><form class="modal-panel tag-modal" @submit.prevent="saveTagForm"><header><div><p class="eyebrow">{{ tagDraft.id ? '编辑标签' : '新建标签' }}</p><h2>给生活一种颜色</h2></div><button class="icon-button ghost" type="button" title="关闭" @click="tagModalOpen = false"><X :size="20" /></button></header><label class="field wide"><span>标签名称</span><input v-model.trim="tagDraft.name" maxlength="20" autofocus placeholder="例如：阅读" /></label><div class="color-picker"><span>标签颜色</span><button v-for="color in colors" :key="color" :class="['color-choice', { selected: tagDraft.color === color }]" type="button" :style="{ backgroundColor: color }" @click="tagDraft.color = color"><Check :size="15" /></button></div><footer><span></span><button class="quiet-button" type="button" @click="tagModalOpen = false">取消</button><button class="primary-button" :disabled="savingTag">{{ savingTag ? '正在保存' : '保存标签' }}</button></footer></form></div>

    <div v-if="notice" class="notice" :class="notice.type">{{ notice.text }}</div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ArrowRight, CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, Eye, EyeOff, LayoutGrid, LogOut, Pencil, Plus, RefreshCw, RotateCcw, Search, Settings2, Trash2, X } from 'lucide-vue-next'
import { checkAppUpdate, createAccount, currentVersion, getBootState, installAppUpdate, listTags, listTasks, loginUser, logoutUser, removeTag, removeTask, rescheduleTask, saveTag, saveTask, toggleTask } from './api/native'
import type { BootState, Tag, Task, TaskInput, UserSession } from './types'

type View = 'all' | 'week' | 'month' | 'settings'
type Notice = { text: string; type: 'success' | 'error' }

const colors = ['#4D82D5', '#13A66A', '#E97B47', '#B16FC8', '#C79B31', '#D2546D']
const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const booting = ref(true)
const bootState = ref<BootState | null>(null)
const session = ref<UserSession | null>(null)
const currentView = ref<View>('all')
const tags = ref<Tag[]>([])
const tasks = ref<Task[]>([])
const search = ref('')
const rangeStart = ref('')
const rangeEnd = ref('')
const showCompleted = ref(false)
const weekAnchor = ref(todayString())
const monthAnchor = ref(todayString())
const todayDate = todayString()
const draggedTaskId = ref<string | null>(null)
const version = ref('0.1.0')
const notice = ref<Notice | null>(null)
const submitting = ref(false)
const authError = ref('')
const checkingUpdate = ref(false)
const installingUpdate = ref(false)
const updateStatus = ref('尚未检查更新')
const taskModalOpen = ref(false)
const tagModalOpen = ref(false)
const savingTask = ref(false)
const savingTag = ref(false)
const authForm = reactive({ username: '', password: '' })
const taskDraft = reactive<TaskInput>({ title: '', tagId: null, plannedDate: null, plannedTime: null, notes: '' })
const tagDraft = reactive<{ id?: string; name: string; color: string; sortOrder: number }>({ name: '', color: colors[0], sortOrder: 0 })

const viewMeta = computed(() => ({
  all: { kicker: '事项', title: '全部事项' },
  week: { kicker: '规划', title: '我的一周' },
  month: { kicker: '规划', title: '我的一月' },
  settings: { kicker: '基础设置', title: '标签与更新' }
}[currentView.value]))

const visibleTasks = computed(() => tasks.value.filter(item => showCompleted.value || item.status !== 'done'))
const taskGroups = computed(() => [{ id: 'inbox', name: '收集箱', color: '#8793A1', tasks: visibleTasks.value.filter(item => !item.tagId) }, ...tags.value.map(tag => ({ ...tag, tasks: visibleTasks.value.filter(item => item.tagId === tag.id) }))])
const weekDays = computed(() => weekDates(weekAnchor.value).map((date, index) => ({ date, day: Number(date.slice(-2)), weekday: weekdayLabels[index] })))
const monthDays = computed(() => calendarDays(monthAnchor.value))
const weekLabel = computed(() => `${formatMonth(weekDays.value[0].date)} · ${formatMonth(weekDays.value[6].date)}`)
const monthLabel = computed(() => formatMonth(monthAnchor.value))
const updateButtonLabel = computed(() => installingUpdate.value ? '正在安装' : checkingUpdate.value ? '正在检查' : '检查更新')

onMounted(async () => {
  try {
    version.value = await currentVersion()
    bootState.value = await getBootState()
    session.value = bootState.value.session
    if (session.value) await refreshData()
  } catch (error) {
    authError.value = messageOf(error)
  } finally {
    booting.value = false
  }
})

let filterTimer: number | undefined
watch([search, rangeStart, rangeEnd, showCompleted], () => {
  if (!session.value) return
  window.clearTimeout(filterTimer)
  filterTimer = window.setTimeout(() => { void refreshData() }, 180)
})

async function submitAuth() {
  if (!authForm.username || !authForm.password || submitting.value) return
  submitting.value = true
  authError.value = ''
  try {
    const input = { ...authForm }
    session.value = bootState.value?.needsSetup ? await createAccount(input) : await loginUser(input)
    if (bootState.value) bootState.value.needsSetup = false
    await refreshData()
  } catch (error) {
    authError.value = messageOf(error)
  } finally {
    submitting.value = false
  }
}

async function refreshData() {
  const query = { search: search.value || undefined, startDate: rangeStart.value || undefined, endDate: rangeEnd.value || undefined, includeCompleted: showCompleted.value }
  const [nextTags, nextTasks] = await Promise.all([listTags(), listTasks(query)])
  tags.value = nextTags
  tasks.value = nextTasks
}

async function handleLogout() {
  await logoutUser()
  session.value = null
  tasks.value = []
  tags.value = []
  authForm.password = ''
}

function openTaskModal(tagId?: string | null, item?: Task, date?: string) {
  Object.assign(taskDraft, item ? { id: item.id, title: item.title, tagId: item.tagId, plannedDate: item.plannedDate, plannedTime: item.plannedTime, notes: item.notes } : { id: undefined, title: '', tagId: tagId ?? null, plannedDate: date ?? null, plannedTime: null, notes: '' })
  taskModalOpen.value = true
}

async function saveTaskForm() {
  if (!taskDraft.title || savingTask.value) return
  savingTask.value = true
  try {
    await saveTask({ ...taskDraft, tagId: taskDraft.tagId || null, plannedDate: taskDraft.plannedDate || null, plannedTime: taskDraft.plannedTime || null })
    taskModalOpen.value = false
    await refreshData()
    showNotice('事项已保存')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  } finally {
    savingTask.value = false
  }
}

async function deleteTaskFromModal() {
  if (!taskDraft.id || !window.confirm('确定删除这个事项吗？')) return
  try {
    await removeTask(taskDraft.id)
    taskModalOpen.value = false
    await refreshData()
    showNotice('事项已删除')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

async function toggleItem(item: Task) {
  try {
    await toggleTask(item.id)
    await refreshData()
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

function openTagModal(item?: Tag) {
  Object.assign(tagDraft, item ? { id: item.id, name: item.name, color: item.color, sortOrder: item.sortOrder } : { id: undefined, name: '', color: colors[tags.value.length % colors.length], sortOrder: tags.value.length })
  tagModalOpen.value = true
}

async function saveTagForm() {
  if (!tagDraft.name || savingTag.value) return
  savingTag.value = true
  try {
    await saveTag({ ...tagDraft })
    tagModalOpen.value = false
    await refreshData()
    showNotice('标签已保存')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  } finally {
    savingTag.value = false
  }
}

async function deleteTag(tag: Tag) {
  if (!window.confirm(`删除“${tag.name}”后，关联事项将变为未分类。是否继续？`)) return
  try {
    await removeTag(tag.id)
    await refreshData()
    showNotice('标签已删除，关联事项已保留')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

async function dropOnDate(date: string) {
  if (!draggedTaskId.value) return
  try {
    await rescheduleTask(draggedTaskId.value, date)
    await refreshData()
  } catch (error) {
    showNotice(messageOf(error), 'error')
  } finally {
    draggedTaskId.value = null
  }
}

async function dropOnGroup(groupId: string) {
  const item = tasks.value.find(task => task.id === draggedTaskId.value)
  if (!item) return
  try {
    await saveTask({ id: item.id, title: item.title, tagId: groupId === 'inbox' ? null : groupId, plannedDate: item.plannedDate, plannedTime: item.plannedTime, notes: item.notes })
    await refreshData()
  } catch (error) {
    showNotice(messageOf(error), 'error')
  } finally {
    draggedTaskId.value = null
  }
}

async function handleUpdate() {
  checkingUpdate.value = true
  updateStatus.value = '正在连接更新通道…'
  try {
    const update = await checkAppUpdate()
    if (!update) { updateStatus.value = '当前已经是最新版本'; return }
    if (!window.confirm(`发现新版本 ${update.version}，现在下载并安装吗？`)) { updateStatus.value = `发现新版本 ${update.version}`; return }
    checkingUpdate.value = false
    installingUpdate.value = true
    updateStatus.value = `正在下载 ${update.version}…`
    await installAppUpdate(update, event => {
      if (event.event === 'Progress') updateStatus.value = '正在下载安装包…'
      if (event.event === 'Finished') updateStatus.value = '安装完成，正在重启…'
    })
  } catch (error) {
    updateStatus.value = `更新失败：${messageOf(error)}`
  } finally {
    checkingUpdate.value = false
    installingUpdate.value = false
  }
}

function tasksForDate(date: string) { return visibleTasks.value.filter(item => item.plannedDate === date) }
function tagTaskCount(tagId: string) { return tasks.value.filter(item => item.tagId === tagId).length }
function taskSummary(item: Task) { return [item.plannedDate ? item.plannedDate.slice(5).replace('-', '月') + '日' : '未安排日期', item.plannedTime || '', item.notes ? '有备注' : ''].filter(Boolean).join(' · ') }
function clearFilters() { search.value = ''; rangeStart.value = ''; rangeEnd.value = ''; refreshData() }
function moveWeek(offset: number) { weekAnchor.value = addDays(weekAnchor.value, offset * 7) }
function moveMonth(offset: number) { const date = parseDate(monthAnchor.value); date.setMonth(date.getMonth() + offset); monthAnchor.value = dateString(date) }
function showNotice(text: string, type: Notice['type'] = 'success') { notice.value = { text, type }; window.setTimeout(() => { notice.value = null }, 2800) }
function messageOf(error: unknown) { return String(error).replace(/^Error:\s*/, '') || '操作失败，请稍后重试' }

function todayString() { return dateString(new Date()) }
function dateString(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function parseDate(value: string) { return new Date(`${value}T12:00:00`) }
function addDays(value: string, amount: number) { const date = parseDate(value); date.setDate(date.getDate() + amount); return dateString(date) }
function weekDates(value: string) { const anchor = parseDate(value); const offset = (anchor.getDay() + 6) % 7; anchor.setDate(anchor.getDate() - offset); return Array.from({ length: 7 }, (_, index) => { const day = new Date(anchor); day.setDate(anchor.getDate() + index); return dateString(day) }) }
function calendarDays(value: string) { const anchor = parseDate(value); const year = anchor.getFullYear(); const month = anchor.getMonth(); const first = new Date(year, month, 1); const offset = (first.getDay() + 6) % 7; const start = new Date(year, month, 1 - offset); return Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return { date: dateString(day), day: day.getDate(), inMonth: day.getMonth() === month } }) }
function formatMonth(value: string) { const date = parseDate(value); return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月` }
</script>
