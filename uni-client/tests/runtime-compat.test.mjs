import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { babelParse, parse } from '@vue/compiler-sfc'
import { entriesToObject } from '../src/utils/collections.js'

test('键值对构造保留普通对象、重复键、符号键和特殊自有属性语义', () => {
  assert.deepEqual(entriesToObject([]), {})
  const symbol = Symbol('key')
  const marker = { polluted: true }
  const result = entriesToObject([['title', '旧'], ['title', '新'], ['__proto__', marker], ['hasOwnProperty', null], ['constructor', 3], [symbol, 4]])
  assert.equal(Object.getPrototypeOf(result), Object.prototype)
  assert.equal(result.title, '新')
  assert.equal(result.__proto__, marker)
  assert.equal(result.polluted, undefined)
  assert.equal(result.hasOwnProperty, null)
  assert.equal(result.constructor, 3)
  assert.equal(result[symbol], 4)
  assert.deepEqual(Object.getOwnPropertyDescriptor(result, '__proto__'), { value: marker, enumerable: true, writable: true, configurable: true })
})

test('四个内建 API 在模块加载前缺失时，真实存储、弹窗、规划和同步回归通过', { timeout: 120000 }, () => {
  const bootstrap = 'Object.hasOwn = Object.fromEntries = Array.prototype.flat = Array.prototype.flatMap = undefined;'
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, [
    '--experimental-vm-modules', '--test', '--test-name-pattern=缺少四个内建 API',
    '--import', `data:text/javascript,${encodeURIComponent(bootstrap)}`,
    'tests/tasks.test.mjs', 'tests/task-editor.test.mjs', 'tests/sync.test.mjs', 'tests/storage-sync.test.mjs'
  ], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 110000 })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /# pass 4\b/)
  assert.match(result.stdout, /# fail 0\b/)
})

async function sourceFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) files.push(...await sourceFiles(url))
    else if (/\.(js|vue)$/.test(entry.name)) files.push(url)
  }
  return files
}

function unsupportedCalls(node, found) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    const callee = node.callee
    if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
      const name = callee.computed ? callee.property.value : callee.property.name
      const objectApi = callee.object.type === 'Identifier' && callee.object.name === 'Object' && ['hasOwn', 'fromEntries'].includes(name)
      if (objectApi || ['flat', 'flatMap'].includes(name)) found.push(`${name}:${node.loc.start.line}`)
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => unsupportedCalls(child, found))
    else if (value && typeof value === 'object' && typeof value.type === 'string') unsupportedCalls(value, found)
  }
}

test('移动端应用源码不得重新引入四类未兼容的内建调用', async () => {
  const violations = []
  for (const file of await sourceFiles(new URL('../src/', import.meta.url))) {
    const source = await readFile(file, 'utf8')
    const blocks = file.pathname.endsWith('.vue') ? (() => {
      const { descriptor } = parse(source)
      return [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean)
    })() : [source]
    for (const block of blocks) {
      const found = []
      unsupportedCalls(babelParse(block, { sourceType: 'module' }), found)
      for (const call of found) violations.push(`${fileURLToPath(file)}:${call}`)
    }
  }
  assert.deepEqual(violations, [])
})
