import { onBeforeUnmount } from 'vue'
import { onTabItemTap, onUnload } from '@dcloudio/uni-app'

const eventName = 'main-tab-tap'
const drafts = new Map()

export function registerTabDrafts(pagePath, label, suspended) {
  drafts.set(pagePath, { label, suspended })
  const dispose = () => drafts.delete(pagePath)
  onUnload(dispose)
  onBeforeUnmount(dispose)
}

export function pendingTabDraft() {
  for (const draft of drafts.values()) {
    if (draft.suspended()) return draft.label
  }
  return ''
}

export function useMainTabTap(pagePath, onLeave) {
  const handleTap = (target) => {
    if (target && target !== pagePath) onLeave()
  }
  uni.$on(eventName, handleTap)
  onTabItemTap((event) => {
    const target = String(event?.pagePath || '').replace(/^\//, '')
    if (target) uni.$emit(eventName, target)
  })
  const dispose = () => uni.$off(eventName, handleTap)
  onUnload(dispose)
  onBeforeUnmount(dispose)
}
