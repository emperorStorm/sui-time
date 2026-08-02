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
        <div ref="brandMenu" class="sidebar-top">
          <button class="brand-menu-trigger" type="button" :aria-expanded="brandMenuOpen" title="账户与应用设置" @click="brandMenuOpen = !brandMenuOpen"><img src="./assets/brand/sui-time-icon.svg" alt="" /></button>
          <span class="sidebar-brand-title">岁岁时光</span>
          <AppNotificationCenter ref="notificationCenter" />
          <button class="icon-button sidebar-refresh" type="button" title="回到今天并刷新数据" @click="resetCurrentDate"><RefreshCw :size="16" /></button>
          <section v-if="brandMenuOpen" class="brand-menu" aria-label="账户与应用设置">
            <div class="brand-menu-profile"><span class="avatar">{{ session.displayName.slice(0, 1) }}</span><div><strong>{{ session.displayName }}</strong><small>本地时光簿</small></div></div>
            <div class="brand-menu-list"><button type="button" @click="openBrandMenuView('tags')"><Tags :size="16" />标签管理</button><button type="button" @click="openBrandMenuView('about')"><Info :size="16" />关于岁岁时光</button></div>
            <button class="brand-menu-logout" type="button" @click="handleLogout"><LogOut :size="16" />退出登录</button>
          </section>
        </div>
        <nav aria-label="主导航">
          <p class="nav-group-title">事项</p>
          <button :class="['nav-item', { active: currentView === 'all' }]" @click="currentView = 'all'"><LayoutGrid :size="18" />全部事项</button>
          <p class="nav-group-title planning-title">规划</p>
          <button :class="['nav-item', { active: currentView === 'week' }]" @click="currentView = 'week'"><CalendarDays :size="18" />我的一周</button>
          <button :class="['nav-item', { active: currentView === 'month' }]" @click="currentView = 'month'"><CalendarRange :size="18" />我的一月</button>
          <p class="nav-group-title planning-title">基础设置</p>
          <button :class="['nav-item', { active: currentView === 'tags' }]" @click="currentView = 'tags'"><Tags :size="18" />标签管理</button>
        </nav>
        <div class="sidebar-foot"><span></span><small>Local-first · v{{ version }}</small></div>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div class="topbar-title"><p>{{ viewMeta.subtitle }}</p><h1>{{ viewMeta.title }}</h1></div>
          <div class="topbar-actions">
            <template v-if="currentView !== 'tags' && currentView !== 'about'">
              <button class="text-icon-button" @click="showCompleted = !showCompleted"><component :is="showCompleted ? EyeOff : Eye" :size="17" />{{ showCompleted ? '隐藏已完成' : '显示已完成' }}</button>
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
                <header class="column-heading"><span class="color-dot" :style="{ backgroundColor: group.color }"></span><strong>{{ group.name }}</strong><small>{{ group.tasks.length }}</small><button class="icon-button ghost add-small" title="在此分类新增事项" @click="openTaskModal(group.id)"><Plus :size="17" /></button></header>
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
          <div class="period-bar"><button class="icon-button bordered" title="上一周" @click="moveWeek(-1)"><ChevronLeft :size="18" /></button><button class="period-label" @click="resetCurrentDate">{{ weekLabel }}</button><button class="icon-button bordered" title="下一周" @click="moveWeek(1)"><ChevronRight :size="18" /></button><button class="period-today-button" @click="resetCurrentDate"><CalendarDays :size="15" />回到本周</button></div>
          <div class="week-grid">
            <section v-for="day in weekDays" :key="day.date" :class="['week-day', { today: day.date === todayDate }]" @dragover.prevent @drop="dropOnDate(day.date)">
              <header><span class="week-day-number">{{ day.day }}</span><strong>{{ day.weekday }}</strong><button class="icon-button ghost" title="新建当天事项" @click="openTaskModal(undefined, undefined, day.date)"><Plus :size="17" /></button></header>
              <div class="day-task-list"><button v-for="item in tasksForDate(day.date)" :key="item.id" :class="['schedule-card', { done: item.status === 'done' }]" :style="{ '--task-color': item.tagColor || '#7b8794' }" draggable="true" @dragstart="draggedTaskId = item.id" @click="openTaskModal(undefined, item)"><span :class="['task-check', { done: item.status === 'done' }]" @click.stop="toggleItem(item)"><Check :size="12" /></span><span>{{ item.title }}</span><time v-if="item.plannedTime">{{ item.plannedTime }}</time></button></div>
            </section>
          </div>
        </section>

        <section v-else-if="currentView === 'month'" class="page plan-page">
          <div class="period-bar"><button class="icon-button bordered" title="上一个月" @click="moveMonth(-1)"><ChevronLeft :size="18" /></button><button class="period-label" @click="resetCurrentDate">{{ monthLabel }}</button><button class="icon-button bordered" title="下一个月" @click="moveMonth(1)"><ChevronRight :size="18" /></button><button class="period-today-button" @click="resetCurrentDate"><CalendarRange :size="15" />回到本月</button></div>
          <div class="month-weekdays"><span v-for="label in weekdayLabels" :key="label">{{ label }}</span></div>
          <div class="month-grid">
            <section v-for="day in monthDays" :key="day.date" :class="['month-day', { muted: !day.inMonth, today: day.date === todayDate }]" @dragover.prevent @drop="dropOnDate(day.date)"><header><time>{{ day.day }}</time><button class="icon-button ghost" title="新建当天事项" @click="openTaskModal(undefined, undefined, day.date)"><Plus :size="15" /></button></header><div class="month-items"><button v-for="item in tasksForDate(day.date).slice(0, 4)" :key="item.id" :class="['month-item', { done: item.status === 'done' }]" :style="{ backgroundColor: item.tagColor || '#8b98a8' }" draggable="true" @dragstart="draggedTaskId = item.id" @click="openTaskModal(undefined, item)"><Check v-if="item.status === 'done'" :size="12" />{{ item.title }}<time v-if="item.plannedTime">{{ item.plannedTime }}</time></button><button v-if="tasksForDate(day.date).length > 4" class="more-items" @click="openTaskModal(undefined, tasksForDate(day.date)[4])">还有 {{ tasksForDate(day.date).length - 4 }} 项</button></div></section>
          </div>
        </section>

        <section v-else-if="currentView === 'tags'" class="page settings-page">
          <section class="settings-block"><div class="settings-heading"><div><p class="eyebrow">分类方式</p><h2>标签管理</h2><span>用颜色区分不同生活主题，删除标签不会删除关联事项。</span></div><button class="primary-button" @click="openTagModal()"><Plus :size="18" />新增标签</button></div><div v-if="tags.length" class="tag-table"><div v-for="tag in tags" :key="tag.id" class="tag-row"><span class="tag-swatch" :style="{ backgroundColor: tag.color }"></span><strong>{{ tag.name }}</strong><small>{{ tagTaskCount(tag.id) }} 项事项</small><div><button class="icon-button ghost" title="编辑标签" @click="openTagModal(tag)"><Pencil :size="16" /></button><button class="icon-button ghost danger" title="删除标签" @click="deleteTag(tag)"><Trash2 :size="16" /></button></div></div></div><p v-else class="empty-state">还没有标签。先为工作、生活或兴趣添加一种颜色。</p></section>
        </section>

        <section v-else class="page settings-page">
          <section class="settings-block update-block"><div class="settings-heading"><div><p class="eyebrow">桌面客户端</p><h2>关于岁岁时光</h2><span>岁岁时光是一个本地优先的个人待办与时间规划应用。安装包发布后，可在此检查新版本。</span></div><button class="primary-button" :disabled="checkingUpdate" @click="handleUpdate"><RefreshCw :class="{ spinning: checkingUpdate }" :size="18" />{{ updateButtonLabel }}</button></div><div class="version-detail"><span>当前版本</span><strong>v{{ version }}</strong><span>{{ updateStatus }}</span></div></section>
          <section class="settings-block"><div class="settings-heading"><div><p class="eyebrow">本地数据</p><h2>加密备份</h2><span>导出的备份包含本机账号、标签和事项。恢复前会自动保存一份加密回滚备份，恢复完成后应用将重新载入。</span></div><div class="data-actions"><button class="quiet-button" @click="openBackupModal('export')"><Download :size="17" />导出备份</button><button class="primary-button" @click="openBackupModal('restore')"><Upload :size="17" />恢复备份</button></div></div></section>
        </section>
      </section>
      <button class="floating-add" type="button" title="新建事项" aria-label="新建事项" @click="openTaskModal()"><Plus :size="28" /></button>
    </template>

    <div v-if="taskModalOpen" class="modal-backdrop task-backdrop" @mousedown.self="closeTaskModal">
      <form class="modal-panel task-modal" @submit.prevent="saveTaskForm">
        <header class="task-modal-head"><span class="task-check modal-check"><Check :size="14" /></span><input v-model.trim="taskDraft.title" maxlength="120" autofocus placeholder="输入事项名称" /><div class="task-head-actions"><button :class="['priority-trigger', `priority-${taskDraft.priority}`]" type="button" :title="`优先级：${priorityLabel(taskDraft.priority)}`" :aria-label="`设置优先级，当前${priorityLabel(taskDraft.priority)}`" @click="priorityOpen = !priorityOpen"><Flag :size="18" /><span></span></button><button class="icon-button ghost" type="button" title="关闭" @click="closeTaskModal"><X :size="20" /></button></div></header>
        <div v-if="priorityOpen" class="priority-menu"><button v-for="option in priorityOptions" :key="option.value" :class="option.value" type="button" @click="taskDraft.priority = option.value; priorityOpen = false"><span>{{ option.mark }}</span>{{ option.label }}<Check v-if="taskDraft.priority === option.value" :size="16" /></button></div>
        <section class="task-meta-list" aria-label="事项属性"><button type="button" class="task-meta-row" @click="timeOpen = true"><AlarmClock :size="20" /><span><small>日期与时间</small><strong>{{ timeSummary }}</strong></span><ChevronRight :size="18" /></button><button type="button" class="task-meta-row" @click="repeatOpen = true"><CircleDot :size="20" /><span><small>重复</small><strong>{{ repeatSummary }}</strong></span><ChevronRight :size="18" /></button><label class="task-meta-row"><Tags :size="20" /><span><small>标签</small></span><select v-model="taskDraft.tagId" aria-label="选择标签"><option v-for="tag in tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option></select></label></section>
        <section class="subtask-section" :style="{ '--subtask-color': tags.find(tag => tag.id === taskDraft.tagId)?.color || '#51886D' }"><div class="section-label">子事项</div><div class="subtask-list"><div v-for="subtask in childDrafts" :key="subtask.id" class="subtask-row"><button type="button" :class="['task-check', { done: subtask.status === 'done' }]" @click="subtask.status = subtask.status === 'done' ? 'todo' : 'done'"><Check :size="13" /></button><input v-model.trim="subtask.title" maxlength="120" placeholder="子事项" /><button type="button" class="subtask-remove" title="删除子事项" @click="removeChildDraft(subtask.id)"><X :size="16" /></button></div></div><button type="button" class="add-subtask" @click="addChildDraft"><Plus :size="20" />添加子事项</button></section>
        <label class="notes-editor"><span class="section-label">备注</span><textarea v-model.trim="taskDraft.notes" rows="5" maxlength="1000" placeholder="补充一点上下文，给未来的自己。"></textarea></label>
        <footer><button v-if="taskDraft.id" class="quiet-button danger-text" type="button" @click="deleteTaskFromModal">删除</button><span></span><button class="quiet-button" type="button" @click="closeTaskModal">取消</button><button class="primary-button" :disabled="savingTask">{{ savingTask ? '正在保存' : '保存' }}</button></footer>
      </form>
    </div>

    <div v-if="timeOpen" class="modal-backdrop nested-backdrop" @mousedown.self="timeOpen = false"><section class="time-sheet"><div class="sheet-tabs"><button v-for="kind in scheduleOptions" :key="kind.value" :class="{ active: taskDraft.scheduleKind === kind.value }" @click="taskDraft.scheduleKind = kind.value">{{ kind.label }}</button></div><label>日期<input v-model="taskDraft.plannedDate" type="date" /></label><label v-if="taskDraft.scheduleKind === 'point'">时间<input v-model="taskDraft.plannedTime" type="time" /></label><div v-if="taskDraft.scheduleKind === 'range'" class="time-range"><label>开始<input v-model="taskDraft.plannedTime" type="time" /></label><label>结束<input v-model="taskDraft.plannedEndTime" type="time" /></label></div><footer><button class="quiet-button" @click="clearTime">清除时间</button><span></span><button class="quiet-button" @click="timeOpen = false">取消</button><button class="primary-button" @click="timeOpen = false">保存</button></footer></section></div>

    <div v-if="repeatOpen" class="modal-backdrop nested-backdrop" @mousedown.self="repeatOpen = false"><section class="repeat-sheet"><header><button class="quiet-button" @click="repeatOpen = false">取消</button><h2>选择重复</h2><span></span></header><div class="repeat-list"><button v-for="option in repeatOptions" :key="option.value" :class="{ selected: repeatDraft.kind === option.value }" @click="chooseRepeat(option.value)"><div><strong>{{ option.label }}</strong><small>{{ option.hint }}</small></div><Check v-if="repeatDraft.kind === option.value" :size="18" /></button></div><div v-if="repeatDraft.kind !== 'none'" class="repeat-config"><label v-if="needsInterval">每隔<input v-model.number="repeatDraft.interval" min="1" max="365" type="number" />天</label><label>结束<select v-model="repeatDraft.endMode"><option value="never">永不结束</option><option value="date">指定日期</option><option value="count">固定次数</option></select></label><label v-if="repeatDraft.endMode === 'date'">结束日期<input v-model="repeatDraft.endDate" type="date" /></label><label v-if="repeatDraft.endMode === 'count'">次数<input v-model.number="repeatDraft.count" min="1" max="999" type="number" /></label></div><footer><span></span><button class="primary-button" @click="applyRepeat">保存规则</button></footer></section></div>

    <div v-if="tagModalOpen" class="modal-backdrop" @mousedown.self="tagModalOpen = false"><form class="modal-panel tag-modal" @submit.prevent="saveTagForm"><header><div><p class="eyebrow">{{ tagDraft.id ? '编辑标签' : '新建标签' }}</p><h2>给生活一种颜色</h2></div><button class="icon-button ghost" type="button" title="关闭" @click="tagModalOpen = false"><X :size="20" /></button></header><label class="field wide"><span>标签名称</span><input v-model.trim="tagDraft.name" maxlength="20" autofocus placeholder="例如：阅读" /></label><div class="color-picker"><span>标签颜色</span><button v-for="color in colors" :key="color" :class="['color-choice', { selected: tagDraft.color === color }]" type="button" :style="{ backgroundColor: color }" @click="tagDraft.color = color"><Check :size="15" /></button></div><footer><span></span><button class="quiet-button" type="button" @click="tagModalOpen = false">取消</button><button class="primary-button" :disabled="savingTag">{{ savingTag ? '正在保存' : '保存标签' }}</button></footer></form></div>

    <div v-if="backupModalOpen" class="modal-backdrop" @mousedown.self="closeBackupModal"><form class="modal-panel backup-modal" @submit.prevent="submitBackup"><header><div><p class="eyebrow">{{ backupMode === 'export' ? '导出加密备份' : '恢复加密备份' }}</p><h2>{{ backupMode === 'export' ? '留一份安心的副本' : '从备份恢复数据' }}</h2></div><button class="icon-button ghost" type="button" title="关闭" @click="closeBackupModal"><X :size="20" /></button></header><p class="backup-tip">{{ backupMode === 'export' ? '请设置至少 8 位的备份密码。密码无法找回。' : '请选择此前导出的备份文件，并输入它的备份密码。' }}</p><label class="field wide"><span>备份密码</span><input v-model="backupPassword" type="password" minlength="8" autocomplete="new-password" autofocus placeholder="至少 8 位" /></label><label v-if="backupMode === 'export'" class="field wide"><span>确认备份密码</span><input v-model="backupPasswordConfirmation" type="password" minlength="8" autocomplete="new-password" placeholder="再次输入备份密码" /></label><p v-if="backupError" class="form-error">{{ backupError }}</p><footer><span></span><button class="quiet-button" type="button" :disabled="backupInProgress" @click="closeBackupModal">取消</button><button class="primary-button" :disabled="backupInProgress">{{ backupInProgress ? '正在处理' : backupMode === 'export' ? '选择位置并导出' : '选择备份并恢复' }}</button></footer></form></div>

    <div v-if="notice" class="notice" :class="notice.type">{{ notice.text }}</div>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AlarmClock, ArrowRight, CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, CircleDot, Download, Eye, EyeOff, Flag, Info, LayoutGrid, LogOut, Pencil, Plus, RefreshCw, RotateCcw, Search, Tags, Trash2, Upload, X } from 'lucide-vue-next'
import { createAccount, currentVersion, exportEncryptedBackup, formatUpdateError, getBootState, listTags, listTasks, loginUser, logoutUser, removeTag, removeTask, rescheduleTask, restoreEncryptedBackup, saveTag, saveTask, toggleTask } from './api/native'
import type { UpdateCheckResult } from './api/native'
import AppNotificationCenter from './components/AppNotificationCenter.vue'
import type { BootState, Priority, RepeatRule, ScheduleKind, Tag, Task, TaskInput, UserSession } from './types'

type View = 'all' | 'week' | 'month' | 'tags' | 'about'
type Notice = { text: string; type: 'success' | 'error' }

const colors = ['#6C9E7E', '#7598A6', '#E69A62', '#BC7C93', '#B79B52', '#639D98']
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
const todayDate = ref(todayString())
const draggedTaskId = ref<string | null>(null)
const version = ref('0.1.8')
const notice = ref<Notice | null>(null)
const submitting = ref(false)
const authError = ref('')
const checkingUpdate = ref(false)
const updateStatus = ref('尚未检查更新')
const notificationCenter = ref<{ checkForUpdate: (openWhenFound?: boolean) => Promise<UpdateCheckResult | null> } | null>(null)
const brandMenu = ref<HTMLElement | null>(null)
const brandMenuOpen = ref(false)
const taskModalOpen = ref(false)
const tagModalOpen = ref(false)
const backupModalOpen = ref(false)
const backupMode = ref<'export' | 'restore'>('export')
const backupPassword = ref('')
const backupPasswordConfirmation = ref('')
const backupError = ref('')
const backupInProgress = ref(false)
const savingTask = ref(false)
const savingTag = ref(false)
const authForm = reactive({ username: '', password: '' })
const taskDraft = reactive<TaskInput>({ title: '', tagId: null, plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day', priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', occurrenceOverrides: '{}', parentTaskId: null, notes: '' })
const tagDraft = reactive<{ id?: string; name: string; color: string; sortOrder: number }>({ name: '', color: colors[0], sortOrder: 0 })
const priorityOpen = ref(false)
const timeOpen = ref(false)
const repeatOpen = ref(false)
const childDrafts = ref<Task[]>([])
const priorityOptions: Array<{ value: Priority; label: string; mark: string }> = [
  { value: 'urgent_important', label: '重要且紧急', mark: 'I' }, { value: 'important_not_urgent', label: '重要不紧急', mark: 'II' },
  { value: 'urgent_not_important', label: '不重要但紧急', mark: 'III' }, { value: 'not_urgent_not_important', label: '不重要不紧急', mark: 'IV' }
]
const scheduleOptions: Array<{ value: ScheduleKind; label: string }> = [{ value: 'point', label: '时间点' }, { value: 'range', label: '时间段' }, { value: 'all_day', label: '全天' }]
const repeatOptions: Array<{ value: RepeatRule['kind']; label: string; hint: string }> = [
  { value: 'none', label: '不重复', hint: '' }, { value: 'daily', label: '每天', hint: '每天重复' }, { value: 'every_days', label: '任意多天', hint: '按天数间隔' }, { value: 'weekly', label: '每周', hint: '每周同一天' }, { value: 'weekly_slots', label: '每周（不同天、不同时间）', hint: '可配置多个时段' }, { value: 'workdays', label: '每周工作日', hint: '周一至周五' }, { value: 'monthly', label: '每月', hint: '每月同一天' }, { value: 'monthly_slots', label: '每月（不同天、不同时间）', hint: '可配置多个日期' }, { value: 'yearly', label: '每年', hint: '每年同一天' }, { value: 'memory', label: '记忆曲线', hint: '1、2、4、7、15 天' }, { value: 'custom', label: '自定义', hint: '按自定义周期重复' }
]
const repeatDraft = reactive<RepeatRule>({ kind: 'none', interval: 1, endMode: 'never' })
const editingOccurrence = ref<{ source: Task; date: string } | null>(null)

const viewMeta = computed(() => ({
  all: { title: '全部事项', subtitle: 'TODAY, TAKE IT GENTLY' },
  week: { title: '我的一周', subtitle: 'A WEEK AT A GLANCE' },
  month: { title: '我的一月', subtitle: 'MAKE ROOM FOR WHAT MATTERS' },
  tags: { title: '标签管理', subtitle: 'COLOR YOUR EVERYDAY' },
  about: { title: '关于岁岁时光', subtitle: 'YOUR LOCAL TIMEBOOK' }
}[currentView.value]))

const visibleTasks = computed(() => tasks.value.filter(item => !item.parentTaskId && (showCompleted.value || item.status !== 'done')))
const taskGroups = computed(() => tags.value.map(tag => ({ ...tag, tasks: visibleTasks.value.filter(item => item.tagId === tag.id) })))
const weekDays = computed(() => weekDates(weekAnchor.value).map((date, index) => ({ date, day: Number(date.slice(-2)), weekday: weekdayLabels[index] })))
const monthDays = computed(() => calendarDays(monthAnchor.value))
const weekLabel = computed(() => formatMonth(weekAnchor.value))
const monthLabel = computed(() => formatMonth(monthAnchor.value))
const updateButtonLabel = computed(() => checkingUpdate.value ? '正在检查' : '检查更新')
const timeSummary = computed(() => taskDraft.scheduleKind === 'all_day' ? (taskDraft.plannedDate || '设置时间') : taskDraft.scheduleKind === 'range' ? `${taskDraft.plannedDate || '未设日期'} ${taskDraft.plannedTime || '--:--'}-${taskDraft.plannedEndTime || '--:--'}` : `${taskDraft.plannedDate || '未设日期'} ${taskDraft.plannedTime || '未设时间'}`)
const repeatSummary = computed(() => repeatOptions.find(option => option.value === repeatDraft.kind)?.label || '添加重复')
const needsInterval = computed(() => ['every_days', 'custom'].includes(repeatDraft.kind))

onMounted(async () => {
  document.addEventListener('mousedown', closeBrandMenuOnOutsideClick)
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

onBeforeUnmount(() => document.removeEventListener('mousedown', closeBrandMenuOnOutsideClick))

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
  brandMenuOpen.value = false
  await logoutUser()
  session.value = null
  tasks.value = []
  tags.value = []
  authForm.password = ''
}

function openBrandMenuView(view: 'tags' | 'about') {
  currentView.value = view
  brandMenuOpen.value = false
}

function closeBrandMenuOnOutsideClick(event: MouseEvent) {
  if (brandMenu.value && !brandMenu.value.contains(event.target as Node)) brandMenuOpen.value = false
}

async function resetCurrentDate() {
  const currentDate = todayString()
  todayDate.value = currentDate
  weekAnchor.value = currentDate
  monthAnchor.value = currentDate
  try {
    await refreshData()
    showNotice('已回到今天')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

function openTaskModal(tagId?: string | null, item?: Task, date?: string) {
  editingOccurrence.value = item?.id.includes('@') ? { source: tasks.value.find(task => task.id === item.id.split('@')[0]) || item, date: item.plannedDate || '' } : null
  Object.assign(taskDraft, item ? { id: item.id, title: item.title, tagId: item.tagId, plannedDate: item.plannedDate, plannedTime: item.plannedTime, plannedEndTime: item.plannedEndTime, scheduleKind: item.scheduleKind, priority: item.priority, repeatRule: item.repeatRule, occurrenceOverrides: item.occurrenceOverrides, parentTaskId: item.parentTaskId, notes: item.notes } : { id: undefined, title: '', tagId: tagId ?? tags.value[0]?.id ?? null, plannedDate: date ?? null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day', priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', occurrenceOverrides: '{}', parentTaskId: null, notes: '' })
  Object.assign(repeatDraft, parseRepeatRule(taskDraft.repeatRule))
  childDrafts.value = item ? tasks.value.filter(task => task.parentTaskId === item.id).map(task => ({ ...task })) : []
  priorityOpen.value = false
  taskModalOpen.value = true
}

async function saveTaskForm() {
  if (!taskDraft.title || savingTask.value) return
  if (!taskDraft.parentTaskId && !taskDraft.tagId) {
    showNotice('请先创建标签，再添加事项', 'error')
    return
  }
  savingTask.value = true
  try {
    if (taskDraft.scheduleKind === 'range' && (!taskDraft.plannedTime || !taskDraft.plannedEndTime || taskDraft.plannedTime >= taskDraft.plannedEndTime)) throw new Error('时间段的结束时间必须晚于开始时间')
    const taskInput = { ...taskDraft, tagId: taskDraft.tagId || null, plannedDate: taskDraft.plannedDate || null, plannedTime: taskDraft.scheduleKind === 'all_day' ? null : taskDraft.plannedTime || null, plannedEndTime: taskDraft.scheduleKind === 'range' ? taskDraft.plannedEndTime || null : null, repeatRule: JSON.stringify(repeatDraft) }
    const saved = editingOccurrence.value ? await saveOccurrence(editingOccurrence.value.source, editingOccurrence.value.date, taskInput) : await saveTask(taskInput)
    await Promise.all(childDrafts.value.filter(item => item.title.trim()).map(item => saveTask({ id: item.id, title: item.title, tagId: null, plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day', priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', occurrenceOverrides: '{}', parentTaskId: saved.id, notes: '', })))
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
    if (editingOccurrence.value) await saveOccurrence(editingOccurrence.value.source, editingOccurrence.value.date, { ...editingOccurrence.value.source, occurrenceOverrides: JSON.stringify({ ...parseOverrides(editingOccurrence.value.source), [editingOccurrence.value.date]: { deleted: true } }) })
    else await removeTask(taskDraft.id)
    taskModalOpen.value = false
    await refreshData()
    showNotice('事项已删除')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

async function toggleItem(item: Task) {
  try {
    if (item.id.includes('@')) {
      const source = tasks.value.find(task => task.id === item.id.split('@')[0])
      if (!source || !item.plannedDate) return
      const overrides = parseOverrides(source)
      overrides[item.plannedDate] = { ...overrides[item.plannedDate], status: item.status === 'done' ? 'todo' : 'done' }
      await saveTask({ ...source, occurrenceOverrides: JSON.stringify(overrides) })
    } else await toggleTask(item.id)
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
    if (draggedTaskId.value.includes('@')) {
      const [sourceId, occurrenceDate] = draggedTaskId.value.split('@')
      const source = tasks.value.find(item => item.id === sourceId)
      if (!source) return
      const overrides = parseOverrides(source)
      overrides[occurrenceDate] = { ...overrides[occurrenceDate], deleted: true, plannedDate: date }
      await saveTask({ ...source, occurrenceOverrides: JSON.stringify(overrides) })
    } else await rescheduleTask(draggedTaskId.value, date)
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
    await saveTask({ id: item.id, title: item.title, tagId: groupId, plannedDate: item.plannedDate, plannedTime: item.plannedTime, plannedEndTime: item.plannedEndTime, scheduleKind: item.scheduleKind, priority: item.priority, repeatRule: item.repeatRule, occurrenceOverrides: item.occurrenceOverrides, parentTaskId: item.parentTaskId, notes: item.notes })
    await refreshData()
  } catch (error) {
    showNotice(messageOf(error), 'error')
  } finally {
    draggedTaskId.value = null
  }
}

async function handleUpdate() {
  if (checkingUpdate.value || !notificationCenter.value) return
  checkingUpdate.value = true
  updateStatus.value = '正在连接更新通道…'
  try {
    const result = await notificationCenter.value.checkForUpdate(true)
    if (!result) return
    version.value = result.currentVersion
    updateStatus.value = result.update ? `发现新版本 ${result.update.version}` : '当前已经是最新版本'
  } catch (error) {
    updateStatus.value = `检查失败：${formatUpdateError(error)}`
  } finally {
    checkingUpdate.value = false
  }
}

function openBackupModal(mode: 'export' | 'restore') {
  backupMode.value = mode
  backupPassword.value = ''
  backupPasswordConfirmation.value = ''
  backupError.value = ''
  backupModalOpen.value = true
}

function closeBackupModal() {
  if (backupInProgress.value) return
  backupModalOpen.value = false
}

async function submitBackup() {
  if (backupInProgress.value) return
  if (backupPassword.value.length < 8) {
    backupError.value = '备份密码至少需要 8 位'
    return
  }
  if (backupMode.value === 'export' && backupPassword.value !== backupPasswordConfirmation.value) {
    backupError.value = '两次输入的备份密码不一致'
    return
  }
  backupInProgress.value = true
  backupError.value = ''
  try {
    const result = backupMode.value === 'export'
      ? await exportEncryptedBackup(backupPassword.value)
      : await restoreEncryptedBackup(backupPassword.value)
    if (!result) return
    backupModalOpen.value = false
    if (backupMode.value === 'restore') {
      showNotice('数据已恢复，正在重新载入应用')
      window.setTimeout(() => window.location.reload(), 450)
      return
    }
    showNotice('加密备份已导出')
  } catch (error) {
    backupError.value = messageOf(error)
  } finally {
    backupInProgress.value = false
  }
}

function tasksForDate(date: string) { return visibleTasks.value.flatMap(item => {
  if (item.parentTaskId) return []
  const overrides = parseOverrides(item)
  const result: Task[] = []
  if (occursOn(item, date) && !overrides[date]?.deleted) result.push({ ...item, ...overrides[date], id: item.plannedDate === date ? item.id : `${item.id}@${date}`, plannedDate: date })
  Object.entries(overrides).forEach(([sourceDate, override]) => { if (override.plannedDate === date && sourceDate !== date && occursOn(item, sourceDate)) result.push({ ...item, ...override, id: `${item.id}@${sourceDate}`, plannedDate: date }) })
  return result
}) }
function tagTaskCount(tagId: string) { return tasks.value.filter(item => item.tagId === tagId).length }
function taskSummary(item: Task) { return [item.plannedDate ? item.plannedDate.slice(5).replace('-', '月') + '日' : '未安排日期', item.plannedTime || '', item.notes ? '有备注' : ''].filter(Boolean).join(' · ') }
function clearFilters() { search.value = ''; rangeStart.value = ''; rangeEnd.value = ''; refreshData() }
function closeTaskModal() { taskModalOpen.value = false; priorityOpen.value = false; timeOpen.value = false; repeatOpen.value = false }
function clearTime() { taskDraft.plannedDate = null; taskDraft.plannedTime = null; taskDraft.plannedEndTime = null; taskDraft.scheduleKind = 'all_day' }
function priorityLabel(priority: Priority) { return priorityOptions.find(option => option.value === priority)?.label || '设置优先级' }
function parseRepeatRule(value: string): RepeatRule { try { const rule = JSON.parse(value) as RepeatRule; return rule?.kind ? { interval: 1, endMode: 'never', ...rule } : { kind: 'none' } } catch { return { kind: 'none' } } }
function parseOverrides(item: Task): Record<string, Partial<Task> & { deleted?: boolean }> { try { return JSON.parse(item.occurrenceOverrides || '{}') } catch { return {} } }
async function saveOccurrence(source: Task, date: string, input: TaskInput) { const overrides = parseOverrides(source); overrides[date] = { ...overrides[date], title: input.title, tagId: input.tagId, plannedTime: input.plannedTime, plannedEndTime: input.plannedEndTime, scheduleKind: input.scheduleKind, priority: input.priority, notes: input.notes }; return saveTask({ ...source, occurrenceOverrides: JSON.stringify(overrides) }) }
function chooseRepeat(kind: RepeatRule['kind']) { repeatDraft.kind = kind; if (!repeatDraft.endMode) repeatDraft.endMode = 'never' }
function applyRepeat() { taskDraft.repeatRule = JSON.stringify(repeatDraft); repeatOpen.value = false }
function addChildDraft() { const now = Date.now(); childDrafts.value.push({ id: crypto.randomUUID(), title: '', tagId: null, tagName: null, tagColor: null, plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day', priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', occurrenceOverrides: '{}', parentTaskId: taskDraft.id || null, status: 'todo', notes: '', createdAt: now, completedAt: null, updatedAt: now }) }
function removeChildDraft(id: string) { childDrafts.value = childDrafts.value.filter(item => item.id !== id) }
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
function occursOn(item: Task, date: string) {
  if (!item.plannedDate || item.parentTaskId || date < item.plannedDate) return false
  const rule = parseRepeatRule(item.repeatRule)
  if (rule.kind === 'none') return item.plannedDate === date
  const start = parseDate(item.plannedDate); const target = parseDate(date); const days = Math.floor((target.getTime() - start.getTime()) / 86400000)
  if (rule.endMode === 'date' && rule.endDate && date > rule.endDate) return false
  const interval = Math.max(1, rule.interval || 1)
  let matched = rule.kind === 'daily' || rule.kind === 'every_days' || rule.kind === 'custom' ? days % interval === 0
    : rule.kind === 'weekly' ? target.getDay() === start.getDay()
      : rule.kind === 'workdays' ? target.getDay() >= 1 && target.getDay() <= 5
        : rule.kind === 'monthly' ? target.getDate() === start.getDate()
          : rule.kind === 'yearly' ? target.getMonth() === start.getMonth() && target.getDate() === start.getDate()
            : rule.kind === 'memory' ? [1, 3, 7, 14, 29].includes(days)
              : rule.kind === 'weekly_slots' ? (rule.weekdays || [start.getDay()]).includes(target.getDay())
                : rule.kind === 'monthly_slots' ? (rule.monthDays || [start.getDate()]).includes(target.getDate()) : false
  if (rule.endMode === 'count' && rule.count) { const maxDays = rule.kind === 'memory' ? 29 : (rule.count - 1) * interval; matched &&= days <= maxDays }
  return matched
}
</script>
