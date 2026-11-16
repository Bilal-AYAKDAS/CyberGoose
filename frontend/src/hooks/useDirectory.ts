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
  const [state, setState] = useState<DirectoryState>(empty)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setState(empty)
      return
    }
    let active = true
    setState((current) => ({ ...current, loading: true, error: null }))
    const request = source === 'local' ? api.listLocal(requestedPath) : api.listRemote(requestedPath ?? '/')
    request
      .then((listing) => {
        if (!active) return
        setState({
          path: listing.path,
          parent: listing.parent,
          crumbs: listing.crumbs,
          entries: listing.entries.map((entry) => ({ ...entry, source })),
          loading: false,
          error: null,
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        const apiError = error instanceof ApiError ? error : new ApiError('Klasör yüklenemedi', 0)
        setState((current) => ({ ...current, loading: false, error: apiError }))
      })
    return () => { active = false }
  }, [source, requestedPath, enabled, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { ...state, reload }
}
