import { Solar } from 'lunar-typescript'
import { dateOrdinal } from '../../../shared/anniversary.mjs'

export { anniversaryState, orderedAnniversaries, anniversaryTypes, anniversaryThemes, localToday } from '../../../shared/anniversary.mjs'

export function anniversaryCalendar(date: string) {
  dateOrdinal(date)
  const [year, month, day] = date.split('-').map(Number)
  const solar = Solar.fromYmd(year, month, day)
  const lunar = solar.getLunar()
  return { lunar: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`, zodiac: lunar.getYearShengXiao(), star: `${solar.getXingZuo()}座`, weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][solar.getWeek()] }
}

export async function compressAnniversaryPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('请选择 JPG、PNG 或 WebP 照片')
  if (file.size > 20 * 1024 * 1024) throw new Error('原照片不能超过 20MiB')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const ratio = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法处理照片')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.7, 0.55, 0.4, 0.25]) {
      const encoded = canvas.toDataURL('image/jpeg', quality)
      if ((encoded.length - 23) * 3 / 4 <= 300 * 1024) return encoded
    }
    throw new Error('照片压缩后仍超过 300KiB，请选择较小的照片')
  } finally { URL.revokeObjectURL(url) }
}
