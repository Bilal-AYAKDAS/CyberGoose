export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '--'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

export function joinRemotePath(base: string, child: string): string {
  const normalizedBase = base.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedChild = child.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalizedBase) return `/${normalizedChild}`
  if (!normalizedChild) return normalizedBase || '/'
  return `${normalizedBase}/${normalizedChild}`
}
