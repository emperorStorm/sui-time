export function androidCall(className, method, ...args) {
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.os.name === 'Android') {
    return plus.android.invoke(`fun.upup.suitime.${className}`, method, plus.android.runtimeMainActivity(), ...args)
  }
  // #endif
  return null
}

export function androidSettings(kind) { androidCall('AppSettings', 'open', kind) }

export function androidUpdate(method, ...args) {
  const result = androidCall('ApkInstallBridge', method, ...args)
  if (!result) throw new Error('安卓安装桥不可用，请使用浏览器下载')
  return JSON.parse(result)
}

export function androidPermissions() {
  const result = androidCall('AppSettings', 'state')
  return result ? JSON.parse(result) : { supported: false, notifications: false, exactAlarm: false, install: false }
}

export function requestNotificationPermission() {
  return new Promise(resolve => {
    // #ifdef APP-PLUS
    if (typeof plus !== 'undefined' && plus.os.name === 'Android') {
      if (Number(plus.os.version.split('.')[0]) >= 13) {
        plus.android.requestPermissions(['android.permission.POST_NOTIFICATIONS'], () => resolve(androidPermissions()), () => resolve(androidPermissions()))
        return
      }
    }
    // #endif
    resolve(androidPermissions())
  })
}
