// 生成 uni-app 底部 tabBar 与分类的线条风格 PNG 图标（无第三方依赖，直接编码 PNG）
// 用法：node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATIC = path.resolve(__dirname, '..', 'src', 'static')

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// 画布
class Canvas {
  constructor(size) { this.size = size; this.px = Buffer.alloc(size * size * 4) }
  set(x, y, r, g, b, a) {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return
    const i = (y * this.size + x) * 4
    const sa = a / 255, da = this.px[i + 3] / 255, oa = sa + da * (1 - sa)
    if (oa === 0) return
    this.px[i] = Math.round((r * sa + this.px[i] * da * (1 - sa)) / oa)
    this.px[i + 1] = Math.round((g * sa + this.px[i + 1] * da * (1 - sa)) / oa)
    this.px[i + 2] = Math.round((b * sa + this.px[i + 2] * da * (1 - sa)) / oa)
    this.px[i + 3] = Math.round(oa * 255)
  }
  line(x0, y0, x1, y1, color, w = 2) {
    const [r, g, b, a] = color
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy)
    const steps = Math.max(1, Math.ceil(len * 2))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = x0 + dx * t, y = y0 + dy * t
      const rad = w / 2
      for (let oy = -rad; oy <= rad; oy += 0.5) for (let ox = -rad; ox <= rad; ox += 0.5) {
        if (ox * ox + oy * oy <= rad * rad) this.set(x + ox, y + oy, r, g, b, a)
      }
    }
  }
  circle(cx, cy, rad, color, w = 2, fill = false) {
    const [r, g, b, a] = color
    for (let y = cy - rad - w; y <= cy + rad + w; y += 0.5) for (let x = cx - rad - w; x <= cx + rad + w; x += 0.5) {
      const d = Math.hypot(x - cx, y - cy)
      if (fill ? d <= rad : Math.abs(d - rad) <= w / 2) this.set(x, y, r, g, b, a)
    }
  }
  rect(x0, y0, x1, y1, color, w = 2, fill = false, rad = 0) {
    const [r, g, b, a] = color
    for (let y = y0; y <= y1; y += 0.5) for (let x = x0; x <= x1; x += 0.5) {
      if (fill) { this.set(x, y, r, g, b, a); continue }
      const nearL = Math.abs(x - x0) <= w / 2, nearR = Math.abs(x - x1) <= w / 2
      const nearT = Math.abs(y - y0) <= w / 2, nearB = Math.abs(y - y1) <= w / 2
      if ((nearL || nearR) && y >= y0 - w && y <= y1 + w) this.set(x, y, r, g, b, a)
      if ((nearT || nearB) && x >= x0 - w && x <= x1 + w) this.set(x, y, r, g, b, a)
    }
  }
  poly(points, color, w = 2, close = true) {
    for (let i = 0; i < points.length - (close ? 0 : 1); i++) {
      const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length]
      this.line(x0, y0, x1, y1, color, w)
    }
  }
  png() { return encodePng(this.size, this.size, this.px) }
}

const BLUE = [41, 150, 246, 255]
const GRAY = [138, 150, 163, 255]

// tabBar 图标（48×48）
function tabDiary(c, color) { // 书本
  c.rect(10, 8, 38, 40, color, 2.5)
  c.line(24, 8, 24, 40, color, 2.5)
  c.line(14, 16, 20, 16, color, 2); c.line(28, 16, 34, 16, color, 2)
  c.line(14, 22, 20, 22, color, 2); c.line(28, 22, 34, 22, color, 2)
}
function tabTasks(c, color) { // 勾选
  c.rect(8, 8, 40, 40, color, 2.5)
  c.poly([[15, 25], [22, 32], [34, 16]], color, 3, false)
}
function tabPlanning(c, color) { // 日历
  c.rect(8, 12, 40, 40, color, 2.5)
  c.line(8, 20, 40, 20, color, 2.5)
  c.line(16, 8, 16, 14, color, 2.5); c.line(32, 8, 32, 14, color, 2.5)
  c.circle(24, 30, 3, color, 0, true)
}
function tabGoals(c, color) { // 靶心
  c.circle(24, 24, 16, color, 2.5)
  c.circle(24, 24, 9, color, 2.5)
  c.circle(24, 24, 3, color, 0, true)
}
function tabProfile(c, color) { // 人像
  c.circle(24, 18, 8, color, 2.5)
  c.poly([[10, 40], [12, 32], [18, 28], [30, 28], [36, 32], [38, 40]], color, 2.5, false)
}
const tabIcons = { diary: tabDiary, tasks: tabTasks, planning: tabPlanning, goals: tabGoals, profile: tabProfile }

// 分类图标（64×64，描边）
function catMonitor(c, color) { c.rect(12, 14, 52, 40, color, 3); c.line(32, 40, 32, 48, color, 3); c.line(22, 50, 42, 50, color, 3) }
function catBookmark(c, color) { c.poly([[20, 12], [44, 12], [44, 52], [32, 42], [20, 52]], color, 3) }
function catFlower(c, color) { for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c.circle(32 + Math.cos(a) * 12, 32 + Math.sin(a) * 12, 7, color, 2.5) } c.circle(32, 32, 5, color, 0, true) }
function catStar(c, color) { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 10 : 20; p.push([32 + Math.cos(a) * r, 32 + Math.sin(a) * r]) } c.poly(p, color, 2.5) }
function catHeart(c, color) { c.circle(24, 24, 10, color, 2.5); c.circle(40, 24, 10, color, 2.5); c.poly([[15, 30], [32, 50], [49, 30]], color, 2.5, false) }
function catBolt(c, color) { c.poly([[36, 10], [20, 34], [30, 34], [26, 54], [44, 28], [34, 28]], color, 2.5) }
function catDot(c, color) { c.circle(32, 32, 16, color, 3) }
function catTriangle(c, color) { c.poly([[32, 14], [52, 48], [12, 48]], color, 3) }
function catDiamond(c, color) { c.poly([[32, 12], [50, 32], [32, 52], [14, 32]], color, 3) }
function catMusic(c, color) { c.circle(24, 44, 7, color, 2.5); c.line(31, 44, 31, 16, color, 2.5); c.line(31, 16, 46, 20, color, 2.5); c.line(46, 20, 46, 38, color, 2.5); c.circle(39, 38, 7, color, 2.5) }
function catSun(c, color) { c.circle(32, 32, 12, color, 2.5); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.line(32 + Math.cos(a) * 18, 32 + Math.sin(a) * 18, 32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24, color, 2.5) } }
function catSparkle(c, color) { c.poly([[32, 12], [36, 28], [52, 32], [36, 36], [32, 52], [28, 36], [12, 32], [28, 28]], color, 2.5) }
const catIcons = { monitor: catMonitor, bookmark: catBookmark, flower: catFlower, star: catStar, heart: catHeart, bolt: catBolt, dot: catDot, triangle: catTriangle, diamond: catDiamond, music: catMusic, sun: catSun, sparkle: catSparkle }

function hexToRgba(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
}

async function main() {
  await fs.mkdir(path.join(STATIC, 'tabbar'), { recursive: true })
  await fs.mkdir(path.join(STATIC, 'category'), { recursive: true })
  // tabBar：蓝/灰两态
  for (const [name, draw] of Object.entries(tabIcons)) {
    for (const [suffix, color] of [['', GRAY], ['-active', BLUE]]) {
      const c = new Canvas(48); draw(c, color)
      await fs.writeFile(path.join(STATIC, 'tabbar', `${name}${suffix}.png`), c.png())
    }
  }
  // 分类：12 个图标 × 8 色
  const palette = ['#2996f6', '#7299d5', '#12bd75', '#ff8545', '#f6b93b', '#a567e6', '#e65f7b', '#5bc8c8', '#8a96a3']
  for (const [name, draw] of Object.entries(catIcons)) {
    for (const hex of palette) {
      const c = new Canvas(64); draw(c, hexToRgba(hex))
      await fs.writeFile(path.join(STATIC, 'category', `${name}-${hex.slice(1)}.png`), c.png())
    }
  }
  console.log('生成完成：tabBar', Object.keys(tabIcons).length * 2, '个，分类', Object.keys(catIcons).length * palette.length, '个')
}
main().catch((e) => { console.error(e); process.exit(1) })
