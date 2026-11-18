import type { CompareRow, CompareStatus } from '../services/apiClient'

export const rowKey = (row: CompareRow) => (row.relativeDir ? `${row.relativeDir}/${row.name}` : row.name)

/** Yükleme yalnız yerelde olan ve farklı dosyaları, indirme yalnız sunucuda olan ve farklı dosyaları kapsar. */
export function rowsFor(rows: CompareRow[], direction: 'upload' | 'download') {
  const own: CompareStatus = direction === 'upload' ? 'onlyLocal' : 'onlyRemote'
  return rows.filter((row) => row.status === own || row.status === 'different')
}

/** Tek yönlü eşitlemede hedefte fazla kalan dosyalar: yüklerken yalnız sunucuda, indirirken yalnız yerelde olanlar. */
export function extrasFor(rows: CompareRow[], direction: 'upload' | 'download') {
  const extra: CompareStatus = direction === 'upload' ? 'onlyRemote' : 'onlyLocal'
  return rows.filter((row) => row.status === extra)
}

/** Karşılaştırma satırının tam yolu; Windows yollarında ters bölü korunur. */
export function joinRelative(base: string, relativeDir: string, name: string) {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  const parts = [...relativeDir.split('/').filter(Boolean), name]
  return `${base.replace(/[\\/]+$/, '')}${sep}${parts.join(sep)}`
}

/** Saat farkını cümleye çevirir: 180 → "sunucu 3 saat ileride". */
export function describeOffset(minutes: number) {
  if (!minutes) return 'saat farkı yok'
  const hours = Math.abs(minutes) / 60
  const amount = Number.isInteger(hours) ? `${hours} saat` : `${Math.abs(minutes)} dakika`
  return `sunucu ${amount} ${minutes > 0 ? 'ileride' : 'geride'}`
}
