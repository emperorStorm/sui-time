(() => {
  const { storageKey, initialData, today } = window.SuiTimePrototype;
  const app = document.querySelector('#app');
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const load = () => {
    try {
      return { ...clone(initialData), ...JSON.parse(localStorage.getItem(storageKey) || '{}') };
    } catch {
      return clone(initialData);
    }
  };

  let data = load();
  const state = { view: 'all', menu: '', modal: '', draft: null, weekOffset: 0, monthOffset: 0, search: '' };
  const tags = () => data.tags;
  const tagFor = (id) => tags().find((tag) => tag.id === id) || tags()[0];
  const persist = () => localStorage.setItem(storageKey, JSON.stringify(data));
  const pad = (number) => String(number).padStart(2, '0');
  const dateAtNoon = (value) => new Date(`${value}T12:00:00`);
  const iso = (value) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const addDays = (value, amount) => { const date = dateAtNoon(value); date.setDate(date.getDate() + amount); return iso(date); };
  const monthLabel = (value) => { const date = dateAtNoon(value); return `${date.getFullYear()} / ${pad(date.getMonth() + 1)}`; };
  const shortDate = (value) => { const date = dateAtNoon(value); return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`; };
  const weekday = (value) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dateAtNoon(value).getDay()];
  const icon = (name) => `<span class="ui-icon ${name}" aria-hidden="true">${({ grid: '▦', plan: '□', list: '≡', repeat: '⌁', week: 'W', month: 'M', note: '▯', book: '▱', focus: '⌛', bell: '◌', refresh: '↻', search: '⌕', filter: '⌂', plus: '+', setting: '⚙', calendar: '◷', clock: '◷', flag: '⚑', pin: '⌖', image: '▧', close: '×', more: '⋮', arrow: '›', check: '✓', back: '‹', next: '›', user: '◉' })[name] || '•'}</span>`;

  function isOccurrence(task, date) {
    if (task.date === date) return true;
    if (date < task.date || task.repeat === 'none') return false;
    const source = dateAtNoon(task.date);
    const current = dateAtNoon(date);
    if (task.repeat === 'weekly') return source.getDay() === current.getDay();
    if (task.repeat === 'monthly') return source.getDate() === current.getDate();
    if (task.repeat === 'yearly') return source.getDate() === current.getDate() && source.getMonth() === current.getMonth();
    if (task.repeat === 'daily') return true;
    return false;
  }

  function tasksFor(date) {
    return data.tasks.filter((task) => isOccurrence(task, date) && (!data.settings.hideCompleted || task.status !== 'done'));
  }

  function taskMeta(task, contextDate = task.date) {
    const labels = { none: '', weekly: '每周', monthly: '每月', yearly: '每年', daily: '每天' };
    const when = task.schedule === 'point' ? `${shortDate(contextDate)} ${task.time}` : contextDate === today ? '今天' : shortDate(contextDate);
    return [when, labels[task.repeat]].filter(Boolean).join('  ');
  }

  function initialDraft(task, date) {
    return clone(task || {
      id: '', title: '', tagId: 'growth', date: date || today, schedule: 'allDay', time: '', priority: 'notUrgentImportant', repeat: 'none', notes: '', status: 'todo', subtasks: []
    });
  }

  function visibleTasks() {
    const term = state.search.trim();
    return data.tasks.filter((task) => !data.settings.hideCompleted || task.status !== 'done').filter((task) => !term || `${task.title}${task.notes}`.includes(term));
  }

  function avatar() {
    return `<span class="avatar-mark"><span>时</span><i></i></span>`;
  }

  function renderSidebar() {
    const name = data.profile.name;
    return `<aside class="sidebar">
      <div class="sidebar-overlay"></div>
      <div class="identity-row">
        <button class="avatar-button" data-action="open-profile" title="个人资料">${avatar()}</button>
        <button class="account-name" data-action="toggle-menu">${name}</button>
        <button class="icon-only" data-action="open-settings" title="基础设置">${icon('setting')}</button>
        <button class="icon-only" data-action="reset-today" title="刷新">${icon('refresh')}</button>
      </div>
      ${state.menu === 'account' ? `<section class="account-menu popover"><button data-action="open-profile">${icon('user')}个人资料</button><button data-action="open-settings">${icon('setting')}基础设置</button><button data-action="restore-data">${icon('refresh')}恢复演示数据</button></section>` : ''}
      <nav class="nav-area">
        <div class="nav-heading"><span>${icon('plan')}事项</span><b>⌃</b></div>
        <button class="nav-item ${state.view === 'all' ? 'active' : ''}" data-action="switch-view" data-view="all">${icon('grid')}全部 <small>列表</small></button>
        <button class="nav-item" data-action="switch-view" data-view="all">${icon('calendar')}日程</button>
        <button class="nav-item" data-action="switch-view" data-view="all">${icon('list')}清单</button>
        <button class="nav-item" data-action="switch-view" data-view="all">${icon('repeat')}重复</button>
        <div class="nav-divider"></div>
        <div class="nav-heading"><span>${icon('calendar')}规划</span><b>⌃</b></div>
        <button class="nav-item ${state.view === 'week' ? 'active' : ''}" data-action="switch-view" data-view="week">${icon('week')}我的一周</button>
        <button class="nav-item ${state.view === 'month' ? 'active' : ''}" data-action="switch-view" data-view="month">${icon('month')}我的一月</button>
        <div class="nav-divider"></div>
        <button class="nav-item">${icon('note')}备忘录 <b>⌄</b></button>
        <button class="nav-item">${icon('book')}日记 <b>⌄</b></button>
        <button class="nav-item">${icon('focus')}番茄专注 <b>⌄</b></button>
      </nav>
      <div class="sidebar-status"><span></span><small>离线演示 · 数据仅存本机</small></div>
    </aside>`;
  }

  function renderAll() {
    const groups = [{ id: 'all', name: '全部', color: '#4fa4f4', symbol: '▦' }, ...tags()];
    const cards = groups.map((group) => {
      const items = group.id === 'all' ? visibleTasks() : visibleTasks().filter((task) => task.tagId === group.id);
      return `<section class="task-column"><header><strong style="--column-color:${group.color}"><i>${group.symbol || '●'}</i>${group.name}</strong><button class="column-more" title="更多操作">${icon('more')}</button></header><button class="column-add" data-action="open-task" data-tag="${group.id === 'all' ? '' : group.id}">${icon('plus')}</button><div class="cards">${items.map((task) => renderTaskCard(task)).join('') || '<p class="column-empty">暂时没有事项</p>'}</div></section>`;
    }).join('');
    return `<section class="all-view view-content"><div class="board-toolbar"><div><h1>事项-列表</h1><button class="search-trigger" title="搜索">${icon('search')}</button><label class="search-box">${icon('search')}<input data-field="search" value="${state.search}" placeholder="搜索事项" /></label></div><div class="board-options"><span>${icon('filter')}本周</span><label class="switch"><input data-setting="hideCompleted" type="checkbox" ${data.settings.hideCompleted ? 'checked' : ''}/><i></i></label><span>隐藏已完成/已失败</span></div></div><div class="board-scroll"><div class="task-board">${cards}</div></div></section>`;
  }

  function renderTaskCard(task, date) {
    const tag = tagFor(task.tagId);
    const childInfo = task.subtasks.length ? `子任务 ${task.subtasks.length}` : taskMeta(task, date);
    return `<article class="task-card" style="--task-color:${tag.color}"><button class="task-check ${task.status === 'done' ? 'done' : ''}" data-action="toggle-task" data-task="${task.id}" title="完成事项">${task.status === 'done' ? icon('check') : ''}</button><button class="task-open" data-action="edit-task" data-task="${task.id}"><strong>${task.title}</strong><small>${childInfo || '未设置日期'}</small></button><button class="task-chevron" data-action="edit-task" data-task="${task.id}">${icon('arrow')}</button></article>`;
  }

  function currentWeekDates() {
    const anchor = addDays(today, state.weekOffset * 7);
    const date = dateAtNoon(anchor);
    const offset = (date.getDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, index) => addDays(anchor, index - offset));
  }

  function renderWeek() {
    const days = currentWeekDates();
    return `<section class="plan-view view-content"><div class="plan-heading"><h1>我的一周</h1><strong>${monthLabel(days[0])}</strong><div><button class="icon-only light" data-action="week-prev">${icon('back')}</button><button class="icon-only light" data-action="week-next">${icon('next')}</button><button class="display-control">${icon('list')}展示管理</button><label class="switch muted"><input data-setting="hideCompleted" type="checkbox" ${data.settings.hideCompleted ? 'checked' : ''}/><i></i></label><span>隐藏已完成/已失败</span></div></div><div class="week-grid">${days.map((date, index) => `<section class="week-day ${date === today ? 'today' : ''}"><header><span>${dateAtNoon(date).getDate()}</span><strong>${index === 0 && date === today ? '今天' : weekday(date)}</strong><button data-action="open-task" data-date="${date}">${icon('plus')}</button></header><div class="schedule-list">${tasksFor(date).map((task) => renderSchedule(task, date)).join('')}</div></section>`).join('')}</div></section>`;
  }

  function renderSchedule(task, date) {
    const tag = tagFor(task.tagId);
    return `<button class="schedule-item" data-action="edit-task" data-task="${task.id}" style="--task-color:${tag.color}"><span>${task.status === 'done' ? '✓ ' : ''}${task.title}</span>${task.schedule === 'point' ? `<time>${task.time}</time>` : ''}</button>`;
  }

  function monthDates() {
    const anchor = dateAtNoon(addDays(today, state.monthOffset * 31));
    anchor.setDate(1);
    const offset = (anchor.getDay() + 6) % 7;
    anchor.setDate(anchor.getDate() - offset);
    return Array.from({ length: 42 }, (_, index) => { const result = new Date(anchor); result.setDate(result.getDate() + index); return iso(result); });
  }

  function renderMonth() {
    const dates = monthDates();
    const currentMonth = dateAtNoon(addDays(today, state.monthOffset * 31)).getMonth();
    return `<section class="plan-view view-content"><div class="plan-heading"><h1>我的一月</h1><strong>${monthLabel(dates[17])}</strong><div><button class="icon-only light" data-action="month-prev">${icon('back')}</button><button class="icon-only light" data-action="month-next">${icon('next')}</button><button class="display-control">${icon('list')}展示管理</button><label class="switch muted"><input data-setting="hideCompleted" type="checkbox" ${data.settings.hideCompleted ? 'checked' : ''}/><i></i></label><span>隐藏已完成/已失败</span></div></div><div class="month-labels">${['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label) => `<b>${label}</b>`).join('')}</div><div class="month-grid">${dates.map((date) => { const entries = tasksFor(date); const muted = dateAtNoon(date).getMonth() !== currentMonth; return `<section class="month-day ${muted ? 'muted-day' : ''} ${date === today ? 'today' : ''}"><header><span>${dateAtNoon(date).getDate()}</span>${date === today ? '<i>今</i>' : ''}<button data-action="open-task" data-date="${date}">${icon('plus')}</button></header><div>${entries.slice(0, 4).map((task) => renderSchedule(task, date)).join('')}${entries.length > 4 ? `<button class="more-items" data-action="edit-task" data-task="${entries[4].id}">+${entries.length - 4}</button>` : ''}</div></section>`; }).join('')}</div></section>`;
  }

  function renderProfile() {
    const profile = data.profile;
    return `<section class="profile-view view-content"><h1>个人资料</h1><div class="profile-layout"><div class="profile-card">${avatar()}<strong>${profile.name}</strong><span>本地时光记录者</span></div><form class="profile-form"><label>昵称<input data-profile="name" value="${profile.name}" maxlength="16" /></label><label>手机号<span>${profile.phone}</span></label><label>邮箱<button type="button" class="inline-link">绑定邮箱</button></label><fieldset><legend>性别</legend><label><input data-profile="gender" value="male" type="radio" ${profile.gender === 'male' ? 'checked' : ''}/> 男</label><label><input data-profile="gender" value="female" type="radio" ${profile.gender === 'female' ? 'checked' : ''}/> 女</label></fieldset><label class="signature">签名<textarea data-profile="signature" maxlength="80">${profile.signature}</textarea></label><button type="button" class="primary-button" data-action="save-profile">保存</button></form></div></section>`;
  }

  function renderWorkspace() {
    const view = state.view === 'all' ? renderAll() : state.view === 'week' ? renderWeek() : state.view === 'month' ? renderMonth() : renderProfile();
    return `<section class="workspace">${view}</section>`;
  }

  function renderTaskModal() {
    if (!['task', 'time', 'repeat'].includes(state.modal)) return '';
    const task = state.draft;
    const tag = tagFor(task.tagId);
    const priorities = [['urgent', '重要且紧急'], ['important', '重要不紧急'], ['notUrgentImportant', '不重要紧急'], ['notUrgent', '不重要不紧急']];
    return `<div class="modal-layer" data-action="close-modal"><form class="task-modal" data-stop="true"><header><span class="task-check modal-circle" style="--task-color:${tag.color}"></span><input data-draft="title" value="${task.title}" autofocus placeholder="输入事项名称" maxlength="80" /><div class="task-actions"><button type="button" class="priority-button priority-${task.priority}" data-action="toggle-priority" title="设置优先级">${icon('flag')}</button><button type="button" class="tag-button" data-action="toggle-tag" style="--task-color:${tag.color}" title="选择分类">${tag.icon}</button></div></header>${state.menu === 'priority' ? `<section class="select-menu priority-menu">${priorities.map(([value, label]) => `<button type="button" class="priority-${value}" data-action="set-priority" data-value="${value}"><i>Ⅰ</i>${label}${task.priority === value ? icon('check') : ''}</button>`).join('')}</section>` : ''}${state.menu === 'tag' ? `<section class="select-menu tag-menu">${tags().map((item) => `<button type="button" data-action="set-tag" data-tag="${item.id}"><i style="background:${item.color}">${item.icon}</i>${item.name}${task.tagId === item.id ? icon('check') : ''}</button>`).join('')}</section>` : ''}<div class="modal-body"><button type="button" class="meta-row" data-action="open-time">${icon('clock')}<span><small>日期与时间</small><strong>${task.schedule === 'point' ? `${task.date} ${task.time}` : `${task.date} 全天`}</strong></span>${icon('arrow')}</button><button type="button" class="meta-row" data-action="open-repeat">${icon('repeat')}<span><small>重复</small><strong>${repeatLabel(task.repeat)}</strong></span>${icon('arrow')}</button><button type="button" class="subtask-add" data-action="add-subtask">${icon('plus')}添加子任务</button><div class="subtask-list">${task.subtasks.map((subtask, index) => `<label><button type="button" class="small-check" data-action="remove-subtask" data-index="${index}">${icon('close')}</button><input data-subtask="${index}" value="${subtask}" maxlength="60" placeholder="子任务" /></label>`).join('')}</div><label class="note-box"><span>备注</span><textarea data-draft="notes" placeholder="记录一些细节，未来的自己会感谢你。">${task.notes}</textarea><i>${icon('image')}${icon('pin')}</i></label><button type="button" class="failure-row"><b>×</b><span>失败</span></button></div><footer>${task.id ? '<button type="button" class="text-button danger" data-action="delete-task">删除</button>' : '<span></span>'}<button type="button" class="text-button" data-action="close-modal">取消</button><button type="button" class="primary-button" data-action="save-task">保存</button></footer></form></div>${renderTimeModal()}${renderRepeatModal()}`;
  }

  function renderTimeModal() {
    if (state.modal !== 'time') return '';
    const task = state.draft;
    return `<div class="modal-layer nested" data-action="close-time"><section class="time-sheet" data-stop="true"><div class="time-tabs"><button data-action="set-schedule" data-value="point" class="${task.schedule === 'point' ? 'active' : ''}">时间点</button><button data-action="set-schedule" data-value="range" class="${task.schedule === 'range' ? 'active' : ''}">时间段</button><button data-action="set-schedule" data-value="allDay" class="${task.schedule === 'allDay' ? 'active' : ''}">全天</button></div><label><span>${shortDate(task.date)} ${weekday(task.date)}</span><input data-draft="date" type="date" value="${task.date}" /></label>${task.schedule !== 'allDay' ? `<label><span>时间</span><input data-draft="time" type="time" value="${task.time || '09:00'}" /></label>` : '<p>全天事件会出现在今日规划中，您可以在任意时间执行，岁岁时光不会提醒您。</p>'}<footer><button data-action="clear-time">清除时间</button><button data-action="close-time">取消</button><button class="link-save" data-action="close-time">保存</button></footer></section></div>`;
  }

  function renderRepeatModal() {
    if (state.modal !== 'repeat') return '';
    const choices = [['none', '不重复', ''], ['daily', '每天', '每天重复'], ['weekly', '每周', '每周同一天'], ['monthly', '每月', '每月同一天'], ['yearly', '每年', '每年同一天'], ['memory', '记忆曲线', '间隔 1、2、4、7、15 天'], ['custom', '自定义', '']];
    return `<div class="modal-layer nested" data-action="close-repeat"><section class="repeat-sheet" data-stop="true"><header><button data-action="close-repeat">取消</button><strong>选择重复</strong><span></span></header><div>${choices.map(([value, label, hint]) => `<button data-action="set-repeat" data-value="${value}" class="${state.draft.repeat === value ? 'selected' : ''}"><span><b>${label}</b><small>${hint}</small></span>${state.draft.repeat === value ? icon('check') : icon('arrow')}</button>`).join('')}</div></section></div>`;
  }

  function repeatLabel(value) {
    return ({ none: '添加重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年', memory: '记忆曲线', custom: '自定义' })[value] || '添加重复';
  }

  function renderSettings() {
    if (state.modal !== 'settings') return '';
    return `<div class="modal-layer" data-action="close-modal"><section class="settings-modal" data-stop="true"><header><div><small>岁岁时光</small><h2>基础设置</h2></div><button data-action="close-modal">${icon('close')}</button></header><div class="settings-rows"><label><span><b>主题换肤</b><small>保持与桌面端一致的清爽界面</small></span><input data-setting="darkSidebar" type="checkbox" ${data.settings.darkSidebar ? 'checked' : ''}/></label><label><span><b>紧凑导航</b><small>收起侧栏中的辅助分组</small></span><input data-setting="compactMenu" type="checkbox" ${data.settings.compactMenu ? 'checked' : ''}/></label><label><span><b>仅显示本周</b><small>事项面板聚焦当前一周</small></span><input data-setting="weekOnly" type="checkbox" ${data.settings.weekOnly ? 'checked' : ''}/></label><button data-action="restore-data"><span><b>恢复演示数据</b><small>清除本原型的浏览器本地数据</small></span>${icon('refresh')}</button></div></section></div>`;
  }

  function render() {
    app.innerHTML = `<div class="desktop-frame ${data.settings.darkSidebar ? 'night-sidebar' : ''}"><div class="window-bar"><span class="window-dots"><i></i><i></i><i></i></span><b>时光序</b><span></span></div><div class="app-body">${renderSidebar()}${renderWorkspace()}</div><button class="floating-add" data-action="open-task" title="新建事项">${icon('plus')}</button></div>${renderTaskModal()}${renderSettings()}`;
  }

  function openTask(id, date, tagId) {
    state.draft = initialDraft(id ? data.tasks.find((task) => task.id === id) : null, date);
    if (tagId) state.draft.tagId = tagId;
    state.modal = 'task';
    state.menu = '';
  }

  function saveTask() {
    const task = state.draft;
    if (!task.title.trim()) { window.alert('请先填写事项名称'); return; }
    task.title = task.title.trim();
    if (task.id) data.tasks = data.tasks.map((item) => item.id === task.id ? clone(task) : item);
    else { task.id = `t${Date.now()}`; data.tasks.unshift(clone(task)); }
    persist(); state.modal = ''; state.menu = '';
  }

  function handleAction(target) {
    const action = target.dataset.action;
    if (!action) return;
    if (action === 'switch-view') { state.view = target.dataset.view; state.menu = ''; }
    if (action === 'toggle-menu') state.menu = state.menu === 'account' ? '' : 'account';
    if (action === 'open-profile') { state.view = 'profile'; state.menu = ''; }
    if (action === 'open-settings') { state.modal = 'settings'; state.menu = ''; }
    if (action === 'open-task') openTask('', target.dataset.date, target.dataset.tag);
    if (action === 'edit-task') openTask(target.dataset.task);
    if (action === 'toggle-task') { const task = data.tasks.find((item) => item.id === target.dataset.task); task.status = task.status === 'done' ? 'todo' : 'done'; persist(); }
    if (action === 'close-modal') { state.modal = ''; state.menu = ''; }
    if (action === 'save-task') saveTask();
    if (action === 'delete-task') { data.tasks = data.tasks.filter((task) => task.id !== state.draft.id); persist(); state.modal = ''; }
    if (action === 'toggle-priority') state.menu = state.menu === 'priority' ? '' : 'priority';
    if (action === 'set-priority') { state.draft.priority = target.dataset.value; state.menu = ''; }
    if (action === 'toggle-tag') state.menu = state.menu === 'tag' ? '' : 'tag';
    if (action === 'set-tag') { state.draft.tagId = target.dataset.tag; state.menu = ''; }
    if (action === 'add-subtask') state.draft.subtasks.push('');
    if (action === 'remove-subtask') state.draft.subtasks.splice(Number(target.dataset.index), 1);
    if (action === 'open-time') state.modal = 'time';
    if (action === 'close-time') state.modal = 'task';
    if (action === 'set-schedule') state.draft.schedule = target.dataset.value;
    if (action === 'clear-time') { state.draft.schedule = 'allDay'; state.draft.time = ''; }
    if (action === 'open-repeat') state.modal = 'repeat';
    if (action === 'close-repeat') state.modal = 'task';
    if (action === 'set-repeat') { state.draft.repeat = target.dataset.value; state.modal = 'task'; }
    if (action === 'save-profile') { persist(); window.alert('个人资料已保存'); }
    if (action === 'restore-data') { data = clone(initialData); persist(); state.modal = ''; state.menu = ''; }
    if (action === 'reset-today') { state.weekOffset = 0; state.monthOffset = 0; }
    if (action === 'week-prev') state.weekOffset -= 1;
    if (action === 'week-next') state.weekOffset += 1;
    if (action === 'month-prev') state.monthOffset -= 1;
    if (action === 'month-next') state.monthOffset += 1;
    render();
  }

  app.addEventListener('click', (event) => handleAction(event.target.closest('[data-action]') || {}));
  app.addEventListener('input', (event) => {
    const target = event.target;
    if (target.dataset.draft && state.draft) state.draft[target.dataset.draft] = target.value;
    if (target.dataset.subtask && state.draft) state.draft.subtasks[Number(target.dataset.subtask)] = target.value;
    if (target.dataset.profile) data.profile[target.dataset.profile] = target.value;
    if (target.dataset.field === 'search') { state.search = target.value; render(); }
  });
  app.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.setting) { data.settings[target.dataset.setting] = target.checked; persist(); render(); }
    if (target.dataset.profile) data.profile[target.dataset.profile] = target.value;
  });
  render();
})();
