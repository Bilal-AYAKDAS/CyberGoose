import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../services/apiClient'
import type { Crumb, EntrySource, FileEntry } from '../types'

export type DirectoryState = {
  path: string | null
  parent: string | null
  crumbs: Crumb[]
  entries: FileEntry[]
  loading: boolean
  error: ApiError | null
}

const empty: DirectoryState = { path: null, parent: null, crumbs: [], entries: [], loading: false, error: null }

/**
 * Bir paneldeki klasörü API'den yükler. `requestedPath` değişince ya da `reload()` çağrılınca
 * yeniden ister; yarışan isteklerde yalnızca sonuncusu uygulanır.
 */
export function useDirectory(source: EntrySource, requestedPath: string | null, enabled: boolean) {
  const [version, setVersion] = useState(0)
  const requestKey = enabled ? `${source}:${requestedPath ?? ''}:${version}` : null
  const [result, setResult] = useState<{
    key: string
    path: string | null
    parent: string | null
    crumbs: Crumb[]
    entries: FileEntry[]
    error: ApiError | null
  } | null>(null)

  useEffect(() => {
    if (!enabled || !requestKey) return
    let active = true
    const request = source === 'local' ? api.listLocal(requestedPath) : api.listRemote(requestedPath ?? '/')
    request
      .then((listing) => {
        if (!active) return
        setResult({
          key: requestKey,
          path: listing.path,
          parent: listing.parent,
          crumbs: listing.crumbs,
          entries: listing.entries.map((entry) => ({ ...entry, source })),
          error: null,
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        const apiError = error instanceof ApiError ? error : new ApiError('Klasör yüklenemedi', 0)
        setResult((current) => ({
          key: requestKey,
          path: current?.path ?? null,
          parent: current?.parent ?? null,
          crumbs: current?.crumbs ?? [],
          entries: current?.entries ?? [],
          error: apiError,
        }))
      })
    return () => { active = false }
  }, [source, requestedPath, enabled, requestKey])

  const reload = useCallback(() => setVersion((value) => value + 1), [])

  if (!enabled) {
    return { ...empty, reload }
  }
  const settled = result?.key === requestKey
  return {
    path: result?.path ?? null,
    parent: result?.parent ?? null,
    crumbs: result?.crumbs ?? [],
    entries: result?.entries ?? [],
    loading: !settled,
    error: settled ? (result?.error ?? null) : null,
    reload,
  }
}
