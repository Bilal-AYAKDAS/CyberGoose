import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateInfo } from '../types/electron'

export type UpdateState = {
  status: 'idle' | 'checking' | 'done' | 'error'
  info?: UpdateInfo
  error?: string
}

/**
 * GitHub Releases üzerinden yeni sürüm denetimi (yalnızca masaüstü uygulamasında).
 * `auto` açıksa açılışta bir kez sessizce denetler; elle denetimde hata gösterilir.
 */
export function useUpdateCheck(auto: boolean) {
  const supported = typeof window !== 'undefined' && Boolean(window.cyberGoose?.checkForUpdate)
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState('')
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
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Güncelleme denetlenemedi.'
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

  return { supported, state, available, check, dismiss }
}
