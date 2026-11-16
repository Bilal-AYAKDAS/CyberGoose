import type { ConnectionProfile, TransferItem } from '../types'

export type DotTone = 'ok' | 'warn' | 'error' | 'muted'

/**
 * Bağlantı durumu noktası: bağlı = ok, düz FTP veya doğrulanmamış host = warn,
 * kopuk = error, bağlı değil = muted. Düz FTP her zaman sarı görünür.
 */
export function connectionTone(connection: ConnectionProfile): DotTone {
  if (connection.status === 'error') return 'error'
  if (connection.status !== 'connected') return 'muted'
  return connection.type === 'FTP' ? 'warn' : 'ok'
}

/** Transfer kuyruğu başlığındaki sayaç: "2 etkin · 1 sırada · 1 hata". */
export function queueSummary(items: TransferItem[]) {
  const active = items.filter((item) => item.status === 'transferring').length
  const queued = items.filter((item) => item.status === 'queued').length
  const errors = items.filter((item) => item.status === 'error').length
  return { active, queued, errors }
}
