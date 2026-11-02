import { AUTH_STORAGE_KEY, SYNC_BASE_URL } from '../utils/sync-config.js'

export function readAuth() {
  const value = uni.getStorageSync(AUTH_STORAGE_KEY)
  return value && typeof value === 'object' ? value : null
}

export function writeAuth(value) {
  if (value) uni.setStorageSync(AUTH_STORAGE_KEY, value)
  else uni.removeStorageSync(AUTH_STORAGE_KEY)
}

export function request(path, { method = 'GET', data, auth = readAuth() } = {}) {
  if (!SYNC_BASE_URL) return Promise.reject(new Error('此版本尚未配置同步服务地址'))
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${SYNC_BASE_URL}${path}`, method, data, timeout: 30000,
      header: { 'Content-Type': 'application/json', ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}) },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data)
        const body = response.data || {}
        const error = new Error(body.error?.message || body.message || `同步请求失败（${response.statusCode}）`)
        error.status = response.statusCode
        error.code = body.error?.code || body.code
        reject(error)
      },
      fail(error) { reject(new Error(error.errMsg || '无法连接同步服务，请检查网络后重试')) }
    })
  })
}

export async function authenticate(mode, username, password, deviceId) {
  if (!['login', 'register'].includes(mode)) throw new Error('账号操作无效')
  if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username.trim())) throw new Error('用户名需为 3-32 位字母、数字、下划线、点或短横线')
  if (password.length < 8 || password.length > 72) throw new Error('密码长度需为 8-72 位')
  const result = await request(`/api/v1/auth/${mode}`, {
    method: 'POST', auth: null,
    data: { username: username.trim(), password, deviceId, deviceName: '岁岁时光移动端', platform: 'uni-app' }
  })
  if (!result?.token || !result.user?.id || !result.user?.username) throw new Error('同步服务返回的账号信息无效')
  return { token: result.token, expiresAt: result.expiresAt, user: result.user }
}

export async function revokeAuth(auth) {
  if (auth?.token) await request('/api/v1/auth/logout', { method: 'POST', auth })
}
