export function entriesToObject(entries) {
  const result = {}
  for (const [key, value] of entries) {
    Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true })
  }
  return result
}
