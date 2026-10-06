import { Solar } from 'lunar-typescript'
import { dateOrdinal } from '../../../shared/anniversary.mjs'

export { anniversaryState, orderedAnniversaries, anniversaryTypes, anniversaryThemes, localToday } from '../../../shared/anniversary.mjs'

export function anniversaryCalendar(date) {
  dateOrdinal(date)
  const [year, month, day] = date.split('-').map(Number)
  const solar = Solar.fromYmd(year, month, day)
  const lunar = solar.getLunar()
  return { lunar: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`, zodiac: lunar.getYearShengXiao(), star: `${solar.getXingZuo()}座`, weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][solar.getWeek()] }
}

export async function chooseAnniversaryPhoto() {
  const selection = await new Promise((resolve, reject) => uni.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album'], success: resolve, fail: reject }))
  const path = selection.tempFilePaths[0]
  // #ifdef H5
  const blob = await fetch(path).then(response => response.blob())
  if (blob.size > 20 * 1024 * 1024) throw new Error('原照片不能超过 20MiB')
  const image = new Image()
  const url = URL.createObjectURL(blob)
  try {
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
      const result = canvas.toDataURL('image/jpeg', quality)
      if ((result.length - 23) * 3 / 4 <= 300 * 1024) return result
    }
    throw new Error('照片压缩后仍超过 300KiB，请选择较小的照片')
  } finally { URL.revokeObjectURL(url); if (path.startsWith('blob:')) URL.revokeObjectURL(path) }
  // #endif
  // #ifdef APP-PLUS
  const info = await new Promise((resolve, reject) => uni.getImageInfo({ src: path, success: resolve, fail: reject }))
  const ratio = Math.min(1, 1280 / Math.max(info.width, info.height))
  const temporaryPath = `_doc/anniversary-import-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  try {
    await new Promise((resolve, reject) => plus.zip.compressImage({ src: path, dst: temporaryPath, overwrite: true, format: 'jpg', quality: 65, width: `${Math.max(1, Math.round(info.width * ratio))}px`, height: `${Math.max(1, Math.round(info.height * ratio))}px` }, resolve, reject))
    const entry = await new Promise((resolve, reject) => plus.io.resolveLocalFileSystemURL(temporaryPath, resolve, reject))
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
    if (file.size > 300 * 1024) throw new Error('照片压缩后仍超过 300KiB，请选择较小的照片')
    const data = await new Promise((resolve, reject) => {
      const reader = new plus.io.FileReader()
      reader.onloadend = event => resolve(event.target.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    if (!data || (data.length - 23) * 3 / 4 > 300 * 1024) throw new Error('照片压缩后仍超过 300KiB，请选择较小的照片')
    return data.replace('data:image/jpg;', 'data:image/jpeg;')
  } finally {
    await new Promise(resolve => plus.io.resolveLocalFileSystemURL(temporaryPath, entry => entry.remove(resolve, resolve), resolve))
  }
  // #endif
}
