// 先启动 Vite；可通过 PLAYWRIGHT_MODULE 指向已有 Playwright，无需修改项目依赖。
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const baseURL = process.env.SYNC_TEST_URL || 'http://127.0.0.1:5178'

async function openSettings(page) {
  await page.getByRole('button', { name: '账户与应用设置', exact: true }).click()
  await page.getByRole('button', { name: '账号与同步', exact: true }).click()
  await page.getByRole('heading', { name: '账号与同步', exact: true, level: 2 }).waitFor()
}

async function main() {
  const profile = await mkdtemp(join(tmpdir(), 'sui-sync-chromium-'))
  let context
  const errors = []
  try {
    context = await chromium.launchPersistentContext(profile, { ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : { channel: 'chromium' }), headless: true, viewport: { width: 1280, height: 900 } })
    const page = context.pages()[0]
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
    await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ json: { days: {} } }))
    await page.goto(baseURL)
    await openSettings(page)
    await page.getByRole('heading', { name: '尚未配置同步服务' }).waitFor()
    assert.equal(await page.locator('.sync-auth input').count(), 0)
    await page.getByRole('button', { name: '刷新状态', exact: true }).click()
    await page.getByRole('heading', { name: '尚未配置同步服务' }).waitFor()
    const fallback = await page.evaluate(async () => {
      const api = await import('/src/api/native.ts')
      const status = await api.getSyncStatus()
      const failures = []
      for (const action of [() => api.registerSyncAccount({ username: 'test', password: 'secret' }), () => api.loginSyncAccount({ username: 'test', password: 'secret' }), () => api.bindSync('merge'), api.nowSync, api.unbindSync]) {
        try { await action(); failures.push('未拒绝') } catch (error) { failures.push(error.message) }
      }
      const stop = await api.onSyncState(() => {})
      stop()
      return { status, failures }
    })
    assert.equal(fallback.status.configured, false)
    assert(fallback.failures.every(message => message.includes('桌面客户端')))
    const bridge = await page.evaluate(async () => {
      const api = await import('/src/api/native.ts')
      const calls = []
      const status = await api.getSyncStatus()
      let listener
      let received
      window.__TAURI_INTERNALS__ = {
        invoke: async (command, args) => { calls.push({ command, args }); return command === 'plugin:event|listen' ? 17 : status },
        transformCallback: callback => { listener = callback; return 9 }
      }
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
      try {
        await api.getSyncStatus()
        await api.registerSyncAccount({ username: 'bridge', password: 'password' })
        await api.loginSyncAccount({ username: 'bridge', password: 'password' })
        await api.bindSync('merge')
        await api.nowSync()
        await api.unbindSync()
        const stop = await api.onSyncState(value => { received = value })
        listener({ payload: status })
        await stop()
        return { calls, received, status }
      } finally {
        delete window.__TAURI_INTERNALS__
        delete window.__TAURI_EVENT_PLUGIN_INTERNALS__
      }
    })
    assert.deepEqual(bridge.calls.slice(0, 6), [
      { command: 'sync_get_status', args: {} },
      { command: 'sync_register', args: { input: { username: 'bridge', password: 'password' } } },
      { command: 'sync_login', args: { input: { username: 'bridge', password: 'password' } } },
      { command: 'sync_bind', args: { strategy: 'merge' } },
      { command: 'sync_now', args: {} },
      { command: 'sync_unbind', args: {} }
    ])
    assert.equal(bridge.calls[6].args.event, 'sync:state')
    assert.equal(bridge.calls[7].command, 'plugin:event|unlisten')
    assert.deepEqual(bridge.received, bridge.status)
    console.log('PASS 真实浏览器：品牌菜单、未配置空态、桌面专属降级、invoke 参数和事件桥接')
    await verifyMockUI(page, errors)
  } finally {
    await context?.close()
    await rm(profile, { recursive: true, force: true })
  }
}

async function verifyMockUI(page, errors) {
    // 仅在测试请求中替换同步桥接；生产浏览器仍然保持未配置空态。
    await page.route('**/src/api/native.ts', async route => {
      const response = await route.fetch()
      const source = await response.text()
      await route.fulfill({ response, body: source + `
getSyncStatus = async () => window.__syncMock.read();
registerSyncAccount = async input => window.__syncMock.action('register', input);
loginSyncAccount = async input => window.__syncMock.action('login', input);
bindSync = async strategy => window.__syncMock.action('bind', strategy);
cancelSyncInitialization = async () => window.__syncMock.action('cancelInit');
nowSync = async () => window.__syncMock.action('now');
unbindSync = async () => window.__syncMock.action('unbind');
onSyncState = async callback => { window.__syncMock.callback = callback; return () => { window.__syncMock.stopped++; window.__syncMock.callback = null; }; };
const originalListTasks = listTasks;
listTasks = async (...args) => { window.__syncMock.reads++; return originalListTasks(...args); };
` })
    })
    await page.addInitScript(() => {
      const mock = {
        state: { configured: true, bound: false, username: '', remoteEmpty: null, lastSyncAt: null, pendingCount: 3, needsReauth: false, syncing: false, error: null },
        calls: [], reads: 0, stopped: 0, callback: null, failLogin: true, failRead: false, failNow: false,
        read() { if (this.failRead) throw new Error('状态读取失败'); return { ...this.state } },
        emit(patch) { Object.assign(this.state, patch); this.callback?.({ ...this.state }) },
        async action(name, input) {
          this.calls.push({ name, input })
          if (name === 'login' && this.failLogin) throw new Error('用户名或密码错误')
          if (name === 'login' || name === 'register') Object.assign(this.state, { username: input.username, remoteEmpty: false, needsReauth: false, error: null })
          if (name === 'bind') Object.assign(this.state, { bound: true, initializing: false, lastSyncAt: Date.now(), pendingCount: 0, error: null })
          if (name === 'cancelInit') Object.assign(this.state, { initializing: false, error: null })
          if (name === 'now') {
            if (this.failNow) throw new Error('同步服务暂不可用')
            this.emit({ syncing: true })
            await new Promise(resolve => setTimeout(resolve, 80))
            this.emit({ syncing: false, lastSyncAt: Date.now(), pendingCount: 0, error: null })
          }
          if (name === 'unbind') Object.assign(this.state, { bound: false, username: '', remoteEmpty: null, lastSyncAt: null })
          return { ...this.state }
        }
      }
      window.__syncMock = mock
    })
    await page.reload()
    await openSettings(page)
    const sidebarRefresh = page.getByRole('button', { name: '回到今天并同步数据', exact: true })
    await sidebarRefresh.click()
    await page.getByText('同步未完成：尚未绑定同步账号，已刷新本机数据', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__syncMock.calls.filter(call => call.name === 'now').length), 0)
    await page.evaluate(() => window.__syncMock.emit({ configured: false }))
    await sidebarRefresh.click()
    await page.getByText('同步未完成：尚未配置同步服务，已刷新本机数据', { exact: true }).waitFor()
    await page.evaluate(() => window.__syncMock.emit({ configured: true, initializing: true }))
    await sidebarRefresh.click()
    await page.getByText('同步未完成：首次上传尚未完成，请到账号与同步中继续', { exact: true }).waitFor()
    await page.evaluate(() => window.__syncMock.emit({ initializing: false, needsReauth: true }))
    await sidebarRefresh.click()
    await page.getByText('同步未完成：同步账号登录已失效，请重新登录', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__syncMock.calls.filter(call => call.name === 'now').length), 0)
    await page.evaluate(() => window.__syncMock.emit({ needsReauth: false }))
    await page.locator('input[name="sync-username"]').fill('同步测试账号')
    await page.locator('input[name="sync-password"]').fill('test-password')
    const passwordToggle = page.getByRole('button', { name: '显示密码', exact: true })
    assert.equal(await page.locator('input[name="sync-password"]').getAttribute('type'), 'password')
    await passwordToggle.click()
    assert.equal(await page.locator('input[name="sync-password"]').getAttribute('type'), 'text')
    assert.equal(await page.locator('input[name="sync-password"]').inputValue(), 'test-password')
    await page.getByRole('button', { name: '隐藏密码', exact: true }).click()
    assert.equal(await page.locator('input[name="sync-password"]').getAttribute('type'), 'password')
    assert.equal(await page.locator('input[name="sync-password"]').inputValue(), 'test-password')
    await page.getByRole('button', { name: '登录服务器账号', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '用户名或密码错误' }).waitFor()
    assert.equal(await page.locator('input[name="sync-password"]').inputValue(), 'test-password')
    await page.evaluate(() => { window.__syncMock.failLogin = false })
    await page.getByRole('button', { name: '登录服务器账号', exact: true }).click()
    await page.getByText('远端已有数据', { exact: true }).waitFor()
    assert.equal(await page.locator('input[name="sync-password"]').inputValue(), '')
    await page.evaluate(() => window.__syncMock.emit({ initializing: true }))
    await page.getByText('首次上传进行中，可继续重试', { exact: true }).waitFor()
    assert.equal(await page.locator('.sync-strategy input').count(), 0)
    await page.getByRole('button', { name: '取消首次上传', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    assert.equal(await page.evaluate(() => window.__syncMock.calls.some(call => call.name === 'cancelInit')), false)
    await page.getByRole('button', { name: '取消首次上传', exact: true }).click()
    await page.getByRole('button', { name: '确认取消首次上传', exact: true }).click()
    assert.equal(await page.locator('.sync-strategy input').count(), 3)
    await page.evaluate(() => window.__syncMock.emit({ initializing: true }))
    await page.getByRole('button', { name: '继续首次上传', exact: true }).click()
    await page.getByText('已绑定本机数据', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__syncMock.calls.at(-1).input), 'upload')
    await page.evaluate(() => { window.__syncMock.calls = window.__syncMock.calls.filter(call => call.name !== 'bind'); window.__syncMock.emit({ initializing: false, bound: false }) })
    assert.equal(await page.locator('.sync-strategy input').count(), 3)
    await page.getByRole('radio', { name: '使用远端替换本机', exact: false }).check()
    assert.equal(await page.getByRole('button', { name: '确认绑定', exact: true }).isDisabled(), true)
    assert.equal(await page.evaluate(() => window.__syncMock.calls.filter(call => call.name === 'bind').length), 0)
    await page.getByRole('checkbox', { name: '我确认使用远端数据替换本机', exact: false }).check()
    await page.getByRole('radio', { name: '合并本机与远端', exact: false }).check()
    await page.getByRole('radio', { name: '使用远端替换本机', exact: false }).check()
    assert.equal(await page.getByRole('checkbox').isChecked(), false)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: '确认绑定', exact: true }).click()
    await page.getByText('已绑定本机数据', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__syncMock.calls.find(call => call.name === 'bind').input), 'remote')
    const before = await page.evaluate(() => window.__syncMock.reads)
    await page.getByRole('button', { name: '立即同步', exact: true }).click()
    await page.getByRole('button', { name: '立即同步', exact: true }).waitFor()
    await page.waitForFunction(count => window.__syncMock.reads > count, before)
    assert.equal(await page.evaluate(() => window.__syncMock.calls.filter(call => call.name === 'now').length), 1)
    const readsAfterSuccess = await page.evaluate(() => window.__syncMock.reads)
    await page.evaluate(() => { window.__syncMock.emit({}); window.__syncMock.emit({}) })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(() => window.__syncMock.reads), readsAfterSuccess)
    await sidebarRefresh.evaluate(button => { button.click(); button.click() })
    await page.getByText('数据同步完成', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__syncMock.calls.filter(call => call.name === 'now').length), 2)
    assert(await page.evaluate(() => window.__syncMock.reads) > readsAfterSuccess)
    await page.evaluate(() => { window.__syncMock.failNow = true })
    await sidebarRefresh.click()
    await page.getByText('同步未完成：同步服务暂不可用', { exact: true }).waitFor()
    assert.equal(await sidebarRefresh.isDisabled(), false)
    await page.evaluate(() => { window.__syncMock.failNow = false })
    await page.getByRole('button', { name: '纪念日', exact: true }).click()
    await page.getByRole('button', { name: '新增纪念日', exact: true }).click()
    const draftTitle = page.getByPlaceholder('例如：我们的相伴纪念日')
    await draftTitle.fill('未保存的纪念日草稿')
    const readsBeforeDraftSync = await page.evaluate(() => window.__syncMock.reads)
    await page.evaluate(() => window.__syncMock.emit({ lastSyncAt: Date.now() + 1000 }))
    await page.waitForFunction(count => window.__syncMock.reads > count, readsBeforeDraftSync)
    assert.equal(await draftTitle.inputValue(), '未保存的纪念日草稿')
    await page.getByRole('dialog', { name: '新增纪念日' }).getByRole('button', { name: '取消', exact: true }).click()
    await openSettings(page)
    await page.evaluate(() => { window.__syncMock.emit({ error: '服务器暂不可用', pendingCount: 7 }) })
    await page.getByText('失败原因：服务器暂不可用', { exact: true }).waitFor()
    await page.getByText('7 项', { exact: true }).waitFor()
    await page.evaluate(() => { window.__syncMock.emit({ needsReauth: true }) })
    await page.getByRole('heading', { name: '重新登录服务器账号' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '立即同步', exact: true }).isDisabled(), true)
    await page.locator('input[name="sync-password"]').fill('new-password')
    await page.getByRole('button', { name: '登录服务器账号', exact: true }).click()
    await page.getByRole('button', { name: '解除绑定', exact: true }).click()
    await page.getByRole('button', { name: '确认解除绑定', exact: true }).click()
    await page.getByText('尚未绑定', { exact: true }).waitFor()
    await page.getByRole('button', { name: '改为注册账号', exact: true }).click()
    await page.locator('input[name="sync-password"]').fill('register-password')
    await page.getByRole('button', { name: '注册服务器账号', exact: true }).click()
    await page.getByRole('radio', { name: '上传本机数据', exact: false }).check()
    await page.getByRole('button', { name: '确认绑定', exact: true }).click()
    await page.getByText('已绑定本机数据', { exact: true }).waitFor()
    await page.evaluate(() => window.__syncMock.emit({ bound: false, remoteEmpty: true }))
    await page.getByText('远端为空', { exact: true }).waitFor()
    await page.getByRole('radio', { name: '使用远端替换本机', exact: false }).check()
    await page.getByText('远端为空，本机数据将被清空', { exact: false }).waitFor()
    await page.getByRole('radio', { name: '合并本机与远端', exact: false }).check()
    await page.getByRole('button', { name: '确认绑定', exact: true }).click()
    await page.getByText('已绑定本机数据', { exact: true }).waitFor()
    const strategies = await page.evaluate(() => window.__syncMock.calls.filter(call => call.name === 'bind').map(call => call.input))
    assert.deepEqual(strategies, ['remote', 'upload', 'merge'])
    console.log('PASS 模拟交互：登录失败与重试、注册、远端状态、三种策略、替换确认、手动同步、重新登录、解绑、事件去重')

    const callsBeforeFocus = await page.evaluate(() => window.__syncMock.calls.filter(call => call.name === 'now').length)
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')) })
    await page.waitForFunction(count => window.__syncMock.calls.filter(call => call.name === 'now').length > count && !window.__syncMock.state.syncing, callsBeforeFocus)
    assert.equal(await page.evaluate(() => window.__syncMock.calls.filter(call => call.name === 'now').length), callsBeforeFocus + 1)
    await page.evaluate(() => { window.__syncMock.failRead = true })
    await page.getByRole('button', { name: '刷新状态', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '状态读取失败' }).waitFor()
    await page.setViewportSize({ width: 800, height: 700 })
    assert.equal(await page.locator('.sync-settings').evaluate(el => el.scrollWidth <= el.clientWidth), true)
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true)
    // 卸载应用验证本次订阅被释放。
    await page.evaluate(async () => {
      const app = document.querySelector('#app').__vue_app__
      app.unmount()
    })
    assert.equal(await page.evaluate(() => window.__syncMock.stopped), 1)
    assert.deepEqual(errors, [])
    console.log('PASS 聚焦静默同步去重、读取失败、窄窗口无横向溢出、卸载清理订阅、无页面异常')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
