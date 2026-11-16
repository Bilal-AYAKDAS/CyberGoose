import { useMemo, useState } from 'react'
import type { Bookmark, ConnectionProfile } from '../types'

type BookmarksPanelProps = {
  bookmarks: Bookmark[]
  connections: ConnectionProfile[]
  onSelect: (bookmark: Bookmark) => void
  onClose: () => void
}

export function BookmarksPanel({ bookmarks, connections, onSelect, onClose }: BookmarksPanelProps) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => bookmarks.filter((bookmark) => bookmark.name.toLowerCase().includes(query.toLowerCase())), [bookmarks, query])
  return (
    <section className="drawer" aria-label="Yer imleri">
      <header className="drawer-header"><div><div className="eyebrow">KAYITLI KONUMLAR</div><h2>Yer imleri</h2></div><button className="close-button" onClick={onClose} aria-label="Yer imlerini kapat">×</button></header>
      <label className="search drawer-search"><span>⌕</span><input aria-label="Yer imlerinde ara" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrele..." /></label>
      <div className="bookmark-list">
        {filtered.map((bookmark) => {
          const connection = connections.find((item) => item.id === bookmark.connectionId)
          return <button className="bookmark-item" key={bookmark.id} onClick={() => onSelect(bookmark)}><span className="bookmark-mark">★</span><span><strong>{bookmark.name}</strong><small>{connection?.name ?? 'Bilinmeyen bağlantı'} · {bookmark.path}</small></span></button>
        })}
        {!filtered.length && <p className="empty-state">Eşleşen yer imi yok.</p>}
      </div>
    </section>
  )
}
