import type { ConnectionProfile, ConnectionType } from '../types'

/**
 * Boyutları ondalık birimle biçimlendirir (1 MB = 10⁶ B), tasarım sistemindeki
 * TransferQueue kuralıyla aynı: `184.2 MB`, `6.8 KB`, `112 B`.
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/** Aktarım hızı: `23.4 MB/s`. */
export function formatRate(bytesPerSecond: number | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '—'
  return `${formatFileSize(bytesPerSecond)}/s`
}

/** Tarih yerel ayarı izler; mono yazıldığı için sütun hizası korunur. */
export function formatDate(iso: string, locale = 'tr-TR'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date).replace(',', '')
}

export function joinRemotePath(base: string, child: string): string {
  const normalizedBase = base.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedChild = child.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalizedBase) return `/${normalizedChild}`
  if (!normalizedChild) return normalizedBase || '/'
  return `${normalizedBase}/${normalizedChild}`
}

/** Yolu kırıntılara böler; Windows ve POSIX ayırıcılarını kabul eder. */
export function splitPath(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean)
}

const protocolLabels: Record<ConnectionType, string> = {
  FTP: 'FTP',
  FTPS: 'FTPS',
  SFTP: 'SFTP',
  Dropbox: 'DROPBOX',
  GoogleDrive: 'DRIVE',
}

export function protocolLabel(type: ConnectionType): string {
  return protocolLabels[type]
}

export function isCloud(type: ConnectionType): boolean {
  return type === 'Dropbox' || type === 'GoogleDrive'
}

/** Kenar çubuğu satırı: `kullanıcı@host:port`. Parola asla gösterilmez. */
export function connectionAddress(connection: ConnectionProfile): string {
  if (isCloud(connection.type)) return connection.status === 'connected' ? (connection.username || 'Bağlı') : 'Bağlı değil'
  const user = connection.username ? `${connection.username}@` : ''
  const port = connection.port ? `:${connection.port}` : ''
  return `${user}${connection.host}${port}`
}

export function defaultPort(type: ConnectionType): string {
  if (type === 'FTP') return '21'
  if (type === 'FTPS') return '990'
  if (type === 'SFTP') return '22'
  return ''
}
