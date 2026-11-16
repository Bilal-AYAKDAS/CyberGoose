import { useMemo, useState } from 'react'
import type { Bookmark, ConnectionProfile } from '../types'
import { Icon } from './Icon'

type BookmarksPanelProps = {
  bookmarks: Bookmark[]
  connections: ConnectionProfile[]
  onSelect: (bookmark: Bookmark) => void
  onClose: () => void
}

/** Dizin yer imleri: yüzen katman (bg-overlay + shadow-overlay), isimle filtrelenir. */
export function BookmarksPanel({ bookmarks, connections, onSelect, onClose }: BookmarksPanelProps) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.toLocaleLowerCase('tr')
    return bookmarks.filter((bookmark) => bookmark.name.toLocaleLowerCase('tr').includes(needle))
  }, [bookmarks, query])

  return (
    <section className="cg-popover cg-bookmarks" aria-label="Yer imleri" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <header className="cg-popover-head">
        <span>Yer imleri</span>
        <button className="cg-btn cg-btn-icon cg-btn-ghost" onClick={onClose} aria-label="Yer imlerini kapat"><Icon name="close" /></button>
      </header>
      <label className="cg-search cg-popover-search">
        <Icon name="search" />
        <input aria-label="Yer imlerinde ara" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrele" autoFocus />
      </label>
      <ul className="cg-bookmark-list">
        {filtered.map((bookmark) => {
          const connection = connections.find((item) => item.id === bookmark.connectionId)
          return (
            <li key={bookmark.id}>
              <button className="cg-conn" onClick={() => onSelect(bookmark)}>
                <Icon name="bookmark" />
                <span className="cg-conn-text">
                  <span className="n">{bookmark.name}</span>
                  <span className="h">{connection?.name ?? 'Bilinmeyen bağlantı'} · {bookmark.path}</span>
                </span>
                <span />
              </button>
            </li>
          )
        })}
      </ul>
      {!filtered.length && <p className="cg-help cg-popover-empty">Eşleşen yer imi yok.</p>}
    </section>
  )
}
