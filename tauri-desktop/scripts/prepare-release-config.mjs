import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const required = ['TAURI_UPDATER_PUBLIC_KEY', 'ALIYUN_OSS_BASE_URL', 'RELEASE_VERSION']
const missing = required.filter(name => !process.env[name]?.trim())
if (missing.length) {
  throw new Error(`缺少发布配置：${missing.join(', ')}`)
}

const baseUrl = process.env.ALIYUN_OSS_BASE_URL.replace(/\/+$/, '')
const config = {
  version: process.env.RELEASE_VERSION,
  plugins: {
    updater: {
      pubkey: process.env.TAURI_UPDATER_PUBLIC_KEY,
      endpoints: [`${baseUrl}/sui-time/latest.json`],
      windows: { installMode: 'passive' }
    }
  }
}
const output = path.resolve('src-tauri/tauri.conf.release.json')
fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`)
console.log(`已生成 ${output}`)
