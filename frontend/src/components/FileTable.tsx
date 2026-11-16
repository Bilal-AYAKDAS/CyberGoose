import { useMemo, useState, type KeyboardEvent } from 'react'
import type { FileEntry } from '../types'
import { formatDate, formatFileSize } from '../utils/formatters'
import { Icon } from './Icon'

type SortKey = 'name' | 'size' | 'modified'
type SortState = { key: SortKey; direction: 'asc' | 'desc' }

type FileTableProps = {
  label: string
  entries: FileEntry[]
  selected: string | null
  onSelect: (entry: FileEntry) => void
  /** Çift tık veya Enter: dosya detaylarını aç. */
  onOpen: (entry: FileEntry) => void
}

const columns: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Ad' },
  { key: 'size', label: 'Boyut', numeric: true },
  { key: 'modified', label: 'Değiştirilme' },
]

function compare(a: FileEntry, b: FileEntry, key: SortKey): number {
  if (key === 'size') return (a.size ?? -1) - (b.size ?? -1)
  if (key === 'modified') return a.modified.localeCompare(b.modified)
  return a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' })
}

/**
 * Dosya listesi: satır size-row (28px), satır arası çizgi ve zebra yok.
 * Ad sans; boyut ve tarih mono, text-muted, tabular. Klasörler önce listelenir.
 * Sıralama yalnızca aktif sütunda text-accent bir okla gösterilir.
 */
export function FileTable({ label, entries, selected, onSelect, onOpen }: FileTableProps) {
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' })

  const sorted = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...entries].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return compare(a, b, sort.key) * factor
    })
  }, [entries, sort])

  const toggleSort = (key: SortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' })
  }

  const handleKey = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    if (event.key === 'Enter') {
      onOpen(sorted[index])
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const next = sorted[index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    onSelect(next)
    const row = event.currentTarget.parentElement?.children[index + (event.key === 'ArrowDown' ? 1 : -1)] as HTMLElement | undefined
    row?.focus()
  }

  if (!entries.length) {
    return (
      <div className="cg-empty">
        <span className="cg-caption">Bu klasör boş</span>
        <span className="cg-help">Dosyaları buraya bırakın</span>
      </div>
    )
  }

  const focusIndex = Math.max(0, sorted.findIndex((entry) => entry.name === selected))

  return (
    <div className="cg-list-scroll">
      <table className="cg-list" aria-label={label}>
        <colgroup><col /><col style={{ width: 92 }} /><col style={{ width: 140 }} /></colgroup>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort.key === column.key
              return (
                <th
                  key={column.key}
                  className={column.numeric ? 'num' : undefined}
                  aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <button className="cg-th-btn" onClick={() => toggleSort(column.key)}>
                    {column.label}
                    {active && <span className="sort" aria-hidden="true">{sort.direction === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry, index) => {
            const isSelected = selected === entry.name
            return (
              <tr
                key={entry.name}
                className={isSelected ? 'is-selected' : undefined}
                aria-selected={isSelected}
                tabIndex={index === focusIndex ? 0 : -1}
                onClick={() => onSelect(entry)}
                onDoubleClick={() => onOpen(entry)}
                onKeyDown={(event) => handleKey(event, index)}
              >
                <td>
                  <span className="cg-name">
                    <Icon name={entry.kind === 'folder' ? 'folder' : 'file'} className={entry.kind === 'folder' ? 'is-dir' : undefined} />
                    <span className="cg-name-text">{entry.name}</span>
                  </span>
                </td>
                <td className="meta num">{entry.kind === 'folder' ? '—' : formatFileSize(entry.size)}</td>
                <td className="meta">{formatDate(entry.modified)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
