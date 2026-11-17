import type { ConnectionProfile, ConnectionStatus, ConnectionType } from '../types'

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
export function formatDate(iso: string | null | undefined, locale = 'tr-TR'): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date).replace(',', '')
}

const protocolLabels: Record<ConnectionType, string> = {
  FTP: 'FTP',
  FTPS: 'FTPS',
  SFTP: 'SFTP',
  Dropbox: 'DROPBOX',
  GoogleDrive: 'DRIVE',
  OneDrive: 'ONEDRIVE',
}

export function protocolLabel(type: ConnectionType): string {
  return protocolLabels[type]
}

export function isCloud(type: ConnectionType): boolean {
  return type === 'Dropbox' || type === 'GoogleDrive' || type === 'OneDrive'
}

/** Kenar çubuğu satırı: `kullanıcı@host:port`. Parola asla gösterilmez. */
export function connectionAddress(connection: ConnectionProfile, status: ConnectionStatus = 'offline'): string {
  if (isCloud(connection.type)) return status === 'connected' ? 'Bağlı' : status === 'connecting' ? 'Bağlanıyor' : 'Bağlı değil'
  const user = connection.username ? `${connection.username}@` : ''
  const port = connection.port ? `:${connection.port}` : ''
  return `${user}${connection.host}${port}`
}

export function defaultPort(type: ConnectionType): string {
  if (type === 'FTP') return '21'
  if (type === 'FTPS') return '21'
  if (type === 'SFTP') return '22'
  return ''
}

/** `kullanıcı@host` veya bulut sağlayıcı adı; başlık çubuğu ve yol çubuğu kökü için. */
export function connectionLabel(connection: ConnectionProfile): string {
  if (isCloud(connection.type)) return connection.name
  return connection.username ? `${connection.username}@${connection.host}` : connection.host
}

/** Süre: `3 sn`, `1 dk 20 sn`. */
export function durationText(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds} sn` : `${Math.floor(seconds / 60)} dk ${seconds % 60} sn`
}

/** Kalan süre: "45 sn", "3 dk 10 sn", "1 sa 5 dk". Hesaplanamıyorsa null. */
export function etaText(remainingBytes: number, bytesPerSecond: number | undefined): string | null {
  if (!bytesPerSecond || bytesPerSecond <= 0 || !Number.isFinite(remainingBytes) || remainingBytes < 0) return null
  const seconds = Math.max(1, Math.round(remainingBytes / bytesPerSecond))
  if (seconds < 60) return `${seconds} sn`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk ${seconds % 60} sn`
  return `${Math.floor(seconds / 3600)} sa ${Math.floor((seconds % 3600) / 60)} dk`
}
