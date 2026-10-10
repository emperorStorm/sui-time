export const reminderOptions = [[0, '准时'], [5, '提前 5 分钟'], [15, '提前 15 分钟'], [30, '提前 30 分钟'], [60, '提前 1 小时'], [120, '提前 2 小时']]
export const priorities = [['urgent_important', '重要且紧急'], ['important_not_urgent', '重要不紧急'], ['urgent_not_important', '不重要紧急'], ['not_urgent_not_important', '不重要不紧急']]
const marks = ['I', 'II', 'III', 'IV']
const priorityRank = Object.fromEntries(priorities.map(([key], index) => [key, index]))

export function taskMark(task) {
  return task.status === 'done' ? '✓' : task.status === 'failed' ? '×' : marks[priorityRank[task.priority] ?? 3]
}

export function compareTasks(a, b) {
  const state = Number(a.status !== 'todo') - Number(b.status !== 'todo')
  const date = (a.plannedDate || '9999').localeCompare(b.plannedDate || '9999')
  const aTime = a.scheduleKind === 'all_day' ? '' : a.plannedTime || ''
  const bTime = b.scheduleKind === 'all_day' ? '' : b.plannedTime || ''
  return state || date || Number(!aTime) - Number(!bTime) || aTime.localeCompare(bTime)
    || (priorityRank[a.priority] ?? 3) - (priorityRank[b.priority] ?? 3)
    || (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id)
}

export function hasReminderTime(task) {
  return Boolean(!task.parentTaskId && task.plannedDate && task.plannedTime && task.scheduleKind !== 'all_day')
}

export function applyTaskTime(draft, patch) {
  const hadTime = hasReminderTime(draft)
  Object.assign(draft, patch)
  if (draft.scheduleKind === 'all_day') { draft.plannedTime = null; draft.plannedEndTime = null }
  if (!hasReminderTime(draft)) draft.reminderOffsets = []
  else if (!hadTime) draft.reminderOffsets = [0]
}

export function normalizeTask(input) {
  const task = { plannedDate: null, plannedTime: null, plannedEndTime: null, scheduleKind: input.plannedTime ? 'point' : 'all_day', reminderOffsets: [], occurrenceOverrides: '{}', ...input }
  if (!task.title?.trim()) throw new Error('请先填写事项名称')
  task.title = task.title.trim()
  if (task.plannedDate) {
    const value = new Date(`${task.plannedDate}T12:00:00`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(task.plannedDate) || !Number.isFinite(value.getTime()) || `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` !== task.plannedDate) throw new Error('请选择有效日期')
  }
  if (!['all_day', 'point', 'range'].includes(task.scheduleKind)) throw new Error('请选择有效时间类型')
  if (task.scheduleKind === 'all_day') { task.plannedTime = null; task.plannedEndTime = null; task.reminderOffsets = [] }
  else {
    if (!task.plannedDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.plannedTime || '')) throw new Error('请设置日期与时间')
    if (task.scheduleKind === 'range' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(task.plannedEndTime || '') || task.plannedEndTime <= task.plannedTime)) throw new Error('结束时间必须晚于开始时间')
    if (task.scheduleKind === 'point') task.plannedEndTime = null
  }
  const offsets = task.reminderOffsets
  if (!Array.isArray(offsets) || offsets.length > 3 || offsets.some((value, index) => !reminderOptions.some(([key]) => key === value) || (index && offsets[index - 1] >= value))) throw new Error('最多选择三个有效提醒')
  if (task.parentTaskId) task.reminderOffsets = []
  return task
}
