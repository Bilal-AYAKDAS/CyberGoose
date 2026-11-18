import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
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
  /** Tab: odağı diğer panele taşı; taşıyamazsa false döner ve Tab olağan biçimde ilerler. */
  onTabOut?: () => boolean
}

const columns: { key: SortKey; label: string; numeric?: boolean; className?: string }[] = [
  { key: 'name', label: 'Ad' },
  { key: 'size', label: 'Boyut', numeric: true, className: 'col-size' },
  { key: 'modified', label: 'Değiştirilme', className: 'col-date' },
]

/** Bu sayının üstünde yalnızca görünen satırlar (+ tampon) çizilir. */
export const VIRTUAL_THRESHOLD = 300
const ROW_HEIGHT = 28
const OVERSCAN = 20
/** jsdom gibi yerleşim yapmayan ortamlarda kullanılan varsayılan görünür yükseklik. */
const FALLBACK_VIEWPORT = 600

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
export function FileTable({ pane, label, entries, selected, onSelect, onOpen, onOpenParent, onContextMenu, emptyText = 'Bu klasör boş', onTabOut }: FileTableProps) {
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' })
  const anchorRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pendingFocusRef = useRef<number | null>(null)
  const [viewport, setViewport] = useState({ top: 0, height: FALLBACK_VIEWPORT })
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const sorted = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...entries].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return compare(a, b, sort.key) * factor
    })
  }, [entries, sort])

  const virtual = sorted.length > VIRTUAL_THRESHOLD
  const parentRows = onOpenParent ? 1 : 0
  let start = 0
  let end = sorted.length
  if (virtual) {
    const firstVisible = Math.floor(viewport.top / ROW_HEIGHT) - parentRows
    start = Math.max(0, firstVisible - OVERSCAN)
    end = Math.min(sorted.length, firstVisible + Math.ceil(viewport.height / ROW_HEIGHT) + OVERSCAN)
  }

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node || !virtual) return
    const measure = () => setViewport({ top: node.scrollTop, height: node.clientHeight || FALLBACK_VIEWPORT })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [virtual])

  // Klavyeyle gezinmede hedef satır o an çizilmemiş olabilir: kaydırıp çizildikten sonra odakla.
  useEffect(() => {
    const index = pendingFocusRef.current
    if (index === null) return
    const row = scrollRef.current?.querySelector<HTMLElement>(`tr[data-index="${index}"]`)
    if (!row) return
    pendingFocusRef.current = null
    row.focus({ preventScroll: !virtual })
  })

  const focusRow = (index: number) => {
    pendingFocusRef.current = index
    const node = scrollRef.current
    if (!virtual || !node) {
      node?.querySelector<HTMLElement>(`tr[data-index="${index}"]`)?.focus()
      pendingFocusRef.current = null
      return
    }
    const height = node.clientHeight || FALLBACK_VIEWPORT
    const rowTop = (index + parentRows) * ROW_HEIGHT
    let top = node.scrollTop
    if (rowTop < top + ROW_HEIGHT) top = Math.max(0, rowTop - ROW_HEIGHT)
    else if (rowTop + ROW_HEIGHT > top + height) top = rowTop + 2 * ROW_HEIGHT - height
    if (top !== node.scrollTop) node.scrollTop = top
    setViewport({ top, height })
  }

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
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && onTabOut) {
      if (onTabOut()) event.preventDefault()
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
    const nextIndex = index + (event.key === 'ArrowDown' ? 1 : -1)
    const next = sorted[nextIndex]
    if (!next) return
    anchorRef.current = next.name
    onSelect([next.name], next)
    focusRow(nextIndex)
  }

  if (!entries.length && !onOpenParent) {
    return (
      <div className="cg-empty">
        <span className="cg-caption">{emptyText}</span>
      </div>
    )
  }

  const primarySelected = selected.at(-1) ?? null
  const selectedIndex = sorted.findIndex((entry) => entry.name === primarySelected)
  // Odak satırı pencerenin dışındaysa Tab ile listeye girilebilsin diye ilk çizilen satır odaklanabilir olur.
  const focusIndex = selectedIndex >= start && selectedIndex < end ? selectedIndex : start
  const allSelected = sorted.length > 0 && sorted.every((entry) => selectedSet.has(entry.name))

  const toggleItem = (entry: FileEntry) => {
    anchorRef.current = entry.name
    const next = selected.includes(entry.name)
      ? selected.filter((name) => name !== entry.name)
      : [...selected, entry.name]
    onSelect(next, entry)
  }

  return (
    <div
      className="cg-list-scroll"
      ref={scrollRef}
      onScroll={virtual ? (event) => {
        const node = event.currentTarget
        setViewport({ top: node.scrollTop, height: node.clientHeight || FALLBACK_VIEWPORT })
      } : undefined}
    >
      <table className="cg-list" aria-label={label}>
        <colgroup><col style={{ width: 28 }} /><col /><col className="col-size" style={{ width: 92 }} /><col className="col-date" style={{ width: 140 }} /></colgroup>
        <thead>
          <tr>
            <th className="cg-check-col">
              <input
                type="checkbox"
                className="cg-check"
                aria-label="Tümünü seç"
                checked={allSelected}
                disabled={sorted.length === 0}
                onChange={() => onSelect(allSelected ? [] : sorted.map((item) => item.name))}
              />
            </th>
            {columns.map((column) => {
              const active = sort.key === column.key
              return (
                <th
                  key={column.key}
                  className={[column.numeric ? 'num' : '', column.className ?? ''].join(' ').trim() || undefined}
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
              <td className="cg-check-col" />
              <td><span className="cg-name"><Icon name="folder" className="is-dir" /><span className="cg-name-text">..</span></span></td>
              <td className="meta num col-size" />
              <td className="meta col-date" />
            </tr>
          )}
          {start > 0 && <tr className="cg-spacer" aria-hidden="true" style={{ height: start * ROW_HEIGHT }}><td colSpan={4} /></tr>}
          {sorted.slice(start, end).map((entry, offset) => {
            const index = start + offset
            const isSelected = selectedSet.has(entry.name)
            return (
              <tr
                key={entry.path}
                data-index={index}
                className={isSelected ? 'is-selected' : undefined}
                aria-selected={isSelected}
                data-entry
                tabIndex={index === focusIndex ? 0 : -1}
                draggable={Boolean(pane)}
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
                <td className="cg-check-col" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="cg-check"
                    aria-label={`${entry.name} seç`}
                    checked={isSelected}
                    onChange={() => toggleItem(entry)}
                  />
                </td>
                <td>
                  <span className="cg-name">
                    <Icon name={entry.kind === 'folder' ? 'folder' : 'file'} className={entry.kind === 'folder' ? 'is-dir' : undefined} />
                    <span className="cg-name-text" title={entry.name}>{entry.name}</span>
                  </span>
                </td>
                <td className="meta num col-size">{entry.kind === 'folder' ? '—' : formatFileSize(entry.size)}</td>
                <td className="meta col-date">{formatDate(entry.modified)}</td>
              </tr>
            )
          })}
          {end < sorted.length && <tr className="cg-spacer" aria-hidden="true" style={{ height: (sorted.length - end) * ROW_HEIGHT }}><td colSpan={4} /></tr>}
        </tbody>
      </table>
      {!entries.length && <div className="cg-empty cg-empty-inline"><span className="cg-caption">{emptyText}</span></div>}
    </div>
  )
}
