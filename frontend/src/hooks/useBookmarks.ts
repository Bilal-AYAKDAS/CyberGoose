import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/apiClient'
import type { FolderBookmark } from '../types'

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<FolderBookmark[]>([])
  const [bookmarksError, setBookmarksError] = useState<string | null>(null)
  const [bookmarksOpen, setBookmarksOpen] = useState(false)

  // Kenar çubuğu yer imlerini her zaman gösterir; açılışta ve panel açıldığında yenilenir.
  useEffect(() => {
    let active = true
    api.listBookmarks()
      .then((items) => {
        if (!active) return
        setBookmarks(items)
        setBookmarksError(null)
      })
      .catch((error) => {
        if (active) setBookmarksError(messageOf(error, 'Yer imleri yüklenemedi'))
      })
    return () => { active = false }
  }, [bookmarksOpen])

  const addBookmark = useCallback(async (folder: { label: string; path: string; connectionId: string | null }) => {
    const created = await api.createBookmark({ name: folder.label, path: folder.path, connectionId: folder.connectionId })
    setBookmarks((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name, 'tr')))
  }, [])

  const deleteBookmark = useCallback(async (bookmark: FolderBookmark) => {
    await api.deleteBookmark(bookmark.id)
    setBookmarks((items) => items.filter((item) => item.id !== bookmark.id))
  }, [])

  return {
    bookmarks,
    bookmarksError,
    bookmarksOpen,
    setBookmarksOpen,
    addBookmark,
    deleteBookmark,
  }
}
