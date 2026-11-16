import type { ConnectionStatus, ConnectionType, TransferItem } from '../types'

export type DotTone = 'ok' | 'warn' | 'error' | 'muted'

/**
 * Bağlantı durumu noktası: bağlı = ok, düz FTP veya bağlanıyor = warn,
 * hata = error, bağlı değil = muted. Düz FTP her zaman sarı görünür.
 */
export function connectionTone(type: ConnectionType, status: ConnectionStatus): DotTone {
  if (status === 'error') return 'error'
  if (status === 'connecting') return 'warn'
  if (status !== 'connected') return 'muted'
  return type === 'FTP' ? 'warn' : 'ok'
}

export function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected': return 'bağlı'
    case 'connecting': return 'bağlanıyor'
    case 'error': return 'bağlantı hatası'
    default: return 'bağlı değil'
  }
}

/** Transfer kuyruğu başlığındaki sayaç: "1 etkin · 1 sırada · 1 hata". */
export function queueSummary(items: TransferItem[]) {
  const active = items.filter((item) => item.status === 'transferring').length
  const queued = items.filter((item) => item.status === 'queued').length
  const errors = items.filter((item) => item.status === 'error').length
  return { active, queued, errors }
}
