export function toast(title, icon = 'none') {
  uni.showToast({ title, icon })
}

export function confirm(content, { title = '提示' } = {}) {
  return new Promise((resolve, reject) => {
    uni.showModal({ title, content, success: (res) => resolve(res.confirm), fail: () => reject(new Error('确认窗口无法打开，请重试')) })
  })
}

export function nav(url) {
  uni.navigateTo({ url })
}

export function back() {
  uni.navigateBack()
}

export function switchTab(url) {
  uni.switchTab({ url })
}

export function isApp() {
  // #ifdef APP-PLUS
  return true
  // #endif
  return false
}
