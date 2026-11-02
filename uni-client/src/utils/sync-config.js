// CI 与本地构建共用同一个 Vite 环境变量。
export const SYNC_BASE_URL = (import.meta.env?.VITE_SUI_TIME_SYNC_BASE_URL || '').trim().replace(/\/+$/, '')
export const AUTH_STORAGE_KEY = 'sui-time-mobile:auth:v1'
export const LOCAL_WRITE_EVENT = 'local-write'
export const SYNC_APPLIED_EVENT = 'sync-applied'
export const MAX_PUSH_CHANGES = 200
export const MAX_PUSH_BYTES = 8 * 1024 * 1024
