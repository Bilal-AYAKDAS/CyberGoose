import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateInfo, UpdateProgress } from '../types/electron'

export type UpdateState = {
  status: 'idle' | 'checking' | 'done' | 'error'
  info?: UpdateInfo
  error?: string
}

/** Uygulama içinden kurulum: indir → doğrula → yeniden başlat. */
export type InstallState = {
  phase: 'idle' | 'downloading' | 'ready' | 'restarting' | 'error'
  progress?: UpdateProgress
  error?: string
}

const cleanIpcError = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback

/**
 * GitHub Releases üzerinden yeni sürüm denetimi (yalnızca masaüstü uygulamasında).
 * `auto` açıksa açılışta bir kez sessizce denetler; elle denetimde hata gösterilir.
 */
export function useUpdateCheck(auto: boolean) {
  const supported = typeof window !== 'undefined' && Boolean(window.cyberGoose?.checkForUpdate)
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState('')
  const [install, setInstall] = useState<InstallState>({ phase: 'idle' })
  const autoChecked = useRef(false)

  const check = useCallback(async (manual = true) => {
    const checker = window.cyberGoose?.checkForUpdate
    if (!checker) {
      if (manual) setState({ status: 'error', error: 'Güncelleme denetimi yalnızca masaüstü uygulamasında çalışır.' })
      return
    }
    setState((previous) => ({ ...previous, status: 'checking', error: undefined }))
    try {
      const info = await checker()
      setState({ status: 'done', info })
      if (manual) setDismissed('')
    } catch (error) {
      const message = cleanIpcError(error, 'Güncelleme denetlenemedi.')
      // Açılıştaki otomatik denetim çevrimdışıyken kullanıcıyı rahatsız etmez; sonucu Ayarlar'da görünür.
      setState({ status: 'error', error: message })
    }
  }, [])

  useEffect(() => {
    if (!auto || !supported || autoChecked.current) return
    autoChecked.current = true
    const timer = window.setTimeout(() => { void check(false) }, 5000)
    return () => window.clearTimeout(timer)
  }, [auto, supported, check])

  const available = state.info?.available && dismissed !== state.info.latest ? state.info : null
  const dismiss = useCallback(() => setDismissed(state.info?.latest ?? ''), [state.info])

  /** Bu kurulumda paket uygulama içinden indirilip kurulabilir mi (taşınabilir exe ya da kurulum dosyası)? */
  const canInstall = Boolean(state.info?.available && state.info.canInstall && window.cyberGoose?.downloadUpdate && window.cyberGoose?.applyUpdate)

  const download = useCallback(async () => {
    const desktop = window.cyberGoose
    if (!desktop?.downloadUpdate) return
    setInstall({ phase: 'downloading', progress: { received: 0, total: null } })
    const stop = desktop.onUpdateProgress?.((progress) => setInstall((current) => (current.phase === 'downloading' ? { ...current, progress } : current)))
    try {
      await desktop.downloadUpdate()
      setInstall({ phase: 'ready' })
    } catch (error) {
      setInstall({ phase: 'error', error: cleanIpcError(error, 'Güncelleme indirilemedi.') })
    } finally {
      stop?.()
    }
  }, [])

  const restart = useCallback(async () => {
    const desktop = window.cyberGoose
    if (!desktop?.applyUpdate) return
    setInstall({ phase: 'restarting' })
    try {
      await desktop.applyUpdate()
    } catch (error) {
      setInstall({ phase: 'error', error: cleanIpcError(error, 'Güncelleme uygulanamadı.') })
    }
  }, [])

  return { supported, state, available, check, dismiss, canInstall, install, download, restart }
}
