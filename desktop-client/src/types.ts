export interface UserSession {
  id: string
  username: string
  displayName: string
  showCompletedByView: ShowCompletedByView
}

export interface HolidayDay {
  date: string
  name: string
  isOffDay: boolean
}

export type TaskView = 'all' | 'week' | 'month'

export type ShowCompletedByView = Record<TaskView, boolean>

export interface BootState {
  needsSetup: boolean
  session: UserSession | null
}

export interface AnniversarySummary {
  id: string
  kind: 'countdown' | 'anniversary' | 'birthday' | 'holiday'
  title: string
  date: string
  notes: string
  pinned: boolean
  theme: 'sky' | 'warm' | 'night'
  createdAt: number
  updatedAt: number
}

export interface Anniversary extends AnniversarySummary {
  photos: string[]
  coverIndex: number
}

export type AnniversaryInput = Omit<Anniversary, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

export interface AnniversaryRecord {
  anniversaryId: string
  date: string
  notes: string
  confirmedAt: number | null
  title: string
  kind: AnniversarySummary['kind']
  originalDate: string
  createdAt: number
  updatedAt: number
}

export interface AnniversaryRecordInput {
  anniversaryId: string
  date: string
  notes: string
  confirmed: boolean
}

export interface AnniversaryOccurrence {
  anniversaryId: string
  date: string
  title: string
  kind: AnniversarySummary['kind']
  originalDate: string
  notes: string
  label: string
  years: number
  adjusted: boolean
  record: AnniversaryRecord | null
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
  sortOrder: number
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
  sortOrder: number
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
