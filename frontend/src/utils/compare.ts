import type { CompareRow, CompareStatus } from '../services/apiClient'

export const rowKey = (row: CompareRow) => (row.relativeDir ? `${row.relativeDir}/${row.name}` : row.name)

/** Yükleme yalnız yerelde olan ve farklı dosyaları, indirme yalnız sunucuda olan ve farklı dosyaları kapsar. */
export function rowsFor(rows: CompareRow[], direction: 'upload' | 'download') {
  const own: CompareStatus = direction === 'upload' ? 'onlyLocal' : 'onlyRemote'
  return rows.filter((row) => row.status === own || row.status === 'different')
}
