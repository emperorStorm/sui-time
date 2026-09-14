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
  const state = { tab: 'tasks', filter: 'all', modal: '', draft: null, monthOffset: 0, update: '' };
  const tags = () => data.tags;
  const tagFor = (id) => tags().find((tag) => tag.id === id) || tags()[0];
  const persist = () => localStorage.setItem(storageKey, JSON.stringify(data));
  const pad = (number) => String(number).padStart(2, '0');
  const dateAtNoon = (value) => new Date(`${value}T12:00:00`);
  const iso = (value) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const addDays = (value, amount) => { const date = dateAtNoon(value); date.setDate(date.getDate() + amount); return iso(date); };
  const shortDate = (value) => { const date = dateAtNoon(value); return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`; };
  const weekday = (value) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dateAtNoon(value).getDay()];
  const monthTitle = (value) => { const date = dateAtNoon(value); return `${date.getFullYear()}年${date.getMonth() + 1}月`; };
  const icon = (name) => ({ tasks: '☑', plan: '◷', mine: '◉', refresh: '↻', plus: '+', back: '‹', next: '›', check: '✓', close: '×', arrow: '›', clock: '◷', repeat: '⌁', flag: '⚑', update: '⇪', setting: '⚙' })[name] || '•';

  const APP_VERSION = '0.4.0';

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

  function visibleTasks() {
    return data.tasks
      .filter((task) => !data.settings.hideCompleted || task.status !== 'done')
      .filter((task) => state.filter === 'all' || task.tagId === state.filter);
  }

  function taskMeta(task, contextDate = task.date) {
    const labels = { none: '', weekly: '每周', monthly: '每月', yearly: '每年', daily: '每天' };
    const parts = [];
    if (contextDate === today) parts.push('今天');
    else parts.push(`${shortDate(contextDate)} ${weekday(contextDate)}`);
    if (labels[task.repeat]) parts.push(labels[task.repeat]);
    if (task.schedule === 'point' && task.time) parts.push(task.time);
    if (task.subtasks.length) parts.push(`子任务${task.subtasks.length}`);
    return parts.join(' ');
  }

  function renderTaskItem(task, contextDate) {
    const tag = tagFor(task.tagId);
    return `<div class="task-item ${task.status === 'done' ? 'is-done' : ''}" style="--task-color:${tag.color}" data-action="edit-task" data-task="${task.id}" role="button">
      <button class="task-check ${task.status === 'done' ? 'done' : ''}" data-action="toggle-task" data-task="${task.id}" aria-label="完成事项">${task.status === 'done' ? icon('check') : ''}</button>
      <span class="task-main"><strong>${task.title}</strong><small>${taskMeta(task, contextDate)}</small></span>
      <span class="chevron">${icon('arrow')}</span>
    </div>`;
  }

  function renderTasks() {
    const items = visibleTasks();
    const todayItems = items.filter((task) => isOccurrence(task, today));
    const weekItems = items.filter((task) => !isOccurrence(task, today) && task.date > today && task.date <= addDays(today, 7));
    const laterItems = items.filter((task) => !todayItems.includes(task) && !weekItems.includes(task));
    const group = (label, list, contextDate) => list.length ? `<section class="task-group"><header><strong>${label}</strong><span>${list.length}</span></header>${list.map((task) => renderTaskItem(task, contextDate || task.date)).join('')}</section>` : '';
    const chips = [`<button class="filter-chip chip-all ${state.filter === 'all' ? 'active' : ''}" data-action="set-filter" data-filter="all">全部</button>`]
      .concat(tags().map((tag) => `<button class="filter-chip ${state.filter === tag.id ? 'active' : ''}" style="--chip-color:${tag.color}" data-action="set-filter" data-filter="${tag.id}">${tag.name}</button>`))
      .join('');
    const body = items.length
      ? group('今天', todayItems, today) + group('7天内', weekItems) + group('稍后', laterItems)
      : '<p class="list-empty">暂时没有事项</p>';
    return `<header class="topbar"><span></span><h1>事项</h1><button class="topbar-action" data-action="reset-today" title="回到今天并刷新">${icon('refresh')}</button></header>
      <div class="filter-bar">${chips}</div>
      <div class="task-scroll">${body}</div>`;
  }

  function monthDates() {
    const anchor = dateAtNoon(today);
    anchor.setMonth(anchor.getMonth() + state.monthOffset, 1);
    const offset = (anchor.getDay() + 6) % 7;
    anchor.setDate(anchor.getDate() - offset);
    return Array.from({ length: 42 }, (_, index) => { const result = new Date(anchor); result.setDate(result.getDate() + index); return iso(result); });
  }

  function tasksFor(date) {
    return data.tasks.filter((task) => isOccurrence(task, date) && (!data.settings.hideCompleted || task.status !== 'done'));
  }

  function renderMonth() {
    const dates = monthDates();
    const currentMonth = dateAtNoon(dates[17]).getMonth();
    return `<header class="topbar"><span></span><h1>规划</h1><button class="topbar-action" data-action="reset-today" title="回到本月">${icon('refresh')}</button></header>
      <div class="month-scroll">
        <div class="month-head"><strong>${monthTitle(dates[17])}</strong><div class="month-nav"><button data-action="month-prev" aria-label="上一个月">${icon('back')}</button><button data-action="month-next" aria-label="下一个月">${icon('next')}</button></div></div>
        <div class="month-weekdays">${['一', '二', '三', '四', '五', '六', '日'].map((label) => `<span>${label}</span>`).join('')}</div>
        <div class="month-grid">${dates.map((date) => {
          const entries = tasksFor(date);
          const muted = dateAtNoon(date).getMonth() !== currentMonth;
          return `<section class="month-day ${muted ? 'is-muted' : ''} ${date === today ? 'is-today' : ''}" data-action="open-task" data-date="${date}">
            <span class="day-num">${dateAtNoon(date).getDate()}</span>
            <div class="day-items">${entries.slice(0, 2).map((task) => `<span class="day-item ${task.status === 'done' ? 'is-done' : ''}" style="--task-color:${tagFor(task.tagId).color}">${task.title}</span>`).join('')}${entries.length > 2 ? `<span class="day-more">+${entries.length - 2}</span>` : ''}</div>
          </section>`;
        }).join('')}</div>
      </div>`;
  }

  function renderMine() {
    const profile = data.profile;
    return `<header class="topbar"><span></span><h1>我的</h1><span></span></header>
      <div class="mine-scroll">
        <section class="mine-card"><span class="avatar-mark"><span>时</span><i></i></span><div><strong>${profile.name}</strong><small>${profile.phone} · 本地时光记录者</small></div></section>
        <section class="mine-section">
          <button class="mine-row" data-action="check-update"><span><b>检查更新</b><small>当前版本 v${APP_VERSION}</small></span><span class="row-right">${icon('update')}<span class="chevron">${icon('arrow')}</span></span></button>
          <div class="mine-row"><span><b>隐藏已完成/已失败</b><small>列表与日历中隐藏已结束事项</small></span><label class="switch"><input data-setting="hideCompleted" type="checkbox" ${data.settings.hideCompleted ? 'checked' : ''}/><i></i></label></div>
          <div class="mine-row"><span><b>仅显示本周</b><small>事项面板聚焦当前一周</small></span><label class="switch"><input data-setting="weekOnly" type="checkbox" ${data.settings.weekOnly ? 'checked' : ''}/><i></i></label></div>
        </section>
        <section class="mine-section">
          <button class="mine-row" data-action="restore-data"><span><b>恢复演示数据</b><small>清除本原型的浏览器本地数据</small></span><span class="chevron">${icon('arrow')}</span></button>
          <div class="mine-row"><span><b>关于岁岁时光</b><small>移动端原型 · 数据仅存本机</small></span><span class="row-right">v${APP_VERSION}</span></div>
        </section>
      </div>`;
  }

  function renderTabbar() {
    const tabs = [['tasks', '事项', 'tasks'], ['plan', '规划', 'plan'], ['mine', '我的', 'mine']];
    return `<nav class="tabbar">${tabs.map(([id, label, iconName]) => `<button class="${state.tab === id ? 'active' : ''}" data-action="switch-tab" data-tab="${id}"><span class="tab-icon">${icon(iconName)}</span>${label}</button>`).join('')}</nav>`;
  }

  function initialDraft(task, date) {
    return clone(task || {
      id: '', title: '', tagId: state.filter !== 'all' ? state.filter : 'growth', date: date || today, schedule: 'allDay', time: '', priority: 'notUrgentImportant', repeat: 'none', notes: '', status: 'todo', subtasks: []
    });
  }

  function repeatLabel(value) {
    return ({ none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' })[value] || '不重复';
  }

  function renderTaskSheet() {
    if (state.modal !== 'task') return '';
    const task = state.draft;
    const priorities = [['urgent', '重要且紧急'], ['important', '重要不紧急'], ['notUrgentImportant', '不重要紧急'], ['notUrgent', '不重要不紧急']];
    const repeats = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
    return `<div class="sheet-layer" data-action="close-modal"><form class="sheet" data-stop="true">
      <header>${task.id ? `<button type="button" class="sheet-delete" data-action="delete-task">删除</button>` : '<span></span>'}<strong>${task.id ? '编辑事项' : '新建事项'}</strong><button type="button" class="sheet-save" data-action="save-task">保存</button></header>
      <div class="sheet-body">
        <input class="title-input" data-draft="title" value="${task.title}" placeholder="输入事项名称" maxlength="80" />
        <div class="sheet-row"><span class="row-label">${icon('clock')}日期</span><input data-draft="date" type="date" value="${task.date}" /></div>
        <div class="sheet-row"><span class="row-label">${icon('repeat')}重复</span><span class="row-value">${repeatLabel(task.repeat)}</span></div>
        <div class="option-grid">${repeats.map((value) => `<button type="button" class="option-chip ${task.repeat === value ? 'active' : ''}" data-action="set-repeat" data-value="${value}">${repeatLabel(value)}</button>`).join('')}</div>
        <div class="sheet-row"><span class="row-label">${icon('flag')}优先级</span></div>
        <div class="option-grid">${priorities.map(([value, label]) => `<button type="button" class="option-chip ${task.priority === value ? 'active' : ''}" data-action="set-priority" data-value="${value}">${label}</button>`).join('')}</div>
        <div class="sheet-row"><span class="row-label">▦ 分类</span></div>
        <div class="option-grid">${tags().map((tag) => `<button type="button" class="option-chip ${task.tagId === tag.id ? 'active' : ''}" data-action="set-tag" data-tag="${tag.id}">${tag.name}</button>`).join('')}</div>
        <button type="button" class="subtask-add" data-action="add-subtask">${icon('plus')}添加子任务</button>
        ${task.subtasks.map((subtask, index) => `<div class="subtask-row"><button type="button" class="subtask-remove" data-action="remove-subtask" data-index="${index}">${icon('close')}</button><input data-subtask="${index}" value="${subtask}" maxlength="60" placeholder="子任务" /></div>`).join('')}
        <textarea class="note-area" data-draft="notes" placeholder="备注：记录一些细节，未来的自己会感谢你。">${task.notes}</textarea>
      </div>
    </form></div>`;
  }

  function renderUpdateSheet() {
    if (state.modal !== 'update') return '';
    const body = state.update === 'available'
      ? `<div class="update-body"><span class="update-icon">${icon('update')}</span><h2>发现新版本 v0.4.0</h2><p>当前版本 v${APP_VERSION} · 更新包约 12 MB</p><div class="update-notes">· 移动端首页与月视图全新上线<br/>· 事项支持子任务与重复规则<br/>· 修复若干已知问题</div><button class="primary-button" data-action="update-download">下载并安装</button><button class="ghost-button" data-action="close-modal">暂不更新</button></div>`
      : state.update === 'downloading'
        ? `<div class="update-body"><span class="update-icon">${icon('update')}</span><h2>正在下载更新</h2><p>界面示意 · 真实下载与安装需接入原生更新能力</p><div class="update-progress"><i style="width:62%"></i></div><button class="ghost-button" data-action="close-modal">后台下载</button></div>`
        : `<div class="update-body"><span class="update-icon">${icon('check')}</span><h2>当前已是最新版本</h2><p>岁岁时光 v${APP_VERSION}<br/>界面示意 · 真实检查需接入更新服务</p><button class="primary-button" data-action="close-modal">完成</button></div>`;
    return `<div class="sheet-layer" data-action="close-modal"><section class="sheet update-sheet" data-stop="true">${body}</section></div>`;
  }

  function render() {
    const page = state.tab === 'tasks' ? renderTasks() : state.tab === 'plan' ? renderMonth() : renderMine();
    app.innerHTML = `<div class="mobile-frame">${page}${state.tab !== 'mine' ? `<button class="fab" data-action="open-task" aria-label="新建事项">${icon('plus')}</button>` : ''}${renderTabbar()}</div>${renderTaskSheet()}${renderUpdateSheet()}`;
  }

  function openTask(id, date) {
    state.draft = initialDraft(id ? data.tasks.find((task) => task.id === id) : null, date);
    state.modal = 'task';
  }

  function saveTask() {
    const task = state.draft;
    if (!task.title.trim()) { window.alert('请先填写事项名称'); return; }
    task.title = task.title.trim();
    if (task.id) data.tasks = data.tasks.map((item) => item.id === task.id ? clone(task) : item);
    else { task.id = `t${Date.now()}`; data.tasks.unshift(clone(task)); }
    persist();
    state.modal = '';
  }

  function handleAction(target) {
    const action = target.dataset.action;
    if (!action) return;
    if (action === 'switch-tab') state.tab = target.dataset.tab;
    if (action === 'set-filter') state.filter = target.dataset.filter;
    if (action === 'open-task') openTask('', target.dataset.date);
    if (action === 'edit-task') openTask(target.dataset.task);
    if (action === 'toggle-task') { const task = data.tasks.find((item) => item.id === target.dataset.task); task.status = task.status === 'done' ? 'todo' : 'done'; persist(); }
    if (action === 'close-modal') { state.modal = ''; state.update = ''; }
    if (action === 'save-task') saveTask();
    if (action === 'delete-task') { data.tasks = data.tasks.filter((task) => task.id !== state.draft.id); persist(); state.modal = ''; }
    if (action === 'set-priority') state.draft.priority = target.dataset.value;
    if (action === 'set-tag') state.draft.tagId = target.dataset.tag;
    if (action === 'set-repeat') state.draft.repeat = target.dataset.value;
    if (action === 'add-subtask') state.draft.subtasks.push('');
    if (action === 'remove-subtask') state.draft.subtasks.splice(Number(target.dataset.index), 1);
    if (action === 'check-update') { state.modal = 'update'; state.update = 'latest'; }
    if (action === 'update-download') state.update = 'downloading';
    if (action === 'restore-data') { data = clone(initialData); persist(); state.modal = ''; }
    if (action === 'reset-today') state.monthOffset = 0;
    if (action === 'month-prev') state.monthOffset -= 1;
    if (action === 'month-next') state.monthOffset += 1;
    render();
  }

  app.addEventListener('click', (event) => {
    const settingTarget = event.target.closest('[data-setting]');
    if (settingTarget) return;
    const actionTarget = event.target.closest('[data-action]');
    const stopTarget = event.target.closest('[data-stop]');
    if (!actionTarget || (stopTarget && !stopTarget.contains(actionTarget))) return;
    if (actionTarget.dataset.action === 'toggle-task') event.stopPropagation();
    handleAction(actionTarget);
  });
  app.addEventListener('input', (event) => {
    const target = event.target;
    if (target.dataset.draft && state.draft) state.draft[target.dataset.draft] = target.value;
    if (target.dataset.subtask !== undefined && state.draft) state.draft.subtasks[Number(target.dataset.subtask)] = target.value;
  });
  app.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.setting) { data.settings[target.dataset.setting] = target.checked; persist(); render(); }
    if (target.dataset.draft === 'date' && state.draft) state.draft.date = target.value;
  });
  render();
})();
