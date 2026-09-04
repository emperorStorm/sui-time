<template>
  <main class="app-shell" data-sidebar-skin="mountain-night">
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
          <button class="icon-button sidebar-refresh" type="button" title="回到今天并刷新数据" @click="resetCurrentDate()"><RefreshCw :size="16" /></button>
          <Transition name="popover">
            <section v-if="brandMenuOpen" class="brand-menu" aria-label="账户与应用设置">
              <div class="brand-menu-profile"><span class="avatar">{{ session.displayName.slice(0, 1) }}</span><div><strong>{{ session.displayName }}</strong><small>本地时光簿</small></div></div>
              <div class="brand-menu-list"><button type="button" @click="openBrandMenuView('categories')"><CategoryIcon :size="16" />分类管理</button><button type="button" @click="openBrandMenuView('about')"><Info :size="16" />关于岁岁时光</button></div>
              <button class="brand-menu-logout" type="button" @click="handleLogout"><LogOut :size="16" />退出登录</button>
            </section>
          </Transition>
        </div>
        <nav aria-label="主导航">
          <p class="nav-group-title">事项</p>
          <button :class="['nav-item', { active: currentView === 'all' }]" @click="currentView = 'all'"><LayoutGrid :size="18" />全部事项</button>
          <p class="nav-group-title planning-title">规划</p>
          <button :class="['nav-item', { active: currentView === 'week' }]" @click="currentView = 'week'"><CalendarDays :size="18" />我的一周</button>
          <button :class="['nav-item', { active: currentView === 'month' }]" @click="currentView = 'month'"><CalendarRange :size="18" />我的一月</button>
          <p class="nav-group-title planning-title">基础设置</p>
          <button :class="['nav-item', { active: currentView === 'categories' }]" @click="currentView = 'categories'"><CategoryIcon :size="18" />分类管理</button>
        </nav>
        <div class="sidebar-foot"><span></span><small>Local-first · v{{ version }}</small></div>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div class="topbar-title"><p v-if="viewMeta.subtitle">{{ viewMeta.subtitle }}</p><h1>{{ viewMeta.title }}</h1></div>
          <div class="topbar-actions">
            <template v-if="currentView !== 'categories' && currentView !== 'about'">
              <button class="text-icon-button" :disabled="savingShowCompleted" @click="handleShowCompleted"><component :is="showCompleted ? EyeOff : Eye" :size="17" />{{ showCompleted ? '隐藏已完成/已失败' : '显示已完成/已失败' }}</button>
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
                  <button v-for="item in group.tasks" :key="item.id" :class="['task-card', `status-${item.status}`]" :style="{ '--task-color': item.categoryColor || '#8b98a8' }" draggable="true" @dragstart="draggedTaskId = item.id" @click="openTaskModal(undefined, item)">
                    <span v-if="isRepeatingTask(item)" class="task-check task-repeat" title="重复事项，请在周或月视图中更新单次状态"><CircleDot :size="16" /></span>
                    <span v-else :class="['task-check', item.status]" @click.stop="toggleItem(item)"><Check v-if="item.status === 'done'" :size="13" /><X v-else-if="item.status === 'failed'" :size="13" /></span>
                    <span class="task-copy"><strong>{{ item.title }}</strong><small>{{ taskSummary(item) }}</small></span>
                    <ChevronRight :size="16" class="task-arrow" />
                  </button>
                  <p v-if="!group.tasks.length" class="empty-column">拖入事项，或点击上方加号</p>
                </div>
              </section>
              <button class="add-category" @click="openCategoryModal()"><Plus :size="18" />添加分类</button>
            </div>
          </div>
        </section>

        <section v-else-if="currentView === 'week'" class="page plan-page week-page">
          <div class="period-bar"><button class="icon-button bordered" title="上一周" @click="moveWeek(-1)"><ChevronLeft :size="18" /></button><button class="period-label" @click="resetCurrentDate()">{{ weekLabel }}</button><button class="icon-button bordered" title="下一周" @click="moveWeek(1)"><ChevronRight :size="18" /></button><button class="period-today-button" @click="resetCurrentDate(false)"><CalendarDays :size="15" />回到本周</button></div>
          <div class="week-grid">
            <section v-for="day in weekDays" :key="day.date" :class="['week-day', { today: day.date === todayDate }]" @dragover.prevent @drop="dropOnDate(day.date)">
              <header><span class="week-day-number">{{ day.day }}</span><strong>{{ day.weekday }}</strong><button class="icon-button ghost" title="新建当天事项" @click="openTaskModal(undefined, undefined, day.date)"><Plus :size="17" /></button></header>
              <div class="day-task-list"><button v-for="item in tasksForDate(day.date)" :key="item.id" :class="['schedule-card', `status-${item.status}`]" :style="{ '--task-color': item.categoryColor || '#8b98a8' }" draggable="true" @dragstart="draggedTaskId = item.id" @click="openTaskModal(undefined, item)"><Check v-if="item.status === 'done'" :size="12" /><X v-else-if="item.status === 'failed'" :size="12" /><span>{{ item.title }}</span><time v-if="item.plannedTime">{{ item.plannedTime }}</time></button></div>
            </section>
          </div>
        </section>

        <section v-else-if="currentView === 'month'" class="page plan-page month-page">
          <div class="period-bar"><button class="icon-button bordered" title="上一个月" @click="moveMonth(-1)"><ChevronLeft :size="18" /></button><button class="period-label" @click="resetCurrentDate()">{{ monthLabel }}</button><button class="icon-button bordered" title="下一个月" @click="moveMonth(1)"><ChevronRight :size="18" /></button><button class="period-today-button" @click="resetCurrentDate()"><CalendarRange :size="15" />回到本月</button></div>
          <div class="month-calendar">
            <div class="month-weekdays"><span v-for="label in weekdayLabels" :key="label">{{ label }}</span></div>
            <div class="month-grid">
              <section v-for="day in monthDays" :key="day.date" :class="['month-day', { muted: !day.inMonth, today: day.date === todayDate }]" @dragover.prevent @drop="dropOnDate(day.date)">
                <header>
                  <div class="month-date-meta"><time :datetime="day.date">{{ day.day }}</time><span class="month-lunar">{{ day.lunarLabel }}</span></div>
                  <div class="month-date-actions"><span v-if="day.marker" class="month-calendar-marker" :title="day.marker">{{ day.marker }}</span><button v-if="day.tasks.length > 4" class="more-items" type="button" :aria-label="`${day.date} 还有 ${day.tasks.length - 4} 项，查看当天全部事项`" aria-haspopup="dialog" :aria-expanded="monthOverflowDate === day.date" @mouseenter="openMonthOverflow(day.date, $event)" @mouseleave="scheduleMonthOverflowClose" @focus="openMonthOverflow(day.date, $event)" @blur="scheduleMonthOverflowClose" @click="openMonthOverflow(day.date, $event)">{{ day.tasks.length - 4 }}+</button><button class="icon-button ghost" title="新建当天事项" @click="openTaskModal(undefined, undefined, day.date)"><Plus :size="15" /></button></div>
                </header>
                <div class="month-items">
                  <button v-for="item in day.tasks.slice(0, 4)" :key="item.id" :class="['month-item', `status-${item.status}`]" :style="{ '--task-color': item.categoryColor || '#8b98a8' }" draggable="true" @dragstart="draggedTaskId = item.id" @click="openTaskModal(undefined, item)"><Check v-if="item.status === 'done'" :size="12" /><X v-else-if="item.status === 'failed'" :size="12" /><span>{{ item.title }}</span><time v-if="item.plannedTime">{{ item.plannedTime }}</time></button>
                </div>
              </section>
            </div>
          </div>
        </section>

        <section v-else-if="currentView === 'categories'" class="page settings-page">
          <section class="settings-block"><div class="settings-heading"><div><p class="eyebrow">生活分类</p><h2>分类管理</h2><span>用颜色和图标区分不同生活主题，删除分类不会删除关联事项。</span></div><button class="primary-button" @click="openCategoryModal()"><Plus :size="18" />新增分类</button></div><div v-if="categories.length" class="category-table"><div v-for="category in categories" :key="category.id" class="category-row"><span class="category-icon" :style="{ color: category.color, backgroundColor: `${category.color}22` }"><component :is="categoryIconComponent(category.icon)" :size="17" /></span><strong>{{ category.name }}</strong><small>{{ categoryTaskCount(category.id) }} 项事项</small><div><button class="icon-button ghost" title="编辑分类" @click="openCategoryModal(category)"><Pencil :size="16" /></button><button class="icon-button ghost danger" title="删除分类" @click="deleteCategory(category)"><Trash2 :size="16" /></button></div></div></div><p v-else class="empty-state">还没有分类。先为工作、生活或兴趣添加一个分类。</p></section>
        </section>

        <section v-else class="page settings-page">
          <section class="settings-block update-block"><div class="settings-heading"><div><p class="eyebrow">桌面客户端</p><h2>关于岁岁时光</h2><span>岁岁时光是一个本地优先的个人待办与时间规划应用。安装包发布后，可在此检查新版本。</span></div><button class="primary-button" :disabled="checkingUpdate" @click="handleUpdate"><RefreshCw :class="{ spinning: checkingUpdate }" :size="18" />{{ updateButtonLabel }}</button></div><div class="version-detail"><span>当前版本</span><strong>v{{ version }}</strong><span>{{ updateStatus }}</span></div></section>
          <section class="settings-block"><div class="settings-heading"><div><p class="eyebrow">本地数据</p><h2>加密备份</h2><span>导出的备份包含本机账号、分类和事项。恢复前会自动保存一份加密回滚备份，恢复完成后应用将重新载入。</span></div><div class="data-actions"><button class="quiet-button" @click="openBackupModal('export')"><Download :size="17" />导出备份</button><button class="primary-button" @click="openBackupModal('restore')"><Upload :size="17" />恢复备份</button></div></div></section>
        </section>
      </section>
      <button class="floating-add" type="button" title="新建事项" aria-label="新建事项" @click="openTaskModal()"><Plus :size="28" /></button>
    </template>

    <Teleport to="body">
      <Transition name="month-overflow">
        <section v-if="monthOverflowDate && monthOverflowTasks.length > 4" ref="monthOverflowPanel" class="month-overflow-popover" :style="monthOverflowStyle" role="dialog" :aria-label="`${monthOverflowDate} 全部事项`" @mouseenter="keepMonthOverflowOpen" @mouseleave="scheduleMonthOverflowClose" @focusin="keepMonthOverflowOpen" @focusout="scheduleMonthOverflowClose">
          <button v-for="item in monthOverflowTasks" :key="item.id" type="button" :class="['month-overflow-item', `status-${item.status}`]" :style="{ '--task-color': item.categoryColor || '#8b98a8' }" @click="openTaskFromMonthOverflow(item)"><Check v-if="item.status === 'done'" :size="12" /><X v-else-if="item.status === 'failed'" :size="12" /><span>{{ item.title }}</span><time v-if="item.plannedTime">{{ item.plannedTime }}</time></button>
        </section>
      </Transition>
    </Teleport>

    <Transition name="modal" :duration="{ enter: 260, leave: 180 }">
      <div v-if="taskModalOpen" class="modal-backdrop task-backdrop" @mousedown.self="closeTaskModal">
      <form class="modal-panel task-modal" @mousedown="closeTaskMenusOnOutsideClick" @submit.prevent="saveTaskForm">
        <header class="task-modal-head"><span v-if="editingRepeatRule" class="task-check modal-check task-repeat" title="重复事项请在周或月视图中更新单次状态"><CircleDot :size="18" /></span><button v-else type="button" :class="['task-check', 'modal-check', taskDraftStatus]" :disabled="savingTask || updatingTaskStatus" :title="taskStatusActionLabel" :aria-label="taskStatusActionLabel" :aria-pressed="taskDraftStatus !== 'todo'" @click="toggleTaskStatusFromModal"><Check v-if="taskDraftStatus === 'done'" :size="14" /><X v-else-if="taskDraftStatus === 'failed'" :size="14" /></button><input v-model.trim="taskDraft.title" maxlength="120" autofocus placeholder="输入事项名称" /><div class="task-head-actions"><button :class="['priority-trigger', `priority-${taskDraft.priority}`]" type="button" :title="`优先级：${selectedPriorityOption.label}`" :aria-label="`设置优先级，当前${selectedPriorityOption.label}`" :aria-expanded="priorityOpen" @click="priorityOpen = !priorityOpen"><span class="priority-trigger-mark" aria-hidden="true">{{ selectedPriorityOption.mark }}</span></button><button v-if="selectedTaskCategory" class="task-category-trigger" type="button" :style="{ color: selectedTaskCategory.color, backgroundColor: `${selectedTaskCategory.color}22` }" :title="`分类：${selectedTaskCategory.name}`" :aria-label="`选择分类，当前${selectedTaskCategory.name}`" :aria-expanded="categoryMenuOpen" @click="categoryMenuOpen = !categoryMenuOpen"><component :is="categoryIconComponent(selectedTaskCategory.icon)" :size="19" /></button></div></header>
        <Transition name="popover"><div v-if="priorityOpen" class="priority-menu"><button v-for="option in priorityOptions" :key="option.value" :class="[option.value, { selected: taskDraft.priority === option.value }]" type="button" @click="taskDraft.priority = option.value; priorityOpen = false"><span class="priority-option-mark">{{ option.mark }}</span><strong>{{ option.label }}</strong><Check v-if="taskDraft.priority === option.value" :size="16" /></button></div></Transition>
        <Transition name="popover"><div v-if="categoryMenuOpen" class="task-category-menu" role="menu" aria-label="选择分类"><button v-for="category in orderedCategories" :key="category.id" type="button" :class="{ selected: taskDraft.categoryId === category.id }" role="menuitemradio" :aria-checked="taskDraft.categoryId === category.id" @click="selectTaskCategory(category.id)"><span :style="{ color: category.color, backgroundColor: `${category.color}22` }"><component :is="categoryIconComponent(category.icon)" :size="18" /></span><strong>{{ category.name }}</strong><Check v-if="taskDraft.categoryId === category.id" :size="15" /></button></div></Transition>
        <section class="task-meta-list" aria-label="事项属性"><button type="button" class="task-meta-row" @click="timeOpen = true"><AlarmClock :size="20" /><span><small>日期与时间</small><strong>{{ timeSummary }}</strong></span><ChevronRight :size="18" /></button><button type="button" class="task-meta-row" :disabled="!canSetReminder" @click="openReminderSheet"><BellRing :size="20" /><span><small>提醒</small><strong>{{ reminderSummary }}</strong></span><ChevronRight :size="18" /></button><button type="button" class="task-meta-row" @click="repeatOpen = true"><CircleDot :size="20" /><span><small>重复</small><strong>{{ repeatSummary }}</strong></span><ChevronRight :size="18" /></button></section>
<section class="subtask-section" :style="{ '--subtask-color': selectedTaskCategory?.color || '#2F80ED' }"><div class="section-label">子事项</div><div class="subtask-list"><div v-for="subtask in childDrafts" :key="subtask.id" class="subtask-row"><button type="button" :class="['task-check', { done: subtask.status === 'done' }]" :disabled="savingTask || updatingTaskStatus" :aria-label="subtask.status === 'done' ? '标记子事项为待完成' : '标记子事项为已完成'" :aria-pressed="subtask.status === 'done'" @click="toggleChildDraftStatus(subtask)"><Check v-if="subtask.status === 'done'" :size="13" /></button><input :data-subtask-id="subtask.id" v-model.trim="subtask.title" maxlength="120" placeholder="子事项" @input="syncTaskDraftStatusWithChildren" @keydown.enter.prevent="addChildDraft(subtask.id)" /><button type="button" class="subtask-remove" title="删除子事项" @click="removeChildDraft(subtask.id)"><CircleMinus :size="17" /></button></div></div><button type="button" class="add-subtask" @click="addChildDraft()"><Plus :size="20" />添加子事项</button></section>
        <label class="notes-editor"><span class="section-label">备注</span><textarea v-model.trim="taskDraft.notes" rows="5" maxlength="1000" placeholder="补充一点上下文，给未来的自己。"></textarea></label>
        <footer><div class="task-footer-start"><button v-if="taskDraft.id" class="quiet-button danger-text" type="button" @click="deleteTaskFromModal">删除</button><button v-if="taskDraft.id && !editingRepeatRule && taskDraftStatus !== 'failed'" class="quiet-button failure-action" type="button" :disabled="savingTask || updatingTaskStatus" @click="markTaskFailed"><strong>{{ updatingTaskStatus ? '正在标记' : '失败' }}</strong></button></div><span></span><button class="quiet-button" type="button" @click="closeTaskModal">取消</button><button class="primary-button" :disabled="savingTask">{{ savingTask ? '正在保存' : '保存' }}</button></footer>
      </form>
      </div>
    </Transition>

    <Transition name="modal" :duration="{ enter: 260, leave: 180 }">
      <div v-if="completeChildrenConfirmOpen" class="modal-backdrop nested-backdrop completion-confirm-backdrop" @mousedown.self="cancelTaskCompletion">
        <section class="modal-panel completion-confirm" role="alertdialog" aria-modal="true" aria-labelledby="completion-confirm-title" aria-describedby="completion-confirm-description">
          <div class="completion-confirm-heading"><span class="completion-confirm-icon"><Check :size="20" /></span><div><h2 id="completion-confirm-title">完成全部子事项？</h2><p id="completion-confirm-description">该事项包含 {{ childCountForCompletion }} 个子事项。确认后将与父事项一起全部完成。</p></div></div>
          <footer><span></span><button class="quiet-button" type="button" :disabled="updatingTaskStatus" @click="cancelTaskCompletion">取消</button><button class="primary-button" type="button" :disabled="updatingTaskStatus" autofocus @click="confirmTaskCompletion">{{ updatingTaskStatus ? '正在完成' : '全部完成' }}</button></footer>
        </section>
      </div>
    </Transition>

    <Transition name="modal" :duration="{ enter: 260, leave: 180 }">
      <div v-if="timeOpen" class="modal-backdrop nested-backdrop" @mousedown.self="timeOpen = false"><TaskDateTimePicker :selection="{ plannedDate: taskDraft.plannedDate, plannedTime: taskDraft.plannedTime, plannedEndTime: taskDraft.plannedEndTime, scheduleKind: taskDraft.scheduleKind }" @close="timeOpen = false" @save="applyTimeSelection" /></div>
    </Transition>

    <Transition name="modal" :duration="{ enter: 260, leave: 180 }">
      <div v-if="reminderOpen" class="modal-backdrop nested-backdrop" @mousedown.self="reminderOpen = false"><section class="reminder-sheet" role="dialog" aria-modal="true" aria-label="设置提醒"><header><div><small>事项提醒</small><h2>提醒时间</h2></div><button class="icon-button ghost" type="button" title="关闭" @click="reminderOpen = false"><X :size="19" /></button></header><div class="reminder-switch-row"><div><strong>是否提醒</strong><small>通过系统通知提醒你</small></div><button :class="['reminder-switch', { active: reminderEnabled }]" type="button" aria-label="开启或关闭提醒" :aria-pressed="reminderEnabled" @click="toggleReminderEnabled"><span></span></button></div><template v-if="reminderEnabled"><p class="reminder-hint">最多设置 3 个提醒</p><div class="reminder-options"><button v-for="option in reminderOptions" :key="option.value" :class="{ selected: reminderDraftOffsets.includes(option.value) }" type="button" @click="toggleReminderOffset(option.value)">{{ option.label }}</button></div></template><p class="reminder-permission">{{ reminderPermissionMessage }}<button v-if="reminderPermission === 'granted'" type="button" :disabled="sendingReminderTest" @click="sendReminderTest">{{ sendingReminderTest ? '正在发送' : '发送测试通知' }}</button><button v-else-if="reminderPermission === 'denied'" type="button" @click="openReminderSettings">打开系统设置</button><button v-else-if="reminderPermission === 'error'" type="button" :disabled="requestingReminderPermission" @click="requestReminderAccess">{{ requestingReminderPermission ? '正在重试' : '重新尝试' }}</button></p><footer><span></span><button class="quiet-button" type="button" @click="reminderOpen = false">取消</button><button class="primary-button" type="button" :disabled="reminderEnabled && reminderPermission !== 'granted'" @click="saveReminderSettings">保存</button></footer></section></div>
    </Transition>

    <Transition name="modal" :duration="{ enter: 260, leave: 180 }">
      <div v-if="reminderPermissionGuideOpen" class="modal-backdrop nested-backdrop reminder-permission-backdrop" @mousedown.self="reminderPermissionGuideOpen = false"><section class="modal-panel reminder-permission-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reminder-permission-title" aria-describedby="reminder-permission-description"><span class="reminder-permission-icon"><BellRing :size="22" /></span><div><h2 id="reminder-permission-title">{{ reminderPermissionGuideTitle }}</h2><p id="reminder-permission-description">{{ reminderPermissionGuideDescription }}</p></div><footer><span></span><button class="quiet-button" type="button" :disabled="requestingReminderPermission" @click="reminderPermissionGuideOpen = false">暂不启用</button><button v-if="reminderPermission === 'denied'" class="primary-button" type="button" @click="openReminderSettings">打开系统设置</button><button v-else class="primary-button" type="button" :disabled="requestingReminderPermission" @click="requestReminderAccess">{{ requestingReminderPermission ? '正在请求' : reminderPermission === 'error' ? '重新尝试' : '允许通知' }}</button></footer></section></div>
    </Transition>

    <Transition name="modal" :duration="{ enter: 260, leave: 180 }">
      <div v-if="repeatOpen" class="modal-backdrop nested-backdrop" @mousedown.self="repeatOpen = false"><section class="repeat-sheet"><header><button class="quiet-button" @click="repeatOpen = false">取消</button><h2>选择重复</h2><span></span></header><div class="repeat-list"><button v-for="option in repeatOptions" :key="option.value" :class="{ selected: repeatDraft.kind === option.value }" @click="chooseRepeat(option.value)"><div><strong>{{ option.label }}</strong><small>{{ option.hint }}</small></div><Check v-if="repeatDraft.kind === option.value" :size="18" /></button></div><div v-if="repeatDraft.kind !== 'none'" class="repeat-config"><label v-if="needsInterval">每隔<input v-model.number="repeatDraft.interval" min="1" max="365" type="number" />天</label><label>结束<select v-model="repeatDraft.endMode"><option value="never">永不结束</option><option value="date">指定日期</option><option value="count">固定次数</option></select></label><label v-if="repeatDraft.endMode === 'date'">结束日期<input v-model="repeatDraft.endDate" type="date" /></label><label v-if="repeatDraft.endMode === 'count'">次数<input v-model.number="repeatDraft.count" min="1" max="999" type="number" /></label></div><footer><span></span><button class="primary-button" @click="applyRepeat">保存规则</button></footer></section></div>
    </Transition>

    <Transition name="modal">
      <div v-if="categoryModalOpen" class="modal-backdrop" @mousedown.self="categoryModalOpen = false"><form class="modal-panel category-modal" @submit.prevent="saveCategoryForm"><header><div><h2>{{ categoryDraft.id ? '编辑分类' : '新建分类' }}</h2></div><button class="icon-button ghost" type="button" title="关闭" @click="categoryModalOpen = false"><X :size="20" /></button></header><label class="field wide"><span>分类名称</span><input v-model.trim="categoryDraft.name" maxlength="20" autofocus placeholder="例如：阅读" /></label><div class="icon-picker"><span>分类图标</span><div><button v-for="option in categoryIconOptions" :key="option.value" :class="['icon-choice', { selected: categoryDraft.icon === option.value }]" type="button" :title="option.label" :aria-label="option.label" @click="categoryDraft.icon = option.value"><component :is="option.icon" :size="18" /></button></div></div><div class="color-picker"><span>分类颜色</span><button v-for="color in colors" :key="color" :class="['color-choice', { selected: categoryDraft.color === color }]" type="button" :style="{ backgroundColor: color }" @click="categoryDraft.color = color"><Check :size="15" /></button></div><footer><span></span><button class="quiet-button" type="button" @click="categoryModalOpen = false">取消</button><button class="primary-button" :disabled="savingCategory">{{ savingCategory ? '正在保存' : '保存分类' }}</button></footer></form></div>
    </Transition>

    <Transition name="modal">
      <div v-if="backupModalOpen" class="modal-backdrop" @mousedown.self="closeBackupModal"><form class="modal-panel backup-modal" @submit.prevent="submitBackup"><header><div><p class="eyebrow">{{ backupMode === 'export' ? '导出加密备份' : '恢复加密备份' }}</p><h2>{{ backupMode === 'export' ? '留一份安心的副本' : '从备份恢复数据' }}</h2></div><button class="icon-button ghost" type="button" title="关闭" @click="closeBackupModal"><X :size="20" /></button></header><p class="backup-tip">{{ backupMode === 'export' ? '请设置至少 8 位的备份密码。密码无法找回。' : '请选择此前导出的备份文件，并输入它的备份密码。' }}</p><label class="field wide"><span>备份密码</span><input v-model="backupPassword" type="password" minlength="8" autocomplete="new-password" autofocus placeholder="至少 8 位" /></label><label v-if="backupMode === 'export'" class="field wide"><span>确认备份密码</span><input v-model="backupPasswordConfirmation" type="password" minlength="8" autocomplete="new-password" placeholder="再次输入备份密码" /></label><p v-if="backupError" class="form-error">{{ backupError }}</p><footer><span></span><button class="quiet-button" type="button" :disabled="backupInProgress" @click="closeBackupModal">取消</button><button class="primary-button" :disabled="backupInProgress">{{ backupInProgress ? '正在处理' : backupMode === 'export' ? '选择位置并导出' : '选择备份并恢复' }}</button></footer></form></div>
    </Transition>

    <Transition name="notice"><div v-if="notice" class="notice" :class="notice.type">{{ notice.text }}</div></Transition>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AlarmClock, ArrowRight, BellRing, BookOpen, BriefcaseBusiness, CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, CircleDot, CircleMinus, Dumbbell, Download, Eye, EyeOff, HeartPulse, House, Info, Lightbulb, LayoutGrid, LogOut, Pencil, Plane, Plus, RefreshCw, RotateCcw, Search, ShoppingBag, Tags as CategoryIcon, Target, Trash2, Upload, UsersRound, Utensils, WalletCards, X } from 'lucide-vue-next'
import { completeTaskWithChildren, createAccount, currentVersion, exportEncryptedBackup, formatUpdateError, getBootState, getLastTaskCategory, getLastTaskPriority, listCategories, listTaskChildren, listTasks, loginUser, logoutUser, removeCategory, removeTask, rescheduleTask, restoreEncryptedBackup, saveCategory, saveLastTaskCategory, saveLastTaskPriority, saveShowCompleted, saveTask, setTaskStatus, syncTaskChildren } from './api/native'
import type { UpdateCheckResult } from './api/native'
import AppNotificationCenter from './components/AppNotificationCenter.vue'
import TaskDateTimePicker, { type TaskTimeSelection } from './components/TaskDateTimePicker.vue'
import { createTaskReminderScheduler, getReminderPermission, openReminderNotificationSettings, requestReminderPermission, sendReminderTestNotification, type ReminderPermission, type ReminderPermissionResult } from './composables/use-task-reminders'
import type { BootState, Category, Priority, RepeatRule, ScheduleKind, ShowCompletedByView, Task, TaskInput, TaskView, UserSession } from './types'
import { resolveCalendarMeta } from './utils/calendar-meta'
import { isRepeatingTask, parseOccurrenceId, parseOverrides, parseRepeatRule, tasksForDate as resolveTasksForDate } from './utils/task-occurrence'

type View = TaskView | 'categories' | 'about'
type Notice = { text: string; type: 'success' | 'error' }

const colors = ['#4D82D5', '#13A66A', '#E96E4D', '#C65376', '#DE9A22', '#7457D9', '#3489C5', '#D95B8D', '#2DAD96', '#D66A3A', '#70964A', '#8A6B54', '#557DCC', '#D3505A', '#599F82', '#7A7FBE']
const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const booting = ref(true)
const bootState = ref<BootState | null>(null)
const session = ref<UserSession | null>(null)
const currentView = ref<View>('all')
const categories = ref<Category[]>([])
const tasks = ref<Task[]>([])
const search = ref('')
const rangeStart = ref('')
const rangeEnd = ref('')
const showCompletedByView = ref<ShowCompletedByView>({ all: false, week: false, month: false })
const weekAnchor = ref(todayString())
const monthAnchor = ref(todayString())
const todayDate = ref(todayString())
const draggedTaskId = ref<string | null>(null)
const monthOverflowDate = ref<string | null>(null)
const monthOverflowPanel = ref<HTMLElement | null>(null)
const monthOverflowStyle = ref<Record<string, string>>({})
const version = ref('0.3.0')
const notice = ref<Notice | null>(null)
const submitting = ref(false)
const savingShowCompleted = ref(false)
const authError = ref('')
const checkingUpdate = ref(false)
const updateStatus = ref('尚未检查更新')
const notificationCenter = ref<{ checkForUpdate: (openWhenFound?: boolean) => Promise<UpdateCheckResult | null> } | null>(null)
const brandMenu = ref<HTMLElement | null>(null)
const brandMenuOpen = ref(false)
const taskModalOpen = ref(false)
const lastTaskCategoryId = ref<string | null>(null)
const lastTaskPriority = ref<Priority>('not_urgent_not_important')
const categoryModalOpen = ref(false)
const backupModalOpen = ref(false)
const backupMode = ref<'export' | 'restore'>('export')
const backupPassword = ref('')
const backupPasswordConfirmation = ref('')
const backupError = ref('')
const backupInProgress = ref(false)
const savingTask = ref(false)
const updatingTaskStatus = ref(false)
const savingCategory = ref(false)
const authForm = reactive({ username: '', password: '' })
const taskDraft = reactive<TaskInput>({ title: '', categoryId: null, plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day', priority: 'not_urgent_not_important', repeatRule: '{"kind":"none"}', occurrenceOverrides: '{}', reminderOffsets: [], parentTaskId: null, failureReason: null, notes: '' })
const categoryDraft = reactive<{ id?: string; name: string; color: string; icon: string; sortOrder: number }>({ name: '', color: colors[0], icon: 'briefcase-business', sortOrder: 0 })
const priorityOpen = ref(false)
const categoryMenuOpen = ref(false)
const completeChildrenConfirmOpen = ref(false)
const childCountForCompletion = ref(0)
const timeOpen = ref(false)
const reminderOpen = ref(false)
const repeatOpen = ref(false)
const reminderPermission = ref<ReminderPermission>('unsupported')
const reminderPermissionDetail = ref('')
const reminderDraftOffsets = ref<number[]>([])
const reminderPermissionGuideOpen = ref(false)
const requestingReminderPermission = ref(false)
const sendingReminderTest = ref(false)
const childDrafts = ref<Task[]>([])
const deletedChildIds = ref<string[]>([])
const persistedChildIds = ref<Set<string>>(new Set())
const taskDraftStatus = ref<Task['status']>('todo')
const priorityOptions: Array<{ value: Priority; label: string; mark: string }> = [
  { value: 'urgent_important', label: '重要且紧急', mark: 'I' }, { value: 'important_not_urgent', label: '重要不紧急', mark: 'II' },
  { value: 'urgent_not_important', label: '不重要但紧急', mark: 'III' }, { value: 'not_urgent_not_important', label: '不重要不紧急', mark: 'IV' }
]
const categoryIconOptions = [
  { value: 'tags', label: '通用分类', icon: CategoryIcon }, { value: 'briefcase-business', label: '工作', icon: BriefcaseBusiness },
  { value: 'house', label: '生活', icon: House },
  { value: 'book-open', label: '学习成长', icon: BookOpen }, { value: 'heart-pulse', label: '健康', icon: HeartPulse },
  { value: 'dumbbell', label: '运动', icon: Dumbbell }, { value: 'wallet-cards', label: '财务', icon: WalletCards },
  { value: 'users-round', label: '家庭', icon: UsersRound }, { value: 'plane', label: '出行', icon: Plane },
  { value: 'utensils', label: '餐饮', icon: Utensils }, { value: 'shopping-bag', label: '购物', icon: ShoppingBag },
  { value: 'target', label: '目标', icon: Target }, { value: 'lightbulb', label: '灵感', icon: Lightbulb }
]
function categoryIconComponent(icon: string | null) {
  return categoryIconOptions.find(option => option.value === icon)?.icon || CategoryIcon
}
const selectedPriorityOption = computed(() => priorityOptions.find(option => option.value === taskDraft.priority) || priorityOptions[0])
const effectiveChildDrafts = computed(() => childDrafts.value.filter(item => item.title.trim()))
const taskStatusActionLabel = computed(() => taskDraftStatus.value === 'failed' ? '恢复为待完成' : taskDraftStatus.value === 'done' ? '标记为待完成' : '标记为已完成')
const activeTaskView = computed<TaskView | null>(() => ['all', 'week', 'month'].includes(currentView.value) ? currentView.value as TaskView : null)
const showCompleted = computed(() => activeTaskView.value ? showCompletedByView.value[activeTaskView.value] : false)
const repeatOptions: Array<{ value: RepeatRule['kind']; label: string; hint: string }> = [
  { value: 'none', label: '不重复', hint: '' }, { value: 'daily', label: '每天', hint: '每天重复' }, { value: 'every_days', label: '任意多天', hint: '按天数间隔' }, { value: 'weekly', label: '每周', hint: '每周同一天' }, { value: 'weekly_slots', label: '每周（不同天、不同时间）', hint: '可配置多个时段' }, { value: 'workdays', label: '每周工作日', hint: '周一至周五' }, { value: 'monthly', label: '每月', hint: '每月同一天' }, { value: 'monthly_slots', label: '每月（不同天、不同时间）', hint: '可配置多个日期' }, { value: 'yearly', label: '每年', hint: '每年同一天' }, { value: 'memory', label: '记忆曲线', hint: '1、2、4、7、15 天' }, { value: 'custom', label: '自定义', hint: '按自定义周期重复' }
]
const repeatDraft = reactive<RepeatRule>({ kind: 'none', interval: 1, endMode: 'never' })
const editingOccurrence = ref<{ source: Task; date: string } | null>(null)
const editingRepeatRule = computed(() => !editingOccurrence.value && parseRepeatRule(taskDraft.repeatRule).kind !== 'none')
const reminderOptions = [
  { value: 0, label: '准时提醒' }, { value: 5, label: '提前 5 分钟' }, { value: 15, label: '提前 15 分钟' },
  { value: 30, label: '提前 30 分钟' }, { value: 60, label: '提前 1 小时' }, { value: 120, label: '提前 2 小时' }
]

const viewMeta = computed(() => ({
  all: { title: '全部事项', subtitle: '' },
  week: { title: '我的一周', subtitle: '' },
  month: { title: '我的一月', subtitle: '' },
  categories: { title: '分类管理', subtitle: '' },
  about: { title: '关于岁岁时光', subtitle: '' }
}[currentView.value]))

const visibleTasks = computed(() => tasks.value.filter(item => !item.parentTaskId && (showCompleted.value || item.status === 'todo')))
const taskGroups = computed(() => categories.value.map(category => ({ ...category, tasks: visibleTasks.value.filter(item => item.categoryId === category.id).sort(compareTaskStatus) })))
const selectedTaskCategory = computed(() => categories.value.find(category => category.id === taskDraft.categoryId))
const orderedCategories = computed(() => [...categories.value].sort((left, right) => left.sortOrder - right.sortOrder))
const weekDays = computed(() => weekDates(weekAnchor.value).map((date, index) => ({ date, day: Number(date.slice(-2)), weekday: weekdayLabels[index] })))
const monthDays = computed(() => calendarDays(monthAnchor.value).map(day => ({ ...day, ...resolveCalendarMeta(day.date), tasks: tasksForDate(day.date) })))
const monthOverflowTasks = computed(() => monthDays.value.find(day => day.date === monthOverflowDate.value)?.tasks || [])
const weekLabel = computed(() => formatMonth(weekAnchor.value))
const monthLabel = computed(() => formatMonth(monthAnchor.value))
const updateButtonLabel = computed(() => checkingUpdate.value ? '正在检查' : '检查更新')
const timeSummary = computed(() => taskDraft.scheduleKind === 'all_day' ? (taskDraft.plannedDate || '设置时间') : taskDraft.scheduleKind === 'range' ? `${taskDraft.plannedDate || '未设日期'} ${taskDraft.plannedTime || '--:--'}-${taskDraft.plannedEndTime || '--:--'}` : `${taskDraft.plannedDate || '未设日期'} ${taskDraft.plannedTime || '未设时间'}`)
const repeatSummary = computed(() => repeatOptions.find(option => option.value === repeatDraft.kind)?.label || '添加重复')
const needsInterval = computed(() => ['every_days', 'custom'].includes(repeatDraft.kind))
const canSetReminder = computed(() => Boolean(!taskDraft.parentTaskId && taskDraft.plannedDate && taskDraft.plannedTime && taskDraft.scheduleKind !== 'all_day'))
const reminderEnabled = computed(() => reminderDraftOffsets.value.length > 0)
const reminderSummary = computed(() => {
  if (!canSetReminder.value) return '设置时间后可添加提醒'
  if (!taskDraft.reminderOffsets.length) return '不提醒'
  return taskDraft.reminderOffsets.map(formatReminderOffset).join('、')
})
const reminderPermissionMessage = computed(() => {
  if (reminderPermission.value === 'granted') return '桌面通知已开启，提醒将在应用运行或最小化时准时送达。'
  if (reminderPermission.value === 'unsupported') return '仅桌面客户端支持系统提醒。'
  if (reminderPermission.value === 'not_determined') return '开启提醒前，需要允许岁岁时光发送系统通知。'
  if (reminderPermission.value === 'error') return reminderPermissionDetail.value || '无法确认 macOS 通知权限，请重新尝试。'
  return '桌面通知未授权，请在系统通知设置中允许“岁岁时光”后重试。'
})
const reminderPermissionGuideTitle = computed(() => reminderPermission.value === 'denied' ? '需要开启系统通知' : reminderPermission.value === 'error' ? '无法请求系统通知' : '允许系统通知')
const reminderPermissionGuideDescription = computed(() => {
  if (reminderPermission.value === 'denied') return '通知权限由 macOS 管理。请在系统设置中允许“岁岁时光”发送通知，然后返回此处重新开启提醒。'
  if (reminderPermission.value === 'error') return reminderPermissionDetail.value || 'macOS 未能完成通知授权，请确认应用仍在运行后重新尝试。'
  return '岁岁时光会在事项到达提醒时间时向你发送系统通知。'
})

let reminderScheduler: ReturnType<typeof createTaskReminderScheduler> | null = null
let monthOverflowTrigger: HTMLElement | null = null
let monthOverflowCloseTimer: number | undefined

onMounted(async () => {
  document.addEventListener('mousedown', closeBrandMenuOnOutsideClick)
  document.addEventListener('mousedown', closeMonthOverflowOnOutsideClick)
  document.addEventListener('keydown', closeMonthOverflowOnEscape)
  document.addEventListener('scroll', closeMonthOverflowOnScroll, true)
  window.addEventListener('resize', closeMonthOverflow)
  try {
    version.value = await currentVersion()
    bootState.value = await getBootState()
    session.value = bootState.value.session
    showCompletedByView.value = session.value?.showCompletedByView ?? { all: false, week: false, month: false }
    if (session.value) {
      await refreshData()
      await loadLastTaskCategory()
      await loadLastTaskPriority()
      scheduleMidnightRefresh()
      startReminderScheduler()
    }
  } catch (error) {
    authError.value = messageOf(error)
  } finally {
    booting.value = false
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closeBrandMenuOnOutsideClick)
  document.removeEventListener('mousedown', closeMonthOverflowOnOutsideClick)
  document.removeEventListener('keydown', closeMonthOverflowOnEscape)
  document.removeEventListener('scroll', closeMonthOverflowOnScroll, true)
  window.removeEventListener('resize', closeMonthOverflow)
  window.clearTimeout(filterTimer)
  window.clearTimeout(midnightRefreshTimer)
  window.clearTimeout(monthOverflowCloseTimer)
  reminderScheduler?.stop()
})

let filterTimer: number | undefined
let midnightRefreshTimer: number | undefined
let dataRequestId = 0
watch([search, rangeStart, rangeEnd], () => {
  if (!session.value) return
  window.clearTimeout(filterTimer)
  filterTimer = window.setTimeout(() => { void refreshData() }, 180)
})
watch([currentView, monthAnchor, showCompleted], closeMonthOverflow)
watch(currentView, view => {
  if (!session.value || !['all', 'week', 'month'].includes(view)) return
  void refreshData().catch(error => showNotice(messageOf(error), 'error'))
})

async function submitAuth() {
  if (!authForm.username || !authForm.password || submitting.value) return
  submitting.value = true
  authError.value = ''
  try {
    const input = { ...authForm }
    session.value = bootState.value?.needsSetup ? await createAccount(input) : await loginUser(input)
    showCompletedByView.value = session.value.showCompletedByView
    if (bootState.value) bootState.value.needsSetup = false
    await refreshData()
    await loadLastTaskCategory()
    await loadLastTaskPriority()
    scheduleMidnightRefresh()
    startReminderScheduler()
  } catch (error) {
    authError.value = messageOf(error)
  } finally {
    submitting.value = false
  }
}

async function refreshData() {
  const requestId = ++dataRequestId
  const query = { search: search.value || undefined, startDate: rangeStart.value || undefined, endDate: rangeEnd.value || undefined, includeCompleted: showCompleted.value }
  const [nextCategories, nextTasks] = await Promise.all([listCategories(), listTasks(query)])
  if (requestId !== dataRequestId) return
  categories.value = nextCategories
  tasks.value = nextTasks
  if (lastTaskCategoryId.value && !nextCategories.some(category => category.id === lastTaskCategoryId.value)) lastTaskCategoryId.value = nextCategories[0]?.id ?? null
}

async function loadLastTaskCategory() {
  try {
    const categoryId = await getLastTaskCategory()
    lastTaskCategoryId.value = categoryId && categories.value.some(category => category.id === categoryId)
      ? categoryId
      : categories.value[0]?.id ?? null
  } catch {
    lastTaskCategoryId.value = categories.value[0]?.id ?? null
  }
}

async function rememberLastTaskCategory(categoryId: string | null) {
  if (!categoryId || !categories.value.some(category => category.id === categoryId)) return
  try {
    lastTaskCategoryId.value = await saveLastTaskCategory(categoryId)
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

async function loadLastTaskPriority() {
  try {
    const priority = await getLastTaskPriority()
    lastTaskPriority.value = priority && priorityOptions.some(option => option.value === priority)
      ? priority
      : 'not_urgent_not_important'
  } catch {
    lastTaskPriority.value = 'not_urgent_not_important'
  }
}

async function rememberLastTaskPriority(priority: Priority) {
  try {
    lastTaskPriority.value = await saveLastTaskPriority(priority)
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

function scheduleMidnightRefresh() {
  window.clearTimeout(midnightRefreshTimer)
  if (!session.value) return
  const now = new Date()
  const nextDay = new Date(now)
  nextDay.setHours(24, 0, 1, 0)
  midnightRefreshTimer = window.setTimeout(() => {
    todayDate.value = todayString()
    void refreshData().then(() => reminderScheduler?.sync()).catch(error => showNotice(messageOf(error), 'error'))
    scheduleMidnightRefresh()
  }, Math.max(1000, nextDay.getTime() - now.getTime()))
}

function startReminderScheduler() {
  reminderScheduler?.stop()
  if (!session.value) return
  reminderScheduler = createTaskReminderScheduler(session.value.id, message => showNotice(message, 'error'))
  reminderScheduler.start()
}

async function handleLogout() {
  brandMenuOpen.value = false
  window.clearTimeout(midnightRefreshTimer)
  reminderScheduler?.stop()
  reminderScheduler = null
  await logoutUser()
  dataRequestId += 1
  session.value = null
  showCompletedByView.value = { all: false, week: false, month: false }
  tasks.value = []
  categories.value = []
  lastTaskCategoryId.value = null
  lastTaskPriority.value = 'not_urgent_not_important'
  authForm.password = ''
}

async function handleShowCompleted() {
  const view = activeTaskView.value
  if (!session.value || !view || savingShowCompleted.value) return
  savingShowCompleted.value = true
  try {
    const saved = await saveShowCompleted(view, !showCompleted.value)
    const nextShowCompletedByView = { ...showCompletedByView.value, [view]: saved }
    showCompletedByView.value = nextShowCompletedByView
    session.value = { ...session.value, showCompletedByView: nextShowCompletedByView }
    await refreshData()
  } catch (error) {
    showNotice(messageOf(error), 'error')
  } finally {
    savingShowCompleted.value = false
  }
}

function openBrandMenuView(view: 'categories' | 'about') {
  currentView.value = view
  brandMenuOpen.value = false
}

function closeBrandMenuOnOutsideClick(event: MouseEvent) {
  if (brandMenu.value && !brandMenu.value.contains(event.target as Node)) brandMenuOpen.value = false
}

async function resetCurrentDate(showSuccess = true) {
  const currentDate = todayString()
  todayDate.value = currentDate
  weekAnchor.value = currentDate
  monthAnchor.value = currentDate
  try {
    await refreshData()
    if (showSuccess) showNotice('已回到今天')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

async function openTaskModal(categoryId?: string | null, item?: Task, date?: string) {
  const occurrence = item ? parseOccurrenceId(item.id) : null
  editingOccurrence.value = occurrence ? { source: tasks.value.find(task => task.id === occurrence.sourceId) || item!, date: occurrence.date } : null
  taskDraftStatus.value = item?.status || 'todo'
  const defaultCategoryId = categoryId ?? (lastTaskCategoryId.value && categories.value.some(category => category.id === lastTaskCategoryId.value) ? lastTaskCategoryId.value : categories.value[0]?.id ?? null)
  Object.assign(taskDraft, item ? { id: item.id, title: item.title, categoryId: item.categoryId, plannedDate: item.plannedDate, plannedTime: item.plannedTime, plannedEndTime: item.plannedEndTime, scheduleKind: item.scheduleKind, priority: item.priority, repeatRule: item.repeatRule, occurrenceOverrides: item.occurrenceOverrides, reminderOffsets: [...item.reminderOffsets], parentTaskId: item.parentTaskId, failureReason: item.failureReason, notes: item.notes } : { id: undefined, title: '', categoryId: defaultCategoryId, plannedDate: date ?? null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day', priority: lastTaskPriority.value, repeatRule: '{"kind":"none"}', occurrenceOverrides: '{}', reminderOffsets: [], parentTaskId: null, failureReason: null, notes: '' })
  Object.assign(repeatDraft, parseRepeatRule(taskDraft.repeatRule))
  const parentTaskId = editingOccurrence.value?.source.id || item?.id
  childDrafts.value = parentTaskId ? await listTaskChildren(parentTaskId) : []
  deletedChildIds.value = []
  persistedChildIds.value = new Set(childDrafts.value.map(child => child.id))
  priorityOpen.value = false
  categoryMenuOpen.value = false
  completeChildrenConfirmOpen.value = false
  childCountForCompletion.value = 0
  reminderOpen.value = false
  reminderPermissionGuideOpen.value = false
  taskModalOpen.value = true
}

async function toggleTaskStatusFromModal() {
  if (editingRepeatRule.value || savingTask.value || updatingTaskStatus.value) return
  const nextStatus: Task['status'] = taskDraftStatus.value === 'todo' ? 'done' : 'todo'
  if (!await persistTaskDraft(false)) return
  if (!taskDraft.id || editingOccurrence.value || nextStatus === 'todo') {
    if (await applyTaskStatusFromModal(nextStatus) && nextStatus === 'done') closeTaskModal()
    return
  }
  const childCount = effectiveChildDrafts.value.length
  if (childCount < 2) {
    if (await applyTaskStatusFromModal('done', true)) closeTaskModal()
    return
  }
  childCountForCompletion.value = childCount
  completeChildrenConfirmOpen.value = true
}

async function confirmTaskCompletion() {
  if (!taskDraft.id || savingTask.value || updatingTaskStatus.value) return
  if (await applyTaskStatusFromModal('done', true)) {
    cancelTaskCompletion()
    closeTaskModal()
  }
}

async function applyTaskStatusFromModal(nextStatus: Task['status'], completeChildren = false) {
  if (!taskDraft.id || savingTask.value || updatingTaskStatus.value) return false
  const previousStatus = taskDraftStatus.value
  const persistedChildIds = completeChildren
    ? new Set(tasks.value.filter(task => task.parentTaskId === taskDraft.id).map(task => task.id))
    : null
  updatingTaskStatus.value = true
  try {
    if (editingOccurrence.value) await saveOccurrenceStatus(editingOccurrence.value.source, editingOccurrence.value.date, nextStatus, null)
    else if (completeChildren) await completeTaskWithChildren(taskDraft.id)
    else await setTaskStatus(taskDraft.id, nextStatus, null)
    if (persistedChildIds) {
      const completedAt = Date.now()
      childDrafts.value = childDrafts.value.map(child => persistedChildIds.has(child.id) && child.status !== 'done' ? { ...child, status: 'done', completedAt, updatedAt: completedAt } : child)
    } else if (previousStatus === 'done' && nextStatus === 'todo') {
      const updatedAt = Date.now()
      childDrafts.value = childDrafts.value.map(child => ({ ...child, status: 'todo', failureReason: null, completedAt: null, updatedAt }))
    }
    taskDraftStatus.value = nextStatus
    if (nextStatus !== 'failed') taskDraft.failureReason = null
    await refreshData()
    void reminderScheduler?.sync()
    return true
  } catch (error) {
    showNotice(messageOf(error), 'error')
    return false
  } finally {
    updatingTaskStatus.value = false
  }
}

async function markTaskFailed() {
  if (!taskDraft.id || editingRepeatRule.value || taskDraftStatus.value === 'failed' || savingTask.value || updatingTaskStatus.value) return
  await applyTaskStatusFromModal('failed')
}

async function persistTaskDraft(rememberPriority = true) {
  if (savingTask.value) return false
  if (!taskDraft.title) {
    showNotice('请输入事项名称', 'error')
    return false
  }
  if (!taskDraft.parentTaskId && !taskDraft.categoryId) {
    showNotice('请先创建分类，再添加事项', 'error')
    return false
  }
  savingTask.value = true
  let childrenSynced = false
  try {
    if (taskDraft.scheduleKind === 'range' && (!taskDraft.plannedTime || !taskDraft.plannedEndTime || taskDraft.plannedTime >= taskDraft.plannedEndTime)) throw new Error('时间段的结束时间必须晚于开始时间')
    const taskInput = { ...taskDraft, categoryId: taskDraft.categoryId || null, plannedDate: taskDraft.plannedDate || null, plannedTime: taskDraft.scheduleKind === 'all_day' ? null : taskDraft.plannedTime || null, plannedEndTime: taskDraft.scheduleKind === 'range' ? taskDraft.plannedEndTime || null : null, reminderOffsets: canSetReminder.value ? [...taskDraft.reminderOffsets] : [], repeatRule: JSON.stringify(repeatDraft), failureReason: taskDraftStatus.value === 'failed' ? taskDraft.failureReason : null }
    const saved = editingOccurrence.value ? await saveOccurrence(editingOccurrence.value.source, editingOccurrence.value.date, taskInput, taskDraftStatus.value) : await saveTask(taskInput)
    if (!editingOccurrence.value) taskDraft.id = saved.id
    const savedChildren = await syncTaskChildren({ parentTaskId: saved.id, children: effectiveChildDrafts.value.map(item => ({ ...(persistedChildIds.value.has(item.id) ? { id: item.id } : {}), title: item.title, status: item.status === 'done' ? 'done' : 'todo' })), deletedIds: deletedChildIds.value })
    await rememberLastTaskCategory(taskInput.categoryId)
    if (rememberPriority) await rememberLastTaskPriority(taskInput.priority)
    childrenSynced = true
    childDrafts.value = savedChildren
    persistedChildIds.value = new Set(savedChildren.map(child => child.id))
    deletedChildIds.value = []
    await refreshData()
    void reminderScheduler?.sync()
    return true
  } catch (error) {
    showNotice(messageOf(error), 'error')
    return childrenSynced
  } finally {
    savingTask.value = false
  }
}

async function saveTaskForm() {
  if (await persistTaskDraft()) taskModalOpen.value = false
}

async function deleteTaskFromModal() {
  if (!taskDraft.id || !window.confirm('确定删除这个事项吗？')) return
  try {
    if (editingOccurrence.value) await saveOccurrence(editingOccurrence.value.source, editingOccurrence.value.date, editingOccurrence.value.source, undefined, { deleted: true })
    else await removeTask(taskDraft.id)
    taskModalOpen.value = false
    await refreshData()
    void reminderScheduler?.sync()
    showNotice('事项已删除')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

async function toggleItem(item: Task) {
  try {
    const occurrence = parseOccurrenceId(item.id)
    if (occurrence) {
      const source = tasks.value.find(task => task.id === occurrence.sourceId)
      if (!source) return
      const overrides = parseOverrides(source)
      const nextStatus: Task['status'] = item.status === 'todo' ? 'done' : 'todo'
      overrides[occurrence.date] = { ...overrides[occurrence.date], status: nextStatus, failureReason: null }
      await saveTask({ ...source, occurrenceOverrides: JSON.stringify(overrides) })
    } else await setTaskStatus(item.id, item.status === 'todo' ? 'done' : 'todo')
    await refreshData()
    void reminderScheduler?.sync()
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

function openCategoryModal(item?: Category) {
  Object.assign(categoryDraft, item ? { id: item.id, name: item.name, color: item.color, icon: item.icon, sortOrder: item.sortOrder } : { id: undefined, name: '', color: colors[categories.value.length % colors.length], icon: 'briefcase-business', sortOrder: categories.value.length })
  categoryModalOpen.value = true
}

async function saveCategoryForm() {
  if (!categoryDraft.name || savingCategory.value) return
  savingCategory.value = true
  try {
    await saveCategory({ ...categoryDraft })
    categoryModalOpen.value = false
    await refreshData()
    showNotice('分类已保存')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  } finally {
    savingCategory.value = false
  }
}

async function deleteCategory(category: Category) {
  if (!window.confirm(`删除“${category.name}”后，关联事项将变为未分类。是否继续？`)) return
  try {
    await removeCategory(category.id)
    if (lastTaskCategoryId.value === category.id) lastTaskCategoryId.value = categories.value.find(item => item.id !== category.id)?.id ?? null
    await refreshData()
    showNotice('分类已删除，关联事项已保留')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}

async function dropOnDate(date: string) {
  if (!draggedTaskId.value) return
  try {
    const occurrence = parseOccurrenceId(draggedTaskId.value)
    if (occurrence) {
      const source = tasks.value.find(item => item.id === occurrence.sourceId)
      if (!source) return
      const overrides = parseOverrides(source)
      overrides[occurrence.date] = { ...overrides[occurrence.date], deleted: true, plannedDate: date }
      await saveTask({ ...source, occurrenceOverrides: JSON.stringify(overrides) })
    } else await rescheduleTask(draggedTaskId.value, date)
    await refreshData()
    void reminderScheduler?.sync()
  } catch (error) {
    showNotice(messageOf(error), 'error')
  } finally {
    draggedTaskId.value = null
  }
}

async function dropOnGroup(categoryId: string) {
  try {
    const occurrence = draggedTaskId.value ? parseOccurrenceId(draggedTaskId.value) : null
    if (occurrence) {
      const source = tasks.value.find(task => task.id === occurrence.sourceId)
      if (!source) return
      await saveOccurrence(source, occurrence.date, { ...source, categoryId })
    } else {
      const item = tasks.value.find(task => task.id === draggedTaskId.value)
      if (!item) return
      await saveTask({ id: item.id, title: item.title, categoryId, plannedDate: item.plannedDate, plannedTime: item.plannedTime, plannedEndTime: item.plannedEndTime, scheduleKind: item.scheduleKind, priority: item.priority, repeatRule: item.repeatRule, occurrenceOverrides: item.occurrenceOverrides, reminderOffsets: item.reminderOffsets, parentTaskId: item.parentTaskId, failureReason: item.failureReason, notes: item.notes })
    }
    await rememberLastTaskCategory(categoryId)
    await refreshData()
    void reminderScheduler?.sync()
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

function tasksForDate(date: string) {
  return resolveTasksForDate(visibleTasks.value, date).filter(item => showCompleted.value || item.status === 'todo').sort(compareTaskStatus)
}
function compareTaskStatus(left: Task, right: Task) { return Number(left.status !== 'todo') - Number(right.status !== 'todo') }
async function openMonthOverflow(date: string, event: MouseEvent | FocusEvent) {
  const trigger = event.currentTarget
  if (!(trigger instanceof HTMLElement)) return
  keepMonthOverflowOpen()
  monthOverflowDate.value = date
  monthOverflowTrigger = trigger
  const dayWidth = trigger.closest('.month-day')?.getBoundingClientRect().width || trigger.getBoundingClientRect().width
  const width = Math.min(Math.max(dayWidth - 14, 220), 320, window.innerWidth - 24)
  monthOverflowStyle.value = { width: `${width}px`, top: '12px', left: '12px', visibility: 'hidden' }
  await nextTick()
  if (monthOverflowTrigger !== trigger || !monthOverflowPanel.value) return
  const triggerRect = trigger.getBoundingClientRect()
  const panelHeight = monthOverflowPanel.value.getBoundingClientRect().height
  const margin = 12
  const gap = 6
  const left = Math.min(Math.max(triggerRect.left, margin), window.innerWidth - width - margin)
  const below = triggerRect.bottom + gap
  const above = triggerRect.top - panelHeight - gap
  const top = below + panelHeight <= window.innerHeight - margin ? below : Math.max(margin, above)
  monthOverflowStyle.value = { width: `${width}px`, top: `${top}px`, left: `${left}px`, visibility: 'visible' }
}
function keepMonthOverflowOpen() { window.clearTimeout(monthOverflowCloseTimer) }
function scheduleMonthOverflowClose() { window.clearTimeout(monthOverflowCloseTimer); monthOverflowCloseTimer = window.setTimeout(closeMonthOverflow, 140) }
function closeMonthOverflow() { window.clearTimeout(monthOverflowCloseTimer); monthOverflowDate.value = null; monthOverflowTrigger = null; monthOverflowStyle.value = {} }
function closeMonthOverflowOnOutsideClick(event: MouseEvent) {
  if (!(event.target instanceof Node) || monthOverflowPanel.value?.contains(event.target) || monthOverflowTrigger?.contains(event.target)) return
  closeMonthOverflow()
}
function closeMonthOverflowOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') closeMonthOverflow() }
function closeMonthOverflowOnScroll(event: Event) { if (!(event.target instanceof Node) || !monthOverflowPanel.value?.contains(event.target)) closeMonthOverflow() }
function openTaskFromMonthOverflow(item: Task) { closeMonthOverflow(); openTaskModal(undefined, item) }
function categoryTaskCount(categoryId: string) { return tasks.value.filter(item => item.categoryId === categoryId).length }
function taskSummary(item: Task) { return [item.plannedDate ? item.plannedDate.slice(5).replace('-', '月') + '日' : '未安排日期', item.plannedTime || '', item.notes ? '有备注' : ''].filter(Boolean).join(' · ') }
function clearFilters() { search.value = ''; rangeStart.value = ''; rangeEnd.value = ''; refreshData() }
function closeTaskModal() { taskModalOpen.value = false; priorityOpen.value = false; categoryMenuOpen.value = false; completeChildrenConfirmOpen.value = false; childCountForCompletion.value = 0; timeOpen.value = false; reminderOpen.value = false; reminderPermissionGuideOpen.value = false; repeatOpen.value = false }
function closeTaskMenusOnOutsideClick(event: MouseEvent) { if (!(event.target instanceof Element)) return; if (!event.target.closest('.priority-trigger, .priority-menu')) priorityOpen.value = false; if (!event.target.closest('.task-category-trigger, .task-category-menu')) categoryMenuOpen.value = false }
function cancelTaskCompletion() { if (updatingTaskStatus.value) return; completeChildrenConfirmOpen.value = false; childCountForCompletion.value = 0 }
async function saveOccurrence(source: Task, date: string, input: TaskInput, status?: Task['status'], patch: { deleted?: boolean; plannedDate?: string | null } = {}) {
  const overrides = parseOverrides(source)
  const existingPlannedDate = overrides[date]?.plannedDate
  const plannedDate = patch.plannedDate !== undefined ? patch.plannedDate : input.plannedDate !== source.plannedDate ? input.plannedDate : existingPlannedDate
  overrides[date] = { ...overrides[date], title: input.title, categoryId: input.categoryId, plannedTime: input.plannedTime, plannedEndTime: input.plannedEndTime, scheduleKind: input.scheduleKind, priority: input.priority, reminderOffsets: input.reminderOffsets, notes: input.notes, ...(plannedDate !== undefined ? { plannedDate } : {}), ...patch, ...(status !== undefined ? { status, failureReason: status === 'failed' ? input.failureReason : null } : {}) }
  return saveTask({ ...source, occurrenceOverrides: JSON.stringify(overrides) })
}
async function saveOccurrenceStatus(source: Task, date: string, status: Task['status'], failureReason: string | null) {
  const overrides = parseOverrides(source)
  overrides[date] = { ...overrides[date], status, failureReason: status === 'failed' ? failureReason?.trim() || null : null }
  return saveTask({ ...source, occurrenceOverrides: JSON.stringify(overrides) })
}
function chooseRepeat(kind: RepeatRule['kind']) { repeatDraft.kind = kind; if (!repeatDraft.endMode) repeatDraft.endMode = 'never' }
function applyRepeat() { taskDraft.repeatRule = JSON.stringify(repeatDraft); repeatOpen.value = false }
function addChildDraft(afterId?: string) {
  const now = Date.now()
  const child = { id: crypto.randomUUID(), title: '', categoryId: null, categoryName: null, categoryColor: null, categoryIcon: null, plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: 'all_day' as const, priority: 'not_urgent_not_important' as const, repeatRule: '{"kind":"none"}', occurrenceOverrides: '{}', reminderOffsets: [], parentTaskId: taskDraft.id || null, status: 'todo' as const, failureReason: null, notes: '', createdAt: now, completedAt: null, updatedAt: now }
  const index = afterId ? childDrafts.value.findIndex(item => item.id === afterId) : -1
  const insertionIndex = index >= 0 ? index + 1 : childDrafts.value.length
  childDrafts.value.splice(insertionIndex, 0, child)
  if (!afterId) return
  void nextTick(() => document.querySelector<HTMLElement>('.task-modal')?.querySelector<HTMLInputElement>(`input[data-subtask-id="${child.id}"]`)?.focus())
}
async function toggleChildDraftStatus(subtask: Task) {
  if (savingTask.value || updatingTaskStatus.value) return
  const previousChildStatus = subtask.status
  const previousTaskStatus = taskDraftStatus.value
  subtask.status = subtask.status === 'done' ? 'todo' : 'done'
  syncTaskDraftStatusWithChildren()
  if (await persistTaskDraft()) return
  subtask.status = previousChildStatus
  taskDraftStatus.value = previousTaskStatus
}
function syncTaskDraftStatusWithChildren() {
  if (editingOccurrence.value || taskDraftStatus.value === 'failed' || repeatDraft.kind !== 'none' || !effectiveChildDrafts.value.length) return
  taskDraftStatus.value = effectiveChildDrafts.value.every(item => item.status === 'done') ? 'done' : 'todo'
}
function removeChildDraft(id: string) {
  if (persistedChildIds.value.has(id)) deletedChildIds.value = [...deletedChildIds.value, id]
  childDrafts.value = childDrafts.value.filter(item => item.id !== id)
  syncTaskDraftStatusWithChildren()
}
function selectTaskCategory(categoryId: string) { taskDraft.categoryId = categoryId; categoryMenuOpen.value = false }
function applyTimeSelection(value: TaskTimeSelection) {
  Object.assign(taskDraft, value)
  if (value.scheduleKind === 'all_day') taskDraft.reminderOffsets = []
  timeOpen.value = false
}
async function openReminderSheet() {
  if (!canSetReminder.value) return
  try {
    setReminderPermission(await getReminderPermission())
    reminderDraftOffsets.value = [...taskDraft.reminderOffsets]
    reminderOpen.value = true
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}
async function requestReminderAccess() {
  if (requestingReminderPermission.value) return
  requestingReminderPermission.value = true
  try {
    setReminderPermission(await requestReminderPermission())
    if (reminderPermission.value === 'granted') {
      if (!reminderDraftOffsets.value.length) reminderDraftOffsets.value = [15]
      reminderPermissionGuideOpen.value = false
      showNotice('桌面通知已开启，已发送激活通知')
      return
    }
    if (reminderPermission.value === 'unsupported') {
      reminderPermissionGuideOpen.value = false
      showNotice('仅桌面客户端支持系统提醒', 'error')
      return
    }
    reminderPermissionGuideOpen.value = true
  } catch (error) {
    showNotice(messageOf(error), 'error')
  } finally {
    requestingReminderPermission.value = false
  }
}
function setReminderPermission(result: ReminderPermissionResult) {
  reminderPermission.value = result.status
  reminderPermissionDetail.value = result.detail || ''
}
async function toggleReminderEnabled() {
  if (reminderEnabled.value) {
    reminderDraftOffsets.value = []
    return
  }
  if (reminderPermission.value === 'granted') {
    reminderDraftOffsets.value = [15]
    return
  }
  if (reminderPermission.value === 'unsupported') {
    showNotice('仅桌面客户端支持系统提醒', 'error')
    return
  }
  reminderPermissionGuideOpen.value = true
}
async function openReminderSettings() {
  try {
    await openReminderNotificationSettings()
  } catch (error) {
    showNotice(messageOf(error), 'error')
  }
}
async function sendReminderTest() {
  if (sendingReminderTest.value || reminderPermission.value !== 'granted') return
  sendingReminderTest.value = true
  try {
    await sendReminderTestNotification()
    showNotice('测试通知已发送，请留意系统横幅')
  } catch (error) {
    showNotice(messageOf(error), 'error')
  } finally {
    sendingReminderTest.value = false
  }
}
function toggleReminderOffset(offset: number) {
  if (reminderDraftOffsets.value.includes(offset)) reminderDraftOffsets.value = reminderDraftOffsets.value.filter(value => value !== offset)
  else if (reminderDraftOffsets.value.length >= 3) showNotice('最多设置 3 个提醒', 'error')
  else reminderDraftOffsets.value = [...reminderDraftOffsets.value, offset].sort((left, right) => left - right)
}
function saveReminderSettings() {
  if (reminderEnabled.value && reminderPermission.value !== 'granted') {
    reminderPermissionGuideOpen.value = reminderPermission.value !== 'unsupported'
    showNotice('请先授权桌面通知', 'error')
    return
  }
  taskDraft.reminderOffsets = [...reminderDraftOffsets.value]
  reminderOpen.value = false
}
function formatReminderOffset(offset: number) { return offset === 0 ? '准时提醒' : offset >= 60 ? `提前 ${offset / 60} 小时` : `提前 ${offset} 分钟` }
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
