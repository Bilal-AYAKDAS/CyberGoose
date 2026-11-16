import { useMemo, useState } from 'react'
import type { ConnectionProfile, FolderBookmark } from '../types'
import { Icon } from './Icon'
import { Notice } from './Notice'

type BookmarksPanelProps = {
  bookmarks: FolderBookmark[]
  connections: ConnectionProfile[]
  /** Odaktaki panelin klasörü; "Bu klasörü ekle" bunu kaydeder. */
  currentFolder: { label: string; path: string; connectionId: string | null } | null
  error?: string | null
  onSelect: (bookmark: FolderBookmark) => void
  onAdd: () => Promise<void>
  onDelete: (bookmark: FolderBookmark) => Promise<void>
  onClose: () => void
}

/** Klasör yer imleri (veritabanında): yüzen katman, isimle filtrelenir. */
export function BookmarksPanel({ bookmarks, connections, currentFolder, error, onSelect, onAdd, onDelete, onClose }: BookmarksPanelProps) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = query.toLocaleLowerCase('tr')
    return bookmarks.filter((bookmark) => bookmark.name.toLocaleLowerCase('tr').includes(needle))
  }, [bookmarks, query])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'İşlem başarısız oldu')
    } finally {
      setBusy(false)
    }
  }

  const alreadySaved = currentFolder !== null && bookmarks.some((bookmark) =>
    bookmark.path === currentFolder.path && String(bookmark.connectionId ?? '') === String(currentFolder.connectionId ?? ''))

  return (
    <section className="cg-popover cg-bookmarks" aria-label="Yer imleri" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <header className="cg-popover-head">
        <span>Yer imleri</span>
        <button className="cg-btn cg-btn-icon cg-btn-ghost" onClick={onClose} aria-label="Yer imlerini kapat"><Icon name="close" /></button>
      </header>
      <div className="cg-popover-section">
        <button className="cg-btn" disabled={!currentFolder || alreadySaved || busy} onClick={() => run(onAdd)} title={currentFolder?.path}>
          <Icon name="plus" />{alreadySaved ? 'Bu klasör kayıtlı' : 'Bu klasörü ekle'}
        </button>
      </div>
      <label className="cg-search cg-popover-search">
        <Icon name="search" />
        <input aria-label="Yer imlerinde ara" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrele" autoFocus />
      </label>
      {(error || actionError) && <div className="cg-popover-section"><Notice tone="error" title={actionError ?? error ?? ''} /></div>}
      <ul className="cg-bookmark-list">
        {filtered.map((bookmark) => {
          const connection = bookmark.connectionId === null ? null : connections.find((item) => item.id === String(bookmark.connectionId))
          const owner = bookmark.connectionId === null ? 'Yerel' : connection?.name ?? 'Silinmiş bağlantı'
          return (
            <li key={bookmark.id} className="cg-bookmark-row">
              <button className="cg-conn" onClick={() => onSelect(bookmark)} disabled={bookmark.connectionId !== null && !connection}>
                <Icon name="bookmark" />
                <span className="cg-conn-text">
                  <span className="n">{bookmark.name}</span>
                  <span className="h">{owner} · {bookmark.path}</span>
                </span>
                <span />
              </button>
              <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label={`${bookmark.name} yer imini sil`} title="Sil" disabled={busy} onClick={() => run(() => onDelete(bookmark))}>
                <Icon name="close" />
              </button>
            </li>
          )
        })}
      </ul>
      {!filtered.length && <p className="cg-help cg-popover-empty">{bookmarks.length ? 'Eşleşen yer imi yok.' : 'Henüz yer imi yok.'}</p>}
    </section>
  )
}
