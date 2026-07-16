export interface UserSession {
  id: string
  username: string
  displayName: string
}

export interface BootState {
  needsSetup: boolean
  session: UserSession | null
}

export interface Tag {
  id: string
  name: string
  color: string
  sortOrder: number
}

export interface TagInput {
  id?: string
  name: string
  color: string
  sortOrder: number
}

export interface Task {
  id: string
  title: string
  tagId: string | null
  tagName: string | null
  tagColor: string | null
  plannedDate: string | null
  plannedTime: string | null
  status: 'todo' | 'done'
  notes: string
  createdAt: number
  completedAt: number | null
  updatedAt: number
}

export interface TaskInput {
  id?: string
  title: string
  tagId: string | null
  plannedDate: string | null
  plannedTime: string | null
  notes: string
}

export interface TaskQuery {
  search?: string
  startDate?: string
  endDate?: string
  includeCompleted: boolean
}
