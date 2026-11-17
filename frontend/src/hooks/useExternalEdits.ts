import { useCallback, useEffect, useState } from 'react'
import { api, type ExternalEdit } from '../services/apiClient'

export const EDIT_POLL_MS = 2000

/**
 * Harici düzenleyicide açılan uzak dosyalar. Backend dosyayı izler ve kaydedince yükler;
 * bu hook yalnızca durumu (yükleme sayısı, son hata) gösterir ve açık düzenleme varken yoklar.
 */
export function useExternalEdits(onError: (message: string) => void) {
  const [edits, setEdits] = useState<ExternalEdit[]>([])

  const refresh = useCallback(async () => {
    try {
      setEdits(await api.listExternalEdits())
    } catch {
      // Yoklama hatası geçicidir; bir sonraki turda yeniden denenir.
    }
  }, [])

  useEffect(() => {
    if (!edits.length) return
    const timer = window.setInterval(() => { void refresh() }, EDIT_POLL_MS)
    return () => window.clearInterval(timer)
  }, [edits.length, refresh])

  const open = useCallback(async (remotePath: string, sessionId: number | null) => {
    try {
      const edit = await api.openExternalEdit(remotePath, sessionId ?? undefined)
      setEdits((current) => [...current.filter((item) => item.id !== edit.id), edit])
      if (!window.cyberGoose?.openPath) {
        onError(`Dosya indirildi ama burada açılamıyor (yalnızca masaüstü uygulamasında): ${edit.localPath}`)
        return
      }
      await window.cyberGoose.openPath(edit.localPath)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Dosya düzenleyicide açılamadı')
    }
  }, [onError])

  const close = useCallback(async (id: string) => {
    try {
      await api.closeExternalEdit(id)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Düzenleme kapatılamadı')
    }
    setEdits((current) => current.filter((item) => item.id !== id))
  }, [onError])

  const syncNow = useCallback(async (id: string) => {
    try {
      const updated = await api.syncExternalEdit(id)
      setEdits((current) => current.map((item) => (item.id === id ? updated : item)))
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Dosya yüklenemedi')
    }
  }, [onError])

  return { edits, open, close, syncNow, refresh }
}
