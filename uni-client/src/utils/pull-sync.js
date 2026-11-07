import { ref, nextTick, onBeforeUnmount } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { manualSync } from '../api/sync.js'
import { toast } from './platform.js'

export function usePullSync(reload) {
  const refreshing = ref(false)
  let visible = false
  let generation = 0
  onShow(() => { visible = true })
  const hide = () => { visible = false; generation++ }
  onHide(hide)
  onUnload(hide)
  onBeforeUnmount(hide)

  async function refresh() {
    if (refreshing.value) return
    refreshing.value = true
    const started = generation
    let errorMessage = ''
    try {
      // 确保即时失败也会先渲染触发状态，再恢复原生刷新控件。
      await nextTick()
      await manualSync()
    } catch (error) {
      errorMessage = error.message || String(error)
    }
    try {
      if (visible && started === generation) {
        if (!reload()) errorMessage = errorMessage ? `${errorMessage}；本机数据读取失败，请重试` : '同步已完成，但本机数据读取失败，请重试'
        if (errorMessage) uni.showModal({ title: '同步未完成', content: errorMessage, showCancel: false })
        else toast('同步完成')
      }
    } finally {
      refreshing.value = false
    }
  }
  return { refreshing, refresh }
}
