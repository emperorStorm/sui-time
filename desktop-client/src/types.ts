export interface UserSession {
  id: string
  username: string
  displayName: string
  showCompletedByView: ShowCompletedByView
}

export type TaskView = 'all' | 'week' | 'month'

export type ShowCompletedByView = Record<TaskView, boolean>

export interface BootState {
  needsSetup: boolean
  session: UserSession | null
}

export interface Category {
  id: string
  name: string
  color: string
  icon: string
  sortOrder: number
}

export interface CategoryInput {
  id?: string
  name: string
  color: string
  icon: string
  sortOrder: number
}

export interface Task {
  id: string
  title: string
  categoryId: string | null
  categoryName: string | null
  categoryColor: string | null
  categoryIcon: string | null
  plannedDate: string | null
  plannedTime: string | null
  plannedEndTime: string | null
  scheduleKind: ScheduleKind
  priority: Priority
  repeatRule: string
  occurrenceOverrides: string
  reminderOffsets: number[]
  parentTaskId: string | null
  status: TaskStatus
  failureReason: string | null
  notes: string
  createdAt: number
  completedAt: number | null
  updatedAt: number
}

export interface TaskInput {
  id?: string
  title: string
  categoryId: string | null
  plannedDate: string | null
  plannedTime: string | null
  plannedEndTime: string | null
  scheduleKind: ScheduleKind
  priority: Priority
  repeatRule: string
  occurrenceOverrides: string
  reminderOffsets: number[]
  parentTaskId: string | null
  failureReason: string | null
  notes: string
}

export interface TaskChildInput {
  id?: string
  title: string
  status: Extract<TaskStatus, 'todo' | 'done'>
}

export interface TaskChildrenInput {
  parentTaskId: string
  children: TaskChildInput[]
  deletedIds: string[]
}

export type TaskStatus = 'todo' | 'done' | 'failed'
export type ScheduleKind = 'all_day' | 'point' | 'range'
export type Priority = 'urgent_important' | 'important_not_urgent' | 'urgent_not_important' | 'not_urgent_not_important'

export interface RepeatRule {
  kind: 'none' | 'daily' | 'every_days' | 'weekly' | 'weekly_slots' | 'workdays' | 'monthly' | 'monthly_slots' | 'yearly' | 'memory' | 'custom'
  interval?: number
  weekdays?: number[]
  monthDays?: number[]
  slots?: Array<{ day: number; time?: string }>
  endMode?: 'never' | 'date' | 'count'
  endDate?: string
  count?: number
}

export interface TaskQuery {
  search?: string
  startDate?: string
  endDate?: string
  includeCompleted: boolean
}
