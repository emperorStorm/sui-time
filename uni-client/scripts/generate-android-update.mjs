import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// 上传后完整读取公开 APK，并与本地产物核对；验证失败时绝不覆盖旧清单。
export async function generateAndroidUpdate({ tag, baseUrl, apk, release, manifest, output }, request = fetch) {
  const version = tag?.replace(/^v/, '')
  if (!/^v\d+\.\d+\.\d+$/.test(tag || '') || version !== manifest.versionName) throw new Error('标签与移动端构建版本不一致')
  const versionCode = Number(manifest.versionCode)
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error('移动端版本码无效')
  const root = new URL(baseUrl)
  if (root.protocol !== 'https:' || root.username || root.password || /(^|\.)github(?:usercontent)?\.com$/.test(root.hostname)) throw new Error('必须使用 OSS 的 HTTPS 分发域名')
  const name = `sui-time-${version}-android.apk`
  const url = `${baseUrl.replace(/\/+$/, '')}/sui-time/releases/${tag}/${name}`
  const local = await readFile(apk)
  if (local[0] !== 0x50 || local[1] !== 0x4b) throw new Error('本地产物不是有效 APK')
  const response = await request(url, { signal: AbortSignal.timeout(180000) })
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new Error(`APK 公开下载校验失败（HTTP ${response.status}）。OSS 默认域名禁止 APK 分发时需配置 HTTPS CNAME；旧清单保留。`)
  }
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of response.body) { bytes += chunk.length; hash.update(chunk) }
  if (bytes !== (await stat(apk)).size || hash.digest('hex') !== createHash('sha256').update(local).digest('hex')) throw new Error('公开下载内容与上传 APK 不一致，旧清单保留')
  const result = { version, versionCode, notes: release.body || '修复已知问题，优化使用体验。', url, pubDate: release.publishedAt || new Date().toISOString() }
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await generateAndroidUpdate({ tag: process.env.TAG, baseUrl: process.env.OSS_BASE_URL, apk: process.env.ANDROID_APK,
      release: JSON.parse(await readFile(process.env.ANDROID_RELEASE_INFO, 'utf8')),
      manifest: JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8')),
      output: 'latest-android.json' })
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
