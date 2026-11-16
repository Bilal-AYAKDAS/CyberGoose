import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { FileEntry, PaneId } from '../types'
import { formatDate, formatFileSize } from '../utils/formatters'
import { Icon } from './Icon'

type SortKey = 'name' | 'size' | 'modified'
type SortState = { key: SortKey; direction: 'asc' | 'desc' }

type FileTableProps = {
  pane?: PaneId
  label: string
  entries: FileEntry[]
  selected: string[]
  onSelect: (names: string[], primary?: FileEntry) => void
  /** Çift tık veya Enter: klasöre gir / dosya detaylarını aç. */
  onOpen: (entry: FileEntry) => void
  /** Varsa listenin başında `..` satırı gösterilir. */
  onOpenParent?: () => void
  onContextMenu?: (entry: FileEntry, event: MouseEvent) => void
  /** Boş klasör metni. */
  emptyText?: string
}

const columns: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Ad' },
  { key: 'size', label: 'Boyut', numeric: true },
  { key: 'modified', label: 'Değiştirilme' },
]

function compare(a: FileEntry, b: FileEntry, key: SortKey): number {
  if (key === 'size') return (a.size ?? -1) - (b.size ?? -1)
  if (key === 'modified') return (a.modified ?? '').localeCompare(b.modified ?? '')
  return a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' })
}

/**
 * Dosya listesi: satır size-row (28px), satır arası çizgi ve zebra yok.
 * Ad sans; boyut ve tarih mono, text-muted, tabular. Klasörler önce listelenir.
 * Sıralama yalnızca aktif sütunda text-accent bir okla gösterilir.
 */
export function FileTable({ pane, label, entries, selected, onSelect, onOpen, onOpenParent, onContextMenu, emptyText = 'Bu klasör boş' }: FileTableProps) {
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' })
  const anchorRef = useRef<string | null>(null)

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

  const handleRowClick = (entry: FileEntry, event: MouseEvent<HTMLTableRowElement>) => {
    if (event.shiftKey && anchorRef.current) {
      const start = sorted.findIndex((item) => item.name === anchorRef.current)
      const end = sorted.findIndex((item) => item.name === entry.name)
      if (start !== -1 && end !== -1) {
        const [lo, hi] = start <= end ? [start, end] : [end, start]
        onSelect(sorted.slice(lo, hi + 1).map((item) => item.name), entry)
        return
      }
    }
    if (event.ctrlKey || event.metaKey) {
      anchorRef.current = entry.name
      const next = selected.includes(entry.name)
        ? selected.filter((name) => name !== entry.name)
        : [...selected, entry.name]
      onSelect(next, entry)
      return
    }
    anchorRef.current = entry.name
    onSelect([entry.name], entry)
  }

  const handleKey = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      onSelect(sorted.map((item) => item.name))
      return
    }
    if (event.key === 'Enter') {
      onOpen(sorted[index])
      return
    }
    if (event.key === 'Backspace' && onOpenParent) {
      event.preventDefault()
      onOpenParent()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const next = sorted[index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    anchorRef.current = next.name
    onSelect([next.name], next)
    const rows = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('tr[data-entry]')
    rows?.[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
  }

  if (!entries.length && !onOpenParent) {
    return (
      <div className="cg-empty">
        <span className="cg-caption">{emptyText}</span>
      </div>
    )
  }

  const primarySelected = selected.at(-1) ?? null
  const focusIndex = Math.max(0, sorted.findIndex((entry) => entry.name === primarySelected))

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
          {onOpenParent && (
            <tr className="cg-parent-row" tabIndex={-1} onDoubleClick={onOpenParent} onKeyDown={(event) => { if (event.key === 'Enter') onOpenParent() }} aria-label="Üst klasör">
              <td><span className="cg-name"><Icon name="folder" className="is-dir" /><span className="cg-name-text">..</span></span></td>
              <td className="meta num" />
              <td className="meta" />
            </tr>
          )}
          {sorted.map((entry, index) => {
            const isSelected = selected.includes(entry.name)
            return (
              <tr
                key={entry.path}
                className={isSelected ? 'is-selected' : undefined}
                aria-selected={isSelected}
                data-entry
                tabIndex={index === focusIndex ? 0 : -1}
                draggable={Boolean(pane && entry.kind === 'file')}
                onDragStart={pane ? (event) => {
                  const names = isSelected ? selected : [entry.name]
                  event.dataTransfer.setData('application/x-cybergoose-transfer', JSON.stringify({ source: pane, names }))
                  event.dataTransfer.effectAllowed = 'copy'
                } : undefined}
                onClick={(event) => handleRowClick(entry, event)}
                onDoubleClick={() => onOpen(entry)}
                onContextMenu={onContextMenu ? (event) => {
                  event.preventDefault()
                  if (!isSelected) {
                    anchorRef.current = entry.name
                    onSelect([entry.name], entry)
                  }
                  onContextMenu(entry, event)
                } : undefined}
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
      {!entries.length && <div className="cg-empty cg-empty-inline"><span className="cg-caption">{emptyText}</span></div>}
    </div>
  )
}
