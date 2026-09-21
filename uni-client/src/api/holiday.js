const HOLIDAY_DATA_URL = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master'
const HOLIDAY_REQUEST_TIMEOUT = 8000
const HOLIDAY_CACHE_KEY = 'sui-time-mobile:holiday-calendar:v1'

const holidayRequests = new Map()

export function getCachedHolidayCalendar(years) {
  const cache = readHolidayCache()
  return holidayDateMap(years.flatMap((year) => cache[String(year)] || []))
}

export async function refreshHolidayCalendar(years, force = true) {
  const uniqueYears = [...new Set(years.filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100))]
  const results = await Promise.all(uniqueYears.map((year) => loadHolidayYear(year, force)))
  return holidayDateMap(results.flatMap((days) => days || []))
}

function readHolidayCache() {
  try {
    let raw = uni.getStorageSync(HOLIDAY_CACHE_KEY)
    if (typeof raw === 'string') raw = JSON.parse(raw)
    if (raw && raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) raw = raw.data
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.entries(raw).reduce((result, [year, days]) => {
      const normalized = normalizeHolidayDays(Number(year), days)
      if (normalized) result[year] = normalized
      return result
    }, {})
  } catch (error) {
    return {}
  }
}

function saveHolidayYear(year, days) {
  try {
    const cache = readHolidayCache()
    cache[String(year)] = days
    uni.setStorageSync(HOLIDAY_CACHE_KEY, cache)
  } catch (error) {
    // 缓存不可用时不阻断月历展示。
  }
}

function loadHolidayYear(year, force) {
  const cached = readHolidayCache()[String(year)] || null
  if (!force && cached) return Promise.resolve(cached)
  const existingRequest = holidayRequests.get(year)
  if (existingRequest) return existingRequest
  const request = fetchHolidayYear(year, cached)
  holidayRequests.set(year, request)
  void request.finally(() => holidayRequests.delete(year))
  return request
}

async function fetchHolidayYear(year, fallback) {
  try {
    const payload = await requestHolidayYear(year)
    const days = normalizeHolidayDays(year, payload?.days, payload?.year)
    if (!days || payload?.year !== year) throw new Error('节假日数据格式无效')
    saveHolidayYear(year, days)
    return days
  } catch (error) {
    return fallback
  }
}

function requestHolidayYear(year) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${HOLIDAY_DATA_URL}/${year}.json`,
      timeout: HOLIDAY_REQUEST_TIMEOUT,
      success: (response) => {
        if (typeof response.statusCode === 'number' && (response.statusCode < 200 || response.statusCode >= 300)) {
          reject(new Error(`节假日数据请求失败（${response.statusCode}）`))
          return
        }
        let payload = response.data
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload)
          } catch (error) {
            reject(new Error('节假日数据格式无效'))
            return
          }
        }
        resolve(payload)
      },
      fail: reject
    })
  })
}

function normalizeHolidayDays(year, value, payloadYear) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Array.isArray(value)) return null
  if (payloadYear !== undefined && payloadYear !== year) return null
  const days = value.map((item) => {
    if (!item || typeof item !== 'object') return null
    const candidate = item
    if (typeof candidate.date !== 'string' || typeof candidate.name !== 'string' || typeof candidate.isOffDay !== 'boolean') return null
    if (!isHolidayDate(candidate.date, year) || !candidate.name.trim()) return null
    return { date: candidate.date, name: candidate.name.trim(), isOffDay: candidate.isOffDay }
  })
  if (days.some((item) => !item)) return null
  return [...new Map(days.map((item) => [item.date, item])).values()]
}

function isHolidayDate(value, year) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) !== year) return false
  const date = new Date(`${value}T12:00:00`)
  return date.getFullYear() === year && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10))
}

function holidayDateMap(days) {
  return days.reduce((result, day) => {
    result[day.date] = day
    return result
  }, {})
}
